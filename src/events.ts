// Shared event & message shapes used across the server and passed to widgets
// over WebSocket.
import type { AlertType } from "./config.ts";

export interface StreamEvent {
  id: number;
  type: AlertType;
  name: string; // actor username
  amount?: number; // tip amount / bits
  count?: number; // gift sub count / raid viewers
  months?: number; // sub streak
  tier?: number; // sub tier
  message?: string; // user message / merch name / redemption title
  createdAt: number; // epoch ms
}

export interface ChatMessage {
  id: number;
  name: string;
  message: string;
  color: string;
  badges: string[]; // e.g. ["mod","sub","vip"]
  createdAt: number;
}

export interface TwitchStatus {
  enabled: boolean;
  channel: string;
  connected: boolean; // anonymous IRC chat/events connection
  lastError: string | null;
  since: number | null; // epoch ms connection established
  // Authenticated (OAuth + EventSub) layer — unlocks follows.
  appConfigured: boolean; // client id/secret present
  authed: boolean; // user has logged in
  login: string | null; // authenticated broadcaster login
  followsLive: boolean; // EventSub follow subscription active
}

export interface YouTubeStatus {
  enabled: boolean;
  connected: boolean;
  target: string; // channel/video the user entered
  video: string | null; // resolved live video id
  lastError: string | null;
  since: number | null;
}

export interface IntegrationStatus {
  twitch: TwitchStatus;
  youtube: YouTubeStatus;
}

// Every message pushed to widgets/dashboard over the socket.
export type SocketMessage =
  | { kind: "hello"; channel: string }
  | { kind: "alert"; event: StreamEvent }
  | { kind: "chat"; message: ChatMessage }
  | { kind: "goal"; goal: GoalState }
  | { kind: "hype"; state: HypeState }
  | { kind: "poll"; poll: PollState | null }
  | { kind: "integration"; twitch: TwitchStatus; youtube: YouTubeStatus }
  | { kind: "config"; scope: string };

export interface GoalState {
  id: number;
  kind: "donation" | "follower" | "sub" | "bits";
  title: string;
  current: number;
  target: number;
  active: boolean;
}

export interface HypeState {
  active: boolean;
  level: number;
  maxLevel: number;
  progress: number; // 0..1 toward next level
  energy: number; // raw energy in the current level
  levelSize: number;
  expiresAt: number | null; // epoch ms the window closes
  topContributor: { name: string; total: number } | null;
  allTimeRecordLevel: number;
}

export interface PollState {
  id: number;
  question: string;
  options: string[];
  votes: number[];
  active: boolean;
  totalVotes: number;
  createdAt: number;
  endsAt: number | null;
}

const COLORS = [
  "#ff4d4d", "#ffa64d", "#ffe14d", "#7dff4d", "#4dffd2",
  "#4da6ff", "#7d4dff", "#e04dff", "#ff4da6",
];

export function randomColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

export function renderTemplate(
  tpl: string,
  ev: Partial<StreamEvent>,
  currency = "$",
): string {
  return tpl
    .replaceAll("{name}", ev.name ?? "Someone")
    .replaceAll("{amount}", ev.amount != null ? `${currency}${ev.amount}` : "")
    .replaceAll("{count}", String(ev.count ?? ""))
    .replaceAll("{months}", String(ev.months ?? 1))
    .replaceAll("{tier}", String(ev.tier ?? 1))
    .replaceAll("{message}", ev.message ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
