// Demo simulator — generates lifelike chat and events so the overlays and
// dashboard can be showcased without a live Twitch/YouTube connection.
import { emitChat, emitEvent } from "./engine.ts";
import { ALERT_TYPES, type AlertType } from "./config.ts";

const NAMES = [
  "PixelWizard", "NovaByte", "GlitchGremlin", "LootLlama", "ZenPanda",
  "TurboSnail", "CaffeineQueen", "NeonNinja", "BitBard", "SilentSam",
  "CtrlAltDefeat", "MoonMoth", "RiftRider", "QuasarKid", "ByteMeMax",
  "VelvetVortex", "EmberFox", "CyberCactus", "LagLord", "PogChampion",
];

const CHATS = [
  "LETS GOOOO 🔥", "gg", "that was insane", "first!", "PogChamp",
  "no way that just happened", "clip it!", "hi from Brazil 🇧🇷",
  "W stream", "how long have you been live?", "the music slaps",
  "poggers", "KEKW", "can you do the thing again?", "streamer diff",
  "what rank are you?", "love the overlay", "new sub hype!",
  "chat is wild today", "sending good vibes ✨",
];

const MERCH = ["a Fanfare Hoodie", "the Founder's Mug", "a Sticker Pack"];
const REDEMPTIONS = ["Hydrate!", "Song Request", "Highlight My Message", "Emote Only Mode"];

function pick<T>(a: readonly T[]): T {
  return a[Math.floor(Math.random() * a.length)]!;
}
function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomEvent(type: AlertType): void {
  const name = pick(NAMES);
  switch (type) {
    case "follow":
      return void emitEvent({ type, name });
    case "subscription":
      return void emitEvent({
        type, name, tier: pick([1, 1, 1, 2, 3]), months: rand(1, 24),
      });
    case "gift_sub":
      return void emitEvent({ type, name, count: pick([1, 5, 5, 10, 20, 50]) });
    case "donation":
      return void emitEvent({
        type, name, amount: pick([1, 2, 5, 5, 10, 20, 50, 100]),
        message: Math.random() > 0.5 ? pick(CHATS) : undefined,
      });
    case "cheer":
      return void emitEvent({ type, name, amount: pick([100, 200, 500, 1000, 5000]) });
    case "raid":
      return void emitEvent({ type, name, count: rand(5, 850) });
    case "host":
      return void emitEvent({ type, name, count: rand(2, 120) });
    case "merch":
      return void emitEvent({ type, name, message: pick(MERCH) });
    case "redemption":
      return void emitEvent({ type, name, message: pick(REDEMPTIONS) });
  }
}

let chatTimer: ReturnType<typeof setInterval> | null = null;
let eventTimer: ReturnType<typeof setInterval> | null = null;

export function simulatorRunning(): boolean {
  return chatTimer !== null;
}

export function startSimulator(): void {
  if (chatTimer) return;
  chatTimer = setInterval(() => {
    const badges: string[] = [];
    if (Math.random() > 0.7) badges.push("sub");
    if (Math.random() > 0.9) badges.push("mod");
    if (Math.random() > 0.85) badges.push("vip");
    emitChat(pick(NAMES), pick(CHATS), badges);
  }, 1800);
  eventTimer = setInterval(() => {
    // weight towards follows/chat-adjacent, rare big events
    const roll = Math.random();
    const type: AlertType =
      roll < 0.45 ? "follow"
      : roll < 0.65 ? "subscription"
      : roll < 0.78 ? "donation"
      : roll < 0.88 ? "cheer"
      : roll < 0.94 ? "gift_sub"
      : pick(ALERT_TYPES);
    randomEvent(type);
  }, 5000);
}

export function stopSimulator(): void {
  if (chatTimer) clearInterval(chatTimer);
  if (eventTimer) clearInterval(eventTimer);
  chatTimer = null;
  eventTimer = null;
}
