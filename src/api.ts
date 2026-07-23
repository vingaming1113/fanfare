// REST API router. Returns a Response for any /api/* path, or null if the
// path is not an API route (so the server can fall through to static files).
import {
  ALERT_TYPES,
  type AlertType,
  type GeneralSettings,
  type HypeSettings,
} from "./config.ts";
import {
  activePoll,
  createGoal,
  createPoll,
  deleteGoal,
  endPoll,
  eventStats,
  getAlerts,
  getGeneral,
  getHypeSettings,
  leaderboard,
  listGoals,
  recentChat,
  recentEvents,
  setSetting,
  topDonors,
  updateGoal,
  votePoll,
} from "./db.ts";
import { emitChat, emitEvent, hype, type EmitInput } from "./engine.ts";
import { publish } from "./bus.ts";
import {
  randomEvent,
  simulatorRunning,
  startSimulator,
  stopSimulator,
} from "./simulator.ts";

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

const bad = (msg: string, status = 400): Response => json({ error: msg }, status);

async function body<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export async function handleApi(req: Request, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith("/api/")) return null;
  const seg = path.slice(5).split("/").filter(Boolean); // e.g. ["goals","3"]
  const method = req.method;

  // ---- aggregate state (dashboard boot) ----
  if (seg[0] === "state" && method === "GET") {
    return json({
      general: getGeneral(),
      alerts: getAlerts(),
      hypeSettings: getHypeSettings(),
      hype: hype.state(),
      goals: listGoals(),
      poll: activePoll(),
      stats: eventStats(),
      events: recentEvents(30),
      chat: recentChat(30),
      leaderboard: leaderboard(10),
      donors: topDonors(10),
      simulator: simulatorRunning(),
      alertTypes: ALERT_TYPES,
    });
  }

  // ---- config ----
  if (seg[0] === "config") {
    if (method === "GET")
      return json({
        general: getGeneral(),
        alerts: getAlerts(),
        hype: getHypeSettings(),
      });
    if (method === "PUT" && seg[1] === "general") {
      const b = await body<GeneralSettings>(req);
      setSetting("general", { ...getGeneral(), ...b });
      publish({ kind: "config", scope: "general" });
      return json(getGeneral());
    }
    if (method === "PUT" && seg[1] === "alerts") {
      const b = await body<Record<AlertType, unknown>>(req);
      setSetting("alerts", { ...getAlerts(), ...b });
      publish({ kind: "config", scope: "alerts" });
      return json(getAlerts());
    }
    if (method === "PUT" && seg[1] === "hype") {
      const b = await body<HypeSettings>(req);
      setSetting("hype", { ...getHypeSettings(), ...b });
      publish({ kind: "config", scope: "hype" });
      return json(getHypeSettings());
    }
  }

  // ---- events ----
  if (seg[0] === "events") {
    if (method === "GET") return json(recentEvents(Number(url.searchParams.get("limit") ?? 50)));
    if (method === "POST") {
      const b = await body<EmitInput>(req);
      if (!b.type || !ALERT_TYPES.includes(b.type)) return bad("invalid event type");
      if (!b.name) b.name = "Anonymous";
      return json(emitEvent(b));
    }
  }

  // ---- test alert (random data of a given type) ----
  if (seg[0] === "test" && method === "POST" && seg[1]) {
    const type = seg[1] as AlertType;
    if (!ALERT_TYPES.includes(type)) return bad("unknown alert type");
    randomEvent(type);
    return json({ ok: true, type });
  }

  // ---- stats ----
  if (seg[0] === "stats" && method === "GET") return json(eventStats());

  // ---- chat ----
  if (seg[0] === "chat") {
    if (method === "GET") return json(recentChat(Number(url.searchParams.get("limit") ?? 30)));
    if (method === "POST") {
      const b = await body<{ name: string; message: string; badges?: string[] }>(req);
      if (!b.message) return bad("message required");
      return json(emitChat(b.name || "Anonymous", b.message, b.badges ?? []));
    }
  }

  // ---- loyalty ----
  if (seg[0] === "leaderboard" && method === "GET")
    return json(leaderboard(Number(url.searchParams.get("limit") ?? 20)));
  if (seg[0] === "donors" && method === "GET")
    return json(topDonors(Number(url.searchParams.get("limit") ?? 10)));

  // ---- goals ----
  if (seg[0] === "goals") {
    if (method === "GET") return json(listGoals());
    if (method === "POST") {
      const b = await body<{ kind: any; title: string; target: number }>(req);
      if (!b.title || !b.target) return bad("title and target required");
      const g = createGoal(b.kind ?? "donation", b.title, Number(b.target));
      publish({ kind: "goal", goal: g });
      return json(g);
    }
    if (seg[1]) {
      const id = Number(seg[1]);
      if (method === "PUT") {
        const b = await body(req);
        const g = updateGoal(id, b);
        if (!g) return bad("goal not found", 404);
        publish({ kind: "goal", goal: g });
        return json(g);
      }
      if (method === "DELETE") {
        deleteGoal(id);
        return json({ ok: true });
      }
    }
  }

  // ---- hype ----
  if (seg[0] === "hype") {
    if (method === "GET") return json(hype.state());
    if (method === "POST" && seg[1] === "reset") {
      hype.reset();
      return json(hype.state());
    }
    if (method === "POST" && seg[1] === "boost") {
      // manual energy injection (streamer-triggered hype)
      const b = await body<{ energy?: number }>(req);
      hype.contribute("Streamer", Number(b.energy ?? 40));
      return json(hype.state());
    }
  }

  // ---- polls ----
  if (seg[0] === "poll") {
    if (method === "GET") return json(activePoll());
    if (method === "POST" && !seg[1]) {
      const b = await body<{ question: string; options: string[]; duration?: number }>(req);
      if (!b.question || !Array.isArray(b.options) || b.options.length < 2)
        return bad("question and at least 2 options required");
      const p = createPoll(b.question, b.options, b.duration);
      publish({ kind: "poll", poll: p });
      return json(p);
    }
    if (seg[1] && seg[2] === "vote" && method === "POST") {
      const b = await body<{ option: number }>(req);
      const p = votePoll(Number(seg[1]), Number(b.option));
      if (p) publish({ kind: "poll", poll: p });
      return json(p);
    }
    if (seg[1] && seg[2] === "end" && method === "POST") {
      const p = endPoll(Number(seg[1]));
      publish({ kind: "poll", poll: null });
      return json(p);
    }
  }

  // ---- public tip endpoint ----
  if (seg[0] === "tip" && method === "POST") {
    const b = await body<{ name: string; amount: number; message?: string }>(req);
    const amount = Number(b.amount);
    if (!amount || amount <= 0) return bad("amount must be positive");
    const ev = emitEvent({
      type: "donation",
      name: b.name?.trim() || "Anonymous",
      amount,
      message: b.message?.slice(0, 200),
    });
    return json({ ok: true, event: ev });
  }

  // ---- simulator control ----
  if (seg[0] === "sim" && method === "POST") {
    if (seg[1] === "start") startSimulator();
    else if (seg[1] === "stop") stopSimulator();
    else return bad("use /api/sim/start or /api/sim/stop");
    return json({ running: simulatorRunning() });
  }

  return bad("not found", 404);
}
