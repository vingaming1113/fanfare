// Fanfare HTTP + WebSocket server (Bun native).
//   • REST API under /api/*
//   • Real-time widget/dashboard updates over /ws
//   • Static dashboard, overlays and public tip page from /public
import { serve, file, type ServerWebSocket } from "bun";
import { APP, PORT } from "./config.ts";
import { handleApi } from "./api.ts";
import { subscribe } from "./bus.ts";
import { hype } from "./engine.ts";
import { twitchAuth } from "./eventsub.ts";
import { initIntegrations, integrationStatus } from "./integrations.ts";
import { activePoll, getGeneral, pruneOldData } from "./db.ts";
import { seed } from "./seed.ts";
import type { SocketMessage } from "./events.ts";

seed();
hype.start();
initIntegrations();

// Keep the database bounded during long, high-volume real streams.
pruneOldData();
setInterval(pruneOldData, 10 * 60 * 1000);

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

    // Twitch OAuth flow (authenticated follows via EventSub)
    if (url.pathname === "/auth/twitch/login") {
      const dest = twitchAuth.loginUrl(url.origin);
      if (!dest) return new Response("Twitch app not configured", { status: 400 });
      return Response.redirect(dest, 302);
    }
    if (url.pathname === "/auth/twitch/callback") {
      await twitchAuth.handleCallback(
        url.searchParams.get("code") ?? "",
        url.searchParams.get("state") ?? "",
        url.origin,
      );
      return Response.redirect("/dashboard#connect", 302);
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
      ws.send(JSON.stringify({ kind: "integration", ...integrationStatus() } satisfies SocketMessage));
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
