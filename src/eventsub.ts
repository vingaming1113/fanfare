// Authenticated Twitch layer: OAuth (Authorization Code flow) + EventSub over
// WebSocket. This unlocks the one event the anonymous IRC connection can't see:
// **follows** (`channel.follow` v2, which requires the `moderator:read:followers`
// scope). The anonymous IRC connector keeps handling chat/subs/gifts/raids/bits,
// so EventSub here is intentionally scoped to follows to avoid duplicate events.
//
// Setup is opt-in: provide a Twitch application's Client ID + Secret (from
// https://dev.twitch.tv/console, with an OAuth redirect of
// `<your-origin>/auth/twitch/callback`) via env vars TWITCH_CLIENT_ID /
// TWITCH_CLIENT_SECRET or the dashboard, then click "Login with Twitch".
import { emitEvent } from "./engine.ts";
import { getSetting, setSetting } from "./db.ts";

const OAUTH = "https://id.twitch.tv/oauth2";
const HELIX = "https://api.twitch.tv/helix";
const EVENTSUB_WS = "wss://eventsub.wss.twitch.tv/ws";
const SCOPES = "moderator:read:followers";

interface Tokens {
  accessToken: string;
  refreshToken: string;
  userId: string;
  login: string;
}

export interface TwitchAuthStatus {
  appConfigured: boolean;
  authed: boolean;
  login: string | null;
  followsLive: boolean;
  lastError: string | null;
}

class TwitchAuth {
  private clientId = "";
  private clientSecret = "";
  private tokens: Tokens | null = null;
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private followsLive = false;
  private lastError: string | null = null;
  private pendingState: string | null = null;
  private manualStop = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  onChange: (() => void) | null = null;

  init() {
    const env = { id: process.env.TWITCH_CLIENT_ID, secret: process.env.TWITCH_CLIENT_SECRET };
    const stored = getSetting<{ clientId: string; clientSecret: string }>("twitchApp", {
      clientId: "",
      clientSecret: "",
    });
    this.clientId = env.id || stored.clientId || "";
    this.clientSecret = env.secret || stored.clientSecret || "";
    this.tokens = getSetting<Tokens | null>("twitchTokens", null);
    if (this.tokens && this.appConfigured()) this.connectEventSub();
  }

  appConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  status(): TwitchAuthStatus {
    return {
      appConfigured: this.appConfigured(),
      authed: !!this.tokens,
      login: this.tokens?.login ?? null,
      followsLive: this.followsLive,
      lastError: this.lastError,
    };
  }

  /** Persist an app's client id/secret entered from the dashboard. */
  setApp(clientId: string, clientSecret: string) {
    this.clientId = clientId.trim();
    this.clientSecret = clientSecret.trim();
    setSetting("twitchApp", { clientId: this.clientId, clientSecret: this.clientSecret });
    this.emit();
  }

  /** Build the Twitch consent URL to redirect the streamer to. */
  loginUrl(origin: string): string | null {
    if (!this.appConfigured()) return null;
    this.pendingState = crypto.randomUUID();
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: `${origin}/auth/twitch/callback`,
      response_type: "code",
      scope: SCOPES,
      state: this.pendingState,
    });
    return `${OAUTH}/authorize?${p}`;
  }

  /** Handle the OAuth redirect: exchange the code, then start EventSub. */
  async handleCallback(code: string, state: string, origin: string): Promise<void> {
    if (!code || state !== this.pendingState) {
      this.lastError = "invalid oauth state";
      this.emit();
      return;
    }
    this.pendingState = null;
    try {
      const res = await fetch(`${OAUTH}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: `${origin}/auth/twitch/callback`,
        }),
      });
      if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
      const body = (await res.json()) as { access_token: string; refresh_token: string };
      const user = await this.fetchUser(body.access_token);
      this.tokens = {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        userId: user.id,
        login: user.login,
      };
      setSetting("twitchTokens", this.tokens);
      this.lastError = null;
      this.connectEventSub();
    } catch (err) {
      this.lastError = String((err as Error).message ?? err);
      this.emit();
    }
  }

  logout() {
    this.tokens = null;
    setSetting("twitchTokens", null);
    this.disconnect();
    this.emit();
  }

  private async fetchUser(token: string): Promise<{ id: string; login: string }> {
    const res = await fetch(`${HELIX}/users`, {
      headers: { Authorization: `Bearer ${token}`, "Client-Id": this.clientId },
    });
    if (!res.ok) throw new Error(`user lookup failed (${res.status})`);
    const j = (await res.json()) as { data: { id: string; login: string }[] };
    if (!j.data?.[0]) throw new Error("no user returned");
    return j.data[0];
  }

  private connectEventSub(reconnectUrl?: string) {
    if (!this.tokens) return;
    this.manualStop = false;
    this.clearReconnect();
    try {
      this.ws = new WebSocket(reconnectUrl || EVENTSUB_WS);
    } catch (err) {
      this.lastError = String(err);
      this.emit();
      return;
    }
    const ws = this.ws;
    ws.onmessage = (e) => this.onWsMessage(String(e.data), !!reconnectUrl);
    ws.onerror = () => { this.lastError = "eventsub socket error"; };
    ws.onclose = () => {
      this.followsLive = false;
      this.emit();
      if (!this.manualStop && this.tokens) {
        this.reconnectTimer = setTimeout(() => this.connectEventSub(), 3000);
      }
    };
  }

  private async onWsMessage(data: string, isReconnect: boolean) {
    let msg: any;
    try { msg = JSON.parse(data); } catch { return; }
    const type = msg?.metadata?.message_type;
    switch (type) {
      case "session_welcome":
        this.sessionId = msg.payload.session.id;
        if (!isReconnect) await this.createFollowSubscription();
        else { this.followsLive = true; this.emit(); }
        return;
      case "session_reconnect":
        this.disconnect(false);
        this.connectEventSub(msg.payload.session.reconnect_url);
        return;
      case "notification":
        if (msg.payload.subscription.type === "channel.follow") {
          emitEvent({ type: "follow", name: msg.payload.event.user_name });
        }
        return;
      case "revocation":
        this.followsLive = false;
        this.lastError = `subscription revoked: ${msg.payload?.subscription?.status ?? ""}`;
        this.emit();
        return;
    }
  }

  private async createFollowSubscription(retry = true): Promise<void> {
    if (!this.tokens || !this.sessionId) return;
    const res = await fetch(`${HELIX}/eventsub/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        "Client-Id": this.clientId,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "channel.follow",
        version: "2",
        condition: {
          broadcaster_user_id: this.tokens.userId,
          moderator_user_id: this.tokens.userId,
        },
        transport: { method: "websocket", session_id: this.sessionId },
      }),
    });
    if (res.status === 401 && retry && (await this.refresh())) {
      return this.createFollowSubscription(false);
    }
    if (res.ok || res.status === 409) {
      this.followsLive = true;
      this.lastError = null;
    } else {
      this.lastError = `follow subscription failed (${res.status})`;
    }
    this.emit();
  }

  private async refresh(): Promise<boolean> {
    if (!this.tokens) return false;
    try {
      const res = await fetch(`${OAUTH}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "refresh_token",
          refresh_token: this.tokens.refreshToken,
        }),
      });
      if (!res.ok) throw new Error(`refresh failed (${res.status})`);
      const body = (await res.json()) as { access_token: string; refresh_token: string };
      this.tokens = { ...this.tokens, accessToken: body.access_token, refreshToken: body.refresh_token };
      setSetting("twitchTokens", this.tokens);
      return true;
    } catch (err) {
      this.lastError = String((err as Error).message ?? err);
      return false;
    }
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
  private disconnect(manual = true) {
    this.manualStop = manual;
    this.clearReconnect();
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.sessionId = null;
    this.followsLive = false;
  }
  private emit() {
    this.onChange?.();
  }
}

export const twitchAuth = new TwitchAuth();
