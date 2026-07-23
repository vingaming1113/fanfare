// Aggregates every real platform connector (Twitch IRC, Twitch EventSub/OAuth,
// YouTube Live) into a single status object and broadcasts changes to widgets.
import { publish } from "./bus.ts";
import { twitch } from "./twitch.ts";
import { twitchAuth } from "./eventsub.ts";
import { youtube } from "./youtube.ts";
import type { IntegrationStatus, TwitchStatus, YouTubeStatus } from "./events.ts";

export function twitchStatus(): TwitchStatus {
  const irc = twitch.status();
  const auth = twitchAuth.status();
  return {
    enabled: irc.enabled,
    channel: irc.channel,
    connected: irc.connected,
    lastError: irc.lastError ?? auth.lastError,
    since: irc.since,
    appConfigured: auth.appConfigured,
    authed: auth.authed,
    login: auth.login,
    followsLive: auth.followsLive,
  };
}

export function youtubeStatus(): YouTubeStatus {
  const y = youtube.status();
  return {
    enabled: y.enabled,
    connected: y.connected,
    target: y.target,
    video: y.video,
    lastError: y.lastError,
    since: y.since,
  };
}

export function integrationStatus(): IntegrationStatus {
  return { twitch: twitchStatus(), youtube: youtubeStatus() };
}

export function broadcastIntegrations(): void {
  publish({ kind: "integration", ...integrationStatus() });
}

/** Wire connector change events to the broadcaster and start them. */
export function initIntegrations(): void {
  twitch.onChange = broadcastIntegrations;
  twitchAuth.onChange = broadcastIntegrations;
  youtube.onChange = broadcastIntegrations;
  twitch.init();
  twitchAuth.init();
  youtube.init();
}
