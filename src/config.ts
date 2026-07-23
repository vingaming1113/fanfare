// Fanfare — central configuration & default settings.
// These defaults seed the settings store on first run and can be edited
// live from the dashboard (persisted to SQLite).

export const APP = {
  name: "Fanfare",
  tagline: "Self-hosted alerts, widgets & hype for live streamers",
  version: "1.0.0",
} as const;

export const PORT = Number(process.env.PORT ?? 4700);

// All alert types the platform understands.
export const ALERT_TYPES = [
  "follow",
  "subscription",
  "gift_sub",
  "donation",
  "cheer",
  "raid",
  "host",
  "merch",
  "redemption",
] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

// Per-alert presentation config. `{name}`, `{amount}`, `{months}`, `{count}`,
// `{tier}`, `{message}` are interpolated into the message template.
export interface AlertConfig {
  enabled: boolean;
  layout: "top" | "side"; // image position relative to text
  message: string; // template
  accent: string; // hex color
  textColor: string;
  duration: number; // ms the alert stays on screen
  sound: string; // key into SOUND library (client-generated tones)
  soundVolume: number; // 0..1
  minAmount?: number; // for donation/cheer: only alert above this
  animationIn: "slide" | "fade" | "pop" | "wipe";
}

const base = (over: Partial<AlertConfig>): AlertConfig => ({
  enabled: true,
  layout: "top",
  message: "{name}",
  accent: "#a970ff",
  textColor: "#ffffff",
  duration: 6000,
  sound: "chime",
  soundVolume: 0.6,
  animationIn: "slide",
  ...over,
});

export const DEFAULT_ALERTS: Record<AlertType, AlertConfig> = {
  follow: base({
    message: "{name} just followed!",
    accent: "#22d3ee",
    sound: "blip",
    duration: 5000,
  }),
  subscription: base({
    message: "{name} subscribed at Tier {tier}! ({months} months)",
    accent: "#a970ff",
    sound: "chime",
    animationIn: "pop",
  }),
  gift_sub: base({
    message: "{name} gifted {count} subs!",
    accent: "#f472b6",
    sound: "sparkle",
    animationIn: "pop",
  }),
  donation: base({
    message: "{name} tipped {amount}!",
    accent: "#34d399",
    sound: "coins",
    duration: 7000,
    animationIn: "wipe",
  }),
  cheer: base({
    message: "{name} cheered {amount} bits!",
    accent: "#fbbf24",
    sound: "coins",
  }),
  raid: base({
    message: "{name} raided with {count} viewers!",
    accent: "#fb7185",
    sound: "airhorn",
    duration: 8000,
    animationIn: "wipe",
  }),
  host: base({
    message: "{name} hosted with {count} viewers!",
    accent: "#60a5fa",
    sound: "blip",
  }),
  merch: base({
    message: "{name} bought {message}!",
    accent: "#c084fc",
    sound: "sparkle",
  }),
  redemption: base({
    message: "{name} redeemed {message}",
    accent: "#f59e0b",
    sound: "blip",
    duration: 5000,
  }),
};

export interface GeneralSettings {
  channelName: string;
  currency: string; // display symbol for tips, e.g. "$"
  pointsName: string; // loyalty currency name, e.g. "Sparks"
  pointsPerMinute: number; // loyalty accrual for active chatters
  theme: string; // dashboard accent theme
}

export const DEFAULT_GENERAL: GeneralSettings = {
  channelName: "vingaming1113",
  currency: "$",
  pointsName: "Sparks",
  pointsPerMinute: 10,
  theme: "#a970ff",
};

// Hype Train tuning — the original signature feature.
export interface HypeSettings {
  enabled: boolean;
  decayPerSecond: number; // energy lost each second
  levelSize: number; // energy required per level
  maxLevel: number;
  windowSeconds: number; // time allowed to reach the next level before the train leaves
  weights: Record<AlertType | "chat", number>; // energy contribution per event
}

export const DEFAULT_HYPE: HypeSettings = {
  enabled: true,
  decayPerSecond: 2,
  levelSize: 100,
  maxLevel: 5,
  windowSeconds: 60,
  weights: {
    chat: 1,
    follow: 8,
    subscription: 35,
    gift_sub: 30,
    donation: 4, // multiplied by amount at runtime
    cheer: 1, // multiplied by (bits/100)
    raid: 25,
    host: 10,
    merch: 20,
    redemption: 5,
  },
};
