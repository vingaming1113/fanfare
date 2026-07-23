// Real YouTube Live integration via the YouTube Data API v3.
//
// The YouTube analog to the anonymous Twitch connection: provide a Data API key
// (free, from https://console.cloud.google.com) and point Fanfare at a live
// video or channel. It resolves the active live chat and polls it, turning real
// activity into Fanfare events:
//   • chat messages        → chat
//   • Super Chats/Stickers → donation (tip)
//   • new members          → subscription
//   • membership gifts     → gift subs
//
// Polling honors the API's own `pollingIntervalMillis`, and the first fetch is
// used only to seed the cursor so historical backlog doesn't spam the overlay.
import { emitChat, emitEvent } from "./engine.ts";
import { getSetting, setSetting } from "./db.ts";

const API = "https://www.googleapis.com/youtube/v3";

export interface YouTubeConnStatus {
  enabled: boolean;
  connected: boolean;
  target: string;
  video: string | null;
  lastError: string | null;
  since: number | null;
}

export function extractVideoTarget(input: string): { videoId?: string; channelId?: string } {
  const raw = (input || "").trim();
  if (!raw) return {};
  // URLs
  const url = raw.match(/(?:youtu\.be\/|\/live\/|[?&]v=)([a-zA-Z0-9_-]{11})/);
  if (url) return { videoId: url[1] };
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(raw)) return { channelId: raw };
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return { videoId: raw };
  const chan = raw.match(/channel\/(UC[a-zA-Z0-9_-]{22})/);
  if (chan) return { channelId: chan[1] };
  return {};
}

class YouTubeClient {
  private enabled = false;
  private apiKey = "";
  private target = "";
  private videoId: string | null = null;
  private liveChatId: string | null = null;
  private pageToken: string | undefined;
  private connected = false;
  private since: number | null = null;
  private lastError: string | null = null;
  private primed = false;
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  onChange: (() => void) | null = null;

  init() {
    const cfg = getSetting<{ enabled: boolean; apiKey: string; target: string }>("youtube", {
      enabled: false,
      apiKey: "",
      target: "",
    });
    this.enabled = cfg.enabled;
    this.apiKey = cfg.apiKey;
    this.target = cfg.target;
    if (this.enabled && this.apiKey && this.target) this.start();
  }

  status(): YouTubeConnStatus {
    return {
      enabled: this.enabled,
      connected: this.connected,
      target: this.target,
      video: this.videoId,
      lastError: this.lastError,
      since: this.since,
    };
  }

  configure(enabled: boolean, apiKey: string, target: string): YouTubeConnStatus {
    this.stop();
    this.apiKey = (apiKey || "").trim();
    this.target = (target || "").trim();
    this.enabled = enabled && !!this.apiKey && !!this.target;
    setSetting("youtube", { enabled: this.enabled, apiKey: this.apiKey, target: this.target });
    this.lastError = null;
    if (this.enabled) this.start();
    else this.emit();
    return this.status();
  }

  private async start() {
    this.stopped = false;
    this.primed = false;
    this.pageToken = undefined;
    try {
      this.videoId = await this.resolveVideo();
      if (!this.videoId) throw new Error("no live video found for that target");
      this.liveChatId = await this.getLiveChatId(this.videoId);
      if (!this.liveChatId) throw new Error("that video has no active live chat");
      this.connected = true;
      this.since = Date.now();
      this.lastError = null;
      this.emit();
      this.poll();
    } catch (err) {
      this.fail(String((err as Error).message ?? err));
    }
  }

  private async resolveVideo(): Promise<string | null> {
    const { videoId, channelId } = extractVideoTarget(this.target);
    if (videoId) return videoId;
    if (channelId) {
      const j = await this.get(
        `search?part=id&channelId=${channelId}&eventType=live&type=video&maxResults=1`,
      );
      return j.items?.[0]?.id?.videoId ?? null;
    }
    return null;
  }

  private async getLiveChatId(videoId: string): Promise<string | null> {
    const j = await this.get(`videos?part=liveStreamingDetails&id=${videoId}`);
    return j.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
  }

  private async poll() {
    if (this.stopped || !this.liveChatId) return;
    try {
      const params = new URLSearchParams({
        part: "snippet,authorDetails",
        liveChatId: this.liveChatId,
        maxResults: "200",
      });
      if (this.pageToken) params.set("pageToken", this.pageToken);
      const j = await this.get(`liveChat/messages?${params}`);
      this.pageToken = j.nextPageToken;
      if (this.primed) for (const item of j.items ?? []) this.process(item);
      this.primed = true;
      const wait = Math.max(2000, Number(j.pollingIntervalMillis ?? 3000));
      this.timer = setTimeout(() => this.poll(), wait);
    } catch (err) {
      this.fail(String((err as Error).message ?? err));
    }
  }

  private process(item: any) {
    const s = item.snippet ?? {};
    const a = item.authorDetails ?? {};
    const name = a.displayName || "viewer";
    switch (s.type) {
      case "textMessageEvent": {
        const badges: string[] = [];
        if (a.isChatOwner) badges.push("broadcaster");
        if (a.isChatModerator) badges.push("mod");
        if (a.isChatSponsor) badges.push("sub");
        emitChat(name, s.displayMessage ?? "", badges);
        return;
      }
      case "superChatEvent":
        emitEvent({
          type: "donation",
          name,
          amount: Math.round((Number(s.superChatDetails?.amountMicros ?? 0) / 1e6) * 100) / 100,
          message: s.superChatDetails?.userComment || undefined,
        });
        return;
      case "superStickerEvent":
        emitEvent({
          type: "donation",
          name,
          amount: Math.round((Number(s.superStickerDetails?.amountMicros ?? 0) / 1e6) * 100) / 100,
        });
        return;
      case "newSponsorEvent":
        emitEvent({ type: "subscription", name, tier: 1, months: 1, message: "new member" });
        return;
      case "memberMilestoneChatEvent":
        emitEvent({
          type: "subscription",
          name,
          tier: 1,
          months: Number(s.memberMilestoneChatDetails?.memberMonth ?? 1),
        });
        return;
      case "membershipGiftingEvent":
        emitEvent({
          type: "gift_sub",
          name,
          count: Number(s.membershipGiftingDetails?.giftMembershipsCount ?? 1),
        });
        return;
    }
  }

  private async get(path: string): Promise<any> {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${API}/${path}${sep}key=${this.apiKey}`);
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail?.error?.message || `YouTube API ${res.status}`);
    }
    return res.json();
  }

  private fail(err: string) {
    this.lastError = err;
    this.connected = false;
    this.since = null;
    this.emit();
    // Retry connection setup after a cooldown if still enabled.
    if (!this.stopped && this.enabled) {
      this.timer = setTimeout(() => this.start(), 15000);
    }
  }

  private stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.connected = false;
    this.liveChatId = null;
    this.videoId = null;
    this.since = null;
  }

  private emit() {
    this.onChange?.();
  }
}

export const youtube = new YouTubeClient();
