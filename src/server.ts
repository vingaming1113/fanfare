// Fanfare HTTP + WebSocket server (Bun native).
//   • REST API under /api/*
//   • Real-time widget/dashboard updates over /ws
//   • Static dashboard, overlays and public tip page from /public
import { serve, file, type ServerWebSocket } from "bun";
import { APP, PORT } from "./config.ts";
import { handleApi } from "./api.ts";
import { subscribe } from "./bus.ts";
import { hype } from "./engine.ts";
import { activePoll, getGeneral } from "./db.ts";
import { seed } from "./seed.ts";
import type { SocketMessage } from "./events.ts";

seed();
hype.start();

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const WS_TOPIC = "fanfare";

// Friendly routes → static HTML files.
const PAGES: Record<string, string> = {
  "/": "dashboard.html",
  "/dashboard": "dashboard.html",
  "/tip": "tip.html",
  "/overlay/alertbox": "overlays/alertbox.html",
  "/overlay/chatbox": "overlays/chatbox.html",
  "/overlay/eventlist": "overlays/eventlist.html",
  "/overlay/goal": "overlays/goal.html",
  "/overlay/hype": "overlays/hype.html",
  "/overlay/poll": "overlays/poll.html",
  "/overlay/leaderboard": "overlays/leaderboard.html",
};

function staticFile(pathname: string) {
  const mapped = PAGES[pathname];
  if (mapped) return file(PUBLIC + mapped);
  // Prevent path traversal, then serve verbatim from /public.
  const clean = pathname.replace(/\.\.+/g, "").replace(/^\/+/, "");
  if (!clean) return null;
  return file(PUBLIC + clean);
}

const server = serve({
  port: PORT,
  idleTimeout: 120,

  async fetch(req, srv) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      if (srv.upgrade(req)) return undefined;
      return new Response("expected websocket", { status: 426 });
    }

    // REST API
    const api = await handleApi(req, url);
    if (api) return api;

    // Static / pages
    const f = staticFile(url.pathname);
    if (f && (await f.exists())) {
      return new Response(f, {
        headers: { "cache-control": "no-cache" },
      });
    }
    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws: ServerWebSocket) {
      ws.subscribe(WS_TOPIC);
      const hello: SocketMessage = { kind: "hello", channel: getGeneral().channelName };
      ws.send(JSON.stringify(hello));
      // Prime overlays with current live state.
      ws.send(JSON.stringify({ kind: "hype", state: hype.state() } satisfies SocketMessage));
      ws.send(JSON.stringify({ kind: "poll", poll: activePoll() } satisfies SocketMessage));
    },
    message() {
      // Widgets are receive-only; ignore inbound frames.
    },
    close(ws: ServerWebSocket) {
      ws.unsubscribe(WS_TOPIC);
    },
  },
});

// Fan every bus message out to all connected sockets.
subscribe((msg) => server.publish(WS_TOPIC, JSON.stringify(msg)));

console.log(`\n  ${APP.name} — ${APP.tagline}`);
console.log(`  ▸ Dashboard   http://localhost:${server.port}/dashboard`);
console.log(`  ▸ Tip page    http://localhost:${server.port}/tip`);
console.log(`  ▸ Overlays    http://localhost:${server.port}/overlay/alertbox (+ chatbox, eventlist, goal, hype, poll, leaderboard)`);
console.log(`  ▸ WebSocket   ws://localhost:${server.port}/ws\n`);
