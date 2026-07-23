// SQLite persistence layer backed by Bun's built-in `bun:sqlite`.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import {
  DEFAULT_ALERTS,
  DEFAULT_GENERAL,
  DEFAULT_HYPE,
  type AlertConfig,
  type AlertType,
  type GeneralSettings,
  type HypeSettings,
} from "./config.ts";
import type { ChatMessage, GoalState, PollState, StreamEvent } from "./events.ts";

mkdirSync("data", { recursive: true });

export const db = new Database("data/fanfare.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    type      TEXT    NOT NULL,
    name      TEXT    NOT NULL,
    amount    REAL,
    count     INTEGER,
    months    INTEGER,
    tier      INTEGER,
    message   TEXT,
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    message   TEXT    NOT NULL,
    color     TEXT    NOT NULL,
    badges    TEXT    NOT NULL DEFAULT '[]',
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS viewers (
    name      TEXT PRIMARY KEY,
    points    INTEGER NOT NULL DEFAULT 0,
    minutes   INTEGER NOT NULL DEFAULT 0,
    donated   REAL    NOT NULL DEFAULT 0,
    lastSeen  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS goals (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    kind    TEXT    NOT NULL,
    title   TEXT    NOT NULL,
    current REAL    NOT NULL DEFAULT 0,
    target  REAL    NOT NULL DEFAULT 100,
    active  INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS polls (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    question  TEXT    NOT NULL,
    options   TEXT    NOT NULL,
    votes     TEXT    NOT NULL,
    active    INTEGER NOT NULL DEFAULT 1,
    createdAt INTEGER NOT NULL,
    endsAt    INTEGER
  );
`);

// ---- settings (typed JSON key/value) ----
const getRaw = db.query<{ value: string }, [string]>(
  "SELECT value FROM settings WHERE key = ?",
);
const upsertRaw = db.query(
  "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
);

export function getSetting<T>(key: string, fallback: T): T {
  const row = getRaw.get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  upsertRaw.run(key, JSON.stringify(value));
}

export function getAlerts(): Record<AlertType, AlertConfig> {
  return getSetting("alerts", DEFAULT_ALERTS);
}
export function getGeneral(): GeneralSettings {
  return getSetting("general", DEFAULT_GENERAL);
}
export function getHypeSettings(): HypeSettings {
  return getSetting("hype", DEFAULT_HYPE);
}

// ---- events ----
const insertEvent = db.query<{ id: number }, any[]>(
  `INSERT INTO events (type, name, amount, count, months, tier, message, createdAt)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
);

export function saveEvent(ev: Omit<StreamEvent, "id">): StreamEvent {
  const row = insertEvent.get(
    ev.type,
    ev.name,
    ev.amount ?? null,
    ev.count ?? null,
    ev.months ?? null,
    ev.tier ?? null,
    ev.message ?? null,
    ev.createdAt,
  )!;
  return { ...ev, id: row.id };
}

export function recentEvents(limit = 50): StreamEvent[] {
  return db
    .query<StreamEvent, [number]>(
      "SELECT * FROM events ORDER BY id DESC LIMIT ?",
    )
    .all(limit);
}

export function eventStats(): {
  totals: Record<string, number>;
  tipTotal: number;
  bitsTotal: number;
  count: number;
} {
  const rows = db
    .query<{ type: string; n: number; amt: number }, []>(
      "SELECT type, COUNT(*) n, COALESCE(SUM(amount),0) amt FROM events GROUP BY type",
    )
    .all();
  const totals: Record<string, number> = {};
  let tipTotal = 0;
  let bitsTotal = 0;
  let count = 0;
  for (const r of rows) {
    totals[r.type] = r.n;
    count += r.n;
    if (r.type === "donation") tipTotal += r.amt;
    if (r.type === "cheer") bitsTotal += r.amt;
  }
  return { totals, tipTotal, bitsTotal, count };
}

// ---- chat ----
const insertChat = db.query<{ id: number }, any[]>(
  `INSERT INTO chat (name, message, color, badges, createdAt)
   VALUES (?, ?, ?, ?, ?) RETURNING id`,
);

export function saveChat(m: Omit<ChatMessage, "id">): ChatMessage {
  const row = insertChat.get(
    m.name,
    m.message,
    m.color,
    JSON.stringify(m.badges),
    m.createdAt,
  )!;
  return { ...m, id: row.id };
}

export function recentChat(limit = 30): ChatMessage[] {
  const rows = db
    .query<any, [number]>("SELECT * FROM chat ORDER BY id DESC LIMIT ?")
    .all(limit);
  return rows
    .map((r) => ({ ...r, badges: JSON.parse(r.badges) }))
    .reverse();
}

// Cap table growth — real chat can be high-volume over long streams.
export function pruneOldData(chatKeep = 2000, eventKeep = 5000): void {
  db.query(
    "DELETE FROM chat WHERE id <= (SELECT MAX(id) FROM chat) - ?",
  ).run(chatKeep);
  db.query(
    "DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?",
  ).run(eventKeep);
}

// ---- loyalty / viewers ----
export function addPoints(name: string, points: number, minutes = 0): void {
  db.query(
    `INSERT INTO viewers (name, points, minutes, lastSeen)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(name) DO UPDATE SET
       points = points + ?2,
       minutes = minutes + ?3,
       lastSeen = ?4`,
  ).run(name, points, minutes, Date.now());
}

export function addDonation(name: string, amount: number): void {
  db.query(
    `INSERT INTO viewers (name, donated, lastSeen)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(name) DO UPDATE SET donated = donated + ?2, lastSeen = ?3`,
  ).run(name, amount, Date.now());
}

export interface Viewer {
  name: string;
  points: number;
  minutes: number;
  donated: number;
  lastSeen: number;
}

export function leaderboard(limit = 20): Viewer[] {
  return db
    .query<Viewer, [number]>(
      "SELECT * FROM viewers ORDER BY points DESC LIMIT ?",
    )
    .all(limit);
}

export function topDonors(limit = 10): Viewer[] {
  return db
    .query<Viewer, [number]>(
      "SELECT * FROM viewers WHERE donated > 0 ORDER BY donated DESC LIMIT ?",
    )
    .all(limit);
}

export function getViewer(name: string): Viewer | null {
  return (
    db
      .query<Viewer, [string]>("SELECT * FROM viewers WHERE name = ?")
      .get(name) ?? null
  );
}

// ---- goals ----
export function listGoals(): GoalState[] {
  return db
    .query<any, []>("SELECT * FROM goals ORDER BY id DESC")
    .all()
    .map((g) => ({ ...g, active: !!g.active }));
}

export function getGoal(id: number): GoalState | null {
  const g = db.query<any, [number]>("SELECT * FROM goals WHERE id = ?").get(id);
  return g ? { ...g, active: !!g.active } : null;
}

export function createGoal(
  kind: GoalState["kind"],
  title: string,
  target: number,
): GoalState {
  const row = db
    .query<{ id: number }, any[]>(
      "INSERT INTO goals (kind, title, target) VALUES (?, ?, ?) RETURNING id",
    )
    .get(kind, title, target)!;
  return getGoal(row.id)!;
}

export function updateGoal(id: number, patch: Partial<GoalState>): GoalState | null {
  const g = getGoal(id);
  if (!g) return null;
  const next = { ...g, ...patch };
  db.query(
    "UPDATE goals SET kind=?, title=?, current=?, target=?, active=? WHERE id=?",
  ).run(next.kind, next.title, next.current, next.target, next.active ? 1 : 0, id);
  return getGoal(id);
}

export function bumpGoals(kind: GoalState["kind"], by: number): GoalState[] {
  db.query(
    "UPDATE goals SET current = current + ? WHERE kind = ? AND active = 1",
  ).run(by, kind);
  return db
    .query<any, [string]>(
      "SELECT * FROM goals WHERE kind = ? AND active = 1",
    )
    .all(kind)
    .map((g) => ({ ...g, active: !!g.active }));
}

export function deleteGoal(id: number): void {
  db.query("DELETE FROM goals WHERE id = ?").run(id);
}

// ---- polls ----
function rowToPoll(r: any): PollState {
  const votes: number[] = JSON.parse(r.votes);
  return {
    id: r.id,
    question: r.question,
    options: JSON.parse(r.options),
    votes,
    active: !!r.active,
    totalVotes: votes.reduce((a, b) => a + b, 0),
    createdAt: r.createdAt,
    endsAt: r.endsAt ?? null,
  };
}

export function activePoll(): PollState | null {
  const r = db
    .query<any, []>("SELECT * FROM polls WHERE active = 1 ORDER BY id DESC LIMIT 1")
    .get();
  return r ? rowToPoll(r) : null;
}

export function createPoll(
  question: string,
  options: string[],
  durationSec?: number,
): PollState {
  db.query("UPDATE polls SET active = 0 WHERE active = 1").run();
  const endsAt = durationSec ? Date.now() + durationSec * 1000 : null;
  const row = db
    .query<{ id: number }, any[]>(
      "INSERT INTO polls (question, options, votes, createdAt, endsAt) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .get(
      question,
      JSON.stringify(options),
      JSON.stringify(options.map(() => 0)),
      Date.now(),
      endsAt,
    )!;
  return getPoll(row.id)!;
}

export function getPoll(id: number): PollState | null {
  const r = db.query<any, [number]>("SELECT * FROM polls WHERE id = ?").get(id);
  return r ? rowToPoll(r) : null;
}

export function votePoll(id: number, option: number): PollState | null {
  const poll = getPoll(id);
  if (!poll || !poll.active || option < 0 || option >= poll.votes.length)
    return poll;
  poll.votes[option] = (poll.votes[option] ?? 0) + 1;
  db.query("UPDATE polls SET votes = ? WHERE id = ?").run(
    JSON.stringify(poll.votes),
    id,
  );
  return getPoll(id);
}

export function endPoll(id: number): PollState | null {
  db.query("UPDATE polls SET active = 0 WHERE id = ?").run(id);
  return getPoll(id);
}
