// Real Twitch integration via anonymous IRC-over-WebSocket.
//
// Twitch lets anyone read a channel's chat WITHOUT authentication by logging in
// as a `justinfan` guest. With the tags + commands capabilities enabled, that
// same read-only stream also carries real subscriptions, resubs, gifted subs,
// community gifts, raids and bits/cheers (as IRC USERNOTICE / PRIVMSG events).
//
// This turns Fanfare into an actual streaming tool: point it at a Twitch
// channel and real activity flows through the same alert/goal/hype/loyalty
// pipeline as everything else — no OAuth, no API keys, no bot account.
//
// (Follows are the one common event NOT exposed on this anonymous stream; they
// require an authenticated EventSub subscription and are noted in the docs.)
import { publish } from "./bus.ts";
import { emitChat, emitEvent } from "./engine.ts";
import { getSetting, setSetting } from "./db.ts";
import type { TwitchStatus } from "./events.ts";

const IRC_URL = "wss://irc-ws.chat.twitch.tv:443";
const SUB_TIER: Record<string, number> = { Prime: 1, "1000": 1, "2000": 2, "3000": 3 };

interface IRCMessage {
  tags: Record<string, string>;
  prefix: string;
  command: string;
  params: string[];
}

// Parse a raw IRC line (RFC 1459 + IRCv3 tags) into its parts.
export function parseIRC(line: string): IRCMessage {
  const tags: Record<string, string> = {};
  let rest = line;

  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    for (const pair of rest.slice(1, sp).split(";")) {
      const eq = pair.indexOf("=");
      const key = eq === -1 ? pair : pair.slice(0, eq);
      const val = eq === -1 ? "" : pair.slice(eq + 1);
      tags[key] = unescapeTag(val);
    }
    rest = rest.slice(sp + 1);
  }

  let prefix = "";
  if (rest.startsWith(":")) {
    const sp = rest.indexOf(" ");
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }

  const params: string[] = [];
  while (rest.length) {
    if (rest.startsWith(":")) { params.push(rest.slice(1)); break; }
    const sp = rest.indexOf(" ");
    if (sp === -1) { params.push(rest); break; }
    params.push(rest.slice(0, sp));
    rest = rest.slice(sp + 1);
  }

  return { tags, prefix, command: params.shift() ?? "", params };
}

function unescapeTag(v: string): string {
  return v.replace(/\\s/g, " ").replace(/\\:/g, ";").replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

function badgesFromTag(tag = ""): string[] {
  const out: string[] = [];
  for (const b of tag.split(",")) {
    const key = b.split("/")[0];
    if (key === "broadcaster") out.push("broadcaster");
    else if (key === "moderator") out.push("mod");
    else if (key === "subscriber" || key === "founder") out.push("sub");
    else if (key === "vip") out.push("vip");
  }
  return [...new Set(out)];
}

type StatusListener = (s: TwitchStatus) => void;

class TwitchClient {
  private ws: WebSocket | null = null;
  private channel = "";
  private enabled = false;
  private connected = false;
  private lastError: string | null = null;
  private since: number | null = null;
  private manualStop = false;
  private backoff = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Load persisted integration config and connect if enabled. */
  init() {
    const cfg = getSetting<{ enabled: boolean; channel: string }>("twitch", {
      enabled: false,
      channel: "",
    });
    this.enabled = cfg.enabled;
    this.channel = normalizeChannel(cfg.channel);
    if (this.enabled && this.channel) this.open();
  }

  status(): TwitchStatus {
    return {
      enabled: this.enabled,
      channel: this.channel,
      connected: this.connected,
      lastError: this.lastError,
      since: this.since,
    };
  }

  /** Apply new config from the dashboard, persist it, and (re)connect. */
  configure(enabled: boolean, channel: string): TwitchStatus {
    this.channel = normalizeChannel(channel);
    this.enabled = enabled && !!this.channel;
    setSetting("twitch", { enabled: this.enabled, channel: this.channel });
    this.disconnect();
    this.lastError = null;
    if (this.enabled) this.open();
    else this.emit();
    return this.status();
  }

  private open() {
    this.manualStop = false;
    this.clearReconnect();
    try {
      this.ws = new WebSocket(IRC_URL);
    } catch (err) {
      this.fail(String(err));
      return;
    }
    const ws = this.ws;

    ws.onopen = () => {
      ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      ws.send(`NICK justinfan${Math.floor(Math.random() * 90000) + 10000}`);
      ws.send(`JOIN #${this.channel}`);
    };
    ws.onmessage = (e) => {
      for (const line of String(e.data).split("\r\n")) {
        if (line) this.handle(line);
      }
    };
    ws.onerror = () => { this.lastError = "socket error"; };
    ws.onclose = () => {
      this.connected = false;
      this.since = null;
      this.emit();
      if (!this.manualStop && this.enabled) this.scheduleReconnect();
    };
  }

  private handle(line: string) {
    const msg = parseIRC(line);
    switch (msg.command) {
      case "PING":
        this.ws?.send(`PONG :${msg.params[0] ?? "tmi.twitch.tv"}`);
        return;
      case "RECONNECT":
        this.disconnect();
        this.scheduleReconnect();
        return;
      case "001": // welcome — authenticated as guest
        this.connected = true;
        this.since = Date.now();
        this.lastError = null;
        this.backoff = 1000;
        this.emit();
        return;
      case "PRIVMSG":
        this.onPrivmsg(msg);
        return;
      case "USERNOTICE":
        this.onUsernotice(msg);
        return;
      case "NOTICE":
        if (/login|auth|banned/i.test(msg.params[1] ?? "")) this.lastError = msg.params[1] ?? "notice";
        return;
    }
  }

  private onPrivmsg(msg: IRCMessage) {
    const name = msg.tags["display-name"] || msg.prefix.split("!")[0] || "viewer";
    const text = msg.params[1] ?? "";
    const badges = badgesFromTag(msg.tags["badges"]);
    emitChat(name, text, badges);

    const bits = Number(msg.tags["bits"] ?? 0);
    if (bits > 0) emitEvent({ type: "cheer", name, amount: bits, message: text });
  }

  private onUsernotice(msg: IRCMessage) {
    const t = msg.tags;
    const name = t["display-name"] || t["login"] || "someone";
    const id = t["msg-id"];
    switch (id) {
      case "sub":
      case "resub":
        emitEvent({
          type: "subscription",
          name,
          tier: SUB_TIER[t["msg-param-sub-plan"] ?? "1000"] ?? 1,
          months: Number(t["msg-param-cumulative-months"] ?? 1),
          message: msg.params[1] || undefined,
        });
        return;
      case "subgift":
      case "anonsubgift":
        emitEvent({
          type: "gift_sub",
          name: id === "anonsubgift" ? "Anonymous" : name,
          count: 1,
          message: t["msg-param-recipient-display-name"]
            ? `→ ${t["msg-param-recipient-display-name"]}`
            : undefined,
        });
        return;
      case "submysterygift":
      case "anonsubmysterygift":
        emitEvent({
          type: "gift_sub",
          name: id.startsWith("anon") ? "Anonymous" : name,
          count: Number(t["msg-param-mass-gift-count"] ?? 1),
        });
        return;
      case "raid":
        emitEvent({
          type: "raid",
          name: t["msg-param-displayName"] || name,
          count: Number(t["msg-param-viewerCount"] ?? 0),
        });
        return;
    }
  }

  private scheduleReconnect() {
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => this.open(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30000);
  }
  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
  private disconnect() {
    this.manualStop = true;
    this.clearReconnect();
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.connected = false;
    this.since = null;
  }
  private fail(err: string) {
    this.lastError = err;
    this.connected = false;
    this.emit();
    if (this.enabled) this.scheduleReconnect();
  }
  private emit() {
    publish({ kind: "integration", twitch: this.status() });
  }
}

function normalizeChannel(c: string): string {
  return (c || "").trim().toLowerCase().replace(/^#/, "").replace(/[^a-z0-9_]/g, "");
}

export const twitch = new TwitchClient();
