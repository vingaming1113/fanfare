// Domain engine: turns raw inputs (alerts, chat, tips, votes) into persisted
// state, loyalty rewards, goal progress, hype energy, and broadcasts.
import { publish } from "./bus.ts";
import {
  addDonation,
  addPoints,
  bumpGoals,
  getGeneral,
  saveChat,
  saveEvent,
} from "./db.ts";
import { HypeEngine } from "./hype.ts";
import {
  randomColor,
  type ChatMessage,
  type GoalState,
  type StreamEvent,
} from "./events.ts";
import type { AlertType } from "./config.ts";

// Loyalty rewards granted to the actor for each event type.
const POINT_REWARDS: Record<AlertType, number> = {
  follow: 50,
  subscription: 500,
  gift_sub: 300,
  donation: 0, // computed from amount
  cheer: 0, // computed from bits
  raid: 200,
  host: 100,
  merch: 250,
  redemption: 0,
};

export const hype = new HypeEngine((state) => publish({ kind: "hype", state }));

export interface EmitInput {
  type: AlertType;
  name: string;
  amount?: number;
  count?: number;
  months?: number;
  tier?: number;
  message?: string;
}

export function emitEvent(input: EmitInput): StreamEvent {
  const event = saveEvent({ ...input, createdAt: Date.now() });

  // Loyalty
  let points = POINT_REWARDS[input.type] ?? 0;
  if (input.type === "donation") points += Math.round((input.amount ?? 0) * 100);
  if (input.type === "cheer") points += Math.round(input.amount ?? 0);
  if (points > 0) addPoints(input.name, points);
  if (input.type === "donation") addDonation(input.name, input.amount ?? 0);

  // Goals
  const touched: GoalState[] = [];
  switch (input.type) {
    case "follow":
      touched.push(...bumpGoals("follower", 1));
      break;
    case "subscription":
      touched.push(...bumpGoals("sub", 1));
      break;
    case "gift_sub":
      touched.push(...bumpGoals("sub", input.count ?? 1));
      break;
    case "donation":
      touched.push(...bumpGoals("donation", input.amount ?? 0));
      break;
    case "cheer":
      touched.push(...bumpGoals("bits", input.amount ?? 0));
      break;
  }

  // Hype
  hype.contribute(
    input.name,
    hype.energyFor(input.type, input.amount ?? 0, input.count ?? 1),
  );

  publish({ kind: "alert", event });
  for (const g of touched) publish({ kind: "goal", goal: g });
  return event;
}

export function emitChat(
  name: string,
  message: string,
  badges: string[] = [],
): ChatMessage {
  const chat = saveChat({
    name,
    message,
    color: randomColor(name),
    badges,
    createdAt: Date.now(),
  });

  const g = getGeneral();
  addPoints(name, Math.max(1, Math.round(g.pointsPerMinute / 5)));
  hype.contribute(name, hype.energyFor("chat"));

  publish({ kind: "chat", message: chat });
  return chat;
}
