# 🎺 Fanfare

**A self-hosted, open-source streaming alerts & widgets platform — a Streamlabs-style suite built entirely on [Bun](https://bun.sh).**

Fanfare gives live streamers everything they need to react to their community in real time: on-screen alerts for follows, subscriptions, gifted subs, tips, bits, raids, hosts, merch and channel-point redemptions — plus a chat box, event ticker, goal bars, a loyalty-points economy, interactive polls, a public tip page, and an original signature feature: the **Hype Train** energy engine.

No SaaS account, no cloud lock-in. One Bun process serves the control-panel dashboard, the REST API, the realtime WebSocket, and every OBS browser-source overlay.

---

## ✨ Features

### Alerts (the Streamlabs core)
- **Every event type:** follow, subscription, gift subs, donation/tip, cheer/bits, raid, host, merch, redemption.
- **Fully customizable per type:** message template, accent & text color, on-screen duration, entrance animation (slide / fade / pop / wipe), minimum amount filter, and a **synthesized sound** (no audio files needed — tones are generated in the browser with the Web Audio API).
- **Queued playback** so simultaneous events never overlap.
- **`?demo=<type>`** preview mode to position the box in OBS without waiting for a real event.

### Widgets (OBS browser sources)
| Widget | URL | Notes |
| --- | --- | --- |
| Alert Box | `/overlay/alertbox` | all alerts |
| Chat Box | `/overlay/chatbox` | `?max=12` |
| Event List | `/overlay/eventlist` | `?max=10` recent events |
| Goal | `/overlay/goal` | active goal, or `?id=<goalId>` |
| Hype Train | `/overlay/hype` | signature feature |
| Poll | `/overlay/poll` | live audience poll |
| Leaderboard | `/overlay/leaderboard` | `?mode=points` or `?mode=donors` |

Append `?bg=1` to any overlay to preview it on a checkerboard background.

### 🔴 Real platform integrations (Twitch + YouTube)
Point Fanfare at a live channel and **real activity** flows straight into your
alerts, goals, hype train and loyalty system. Configure everything on the
dashboard's **Connect** tab.

**Twitch — anonymous, zero-setup.** Connects to Twitch chat over an
**anonymous, read-only IRC-over-WebSocket** guest session — **no OAuth, no API
key, no bot account.** Just type a channel name and hit Connect.

**Twitch follows — optional login.** Follows are the one event Twitch does *not*
expose anonymously, so Fanfare adds an opt-in **OAuth + EventSub** layer just for
them. Register a free app at [dev.twitch.tv](https://dev.twitch.tv/console/apps)
(OAuth redirect `<your-origin>/auth/twitch/callback`), provide its Client ID/Secret
via the dashboard or `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` env vars, then
click **Login with Twitch**. Fanfare subscribes to `channel.follow` (v2) and keeps
the token refreshed.

**YouTube Live — API key.** Provide a free
[YouTube Data API key](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
and a live video URL / ID (or channel ID). Fanfare resolves the active live chat
and polls it, honoring the API's own polling interval.

| Event | Twitch | YouTube |
| --- | --- | --- |
| Chat messages | ✅ anonymous | ✅ API key |
| Subscriptions / memberships | ✅ anonymous | ✅ API key |
| Gift subs / gifted memberships | ✅ anonymous | ✅ API key |
| Raids | ✅ anonymous | — |
| Bits / Super Chats | ✅ anonymous | ✅ API key |
| Follows | ✅ **login (EventSub)** | — |
| Tips | ✅ `/tip` page or `POST /api/tip` | ✅ same |

All connectors auto-reconnect with backoff and survive long streams.

### 🚂 Hype Train — the original feature
A real-time **community energy engine**. Every event injects weighted "energy" into a live meter that **decays every second**, so the train only keeps rolling while the community stays active. Fill the meter to level up — each level extends the window and escalates the on-screen celebration (screen shake, confetti burst, sound). If the timer runs out before the next level, the train "leaves the station" and resets. The channel's **all-time record level** is tracked and celebrated when beaten. Every weight and threshold is tunable from the dashboard.

### Goals, Loyalty, Polls & Tips
- **Goals:** follower / sub / donation / bits goal bars that auto-advance from live events.
- **Loyalty economy:** viewers earn channel points (name & rate configurable) for chatting and supporting; a leaderboard and top-tippers board are exposed as overlays.
- **Polls:** launch a question with 2+ options and an optional timer; results animate live on the overlay.
- **Public Tip Page** (`/tip`): a shareable page where viewers send a tip that instantly fires an alert on stream (demo mode — no real payment processing).

### Dashboard control panel (`/dashboard`)
Overview stats + live event/chat feeds, per-type alert editor with sound preview, goal manager, live Hype Train controls & tuning, poll launcher, loyalty tables, copy-paste widget URLs, and channel settings — plus a **built-in event Simulator** to demo the whole system with lifelike traffic.

---

## 🚀 Getting started

Requires [Bun](https://bun.sh) `>= 1.1`.

```bash
git clone https://github.com/vingaming1113/fanfare.git
cd fanfare
bun install        # (no runtime deps, but sets up the project)
bun start          # or: bun run dev  (watch mode)
```

Then open **http://localhost:4700/dashboard**.

Open the **Connect** tab and enter a Twitch channel to go live with real events, or click **▶ Demo Simulator** in the top right to watch alerts, chat, goals and the Hype Train come alive with fake traffic. The **Quick Test Alerts** buttons fire individual sample alerts.

Set a custom port with `PORT=8080 bun start`.

---

## 🧩 Adding overlays to OBS / Streamlabs

1. In the dashboard, open **Widgets** and copy a browser-source URL (e.g. `http://localhost:4700/overlay/alertbox`).
2. In OBS: **Sources → + → Browser**, paste the URL, set the size, done.
3. Overlays have transparent backgrounds and update instantly over WebSocket.

---

## 🛠️ Architecture

```
src/
  server.ts     Bun.serve — HTTP routes, static serving, WebSocket fan-out
  api.ts        REST API router (/api/*)
  engine.ts     domain engine: events → persistence, loyalty, goals, hype, broadcast
  twitch.ts     anonymous Twitch IRC connector + event parser
  eventsub.ts   Twitch OAuth + EventSub (authenticated follow alerts)
  youtube.ts    YouTube Live connector (chat, Super Chats, memberships)
  integrations.ts  merges connector statuses and broadcasts them
  hype.ts       Hype Train energy engine (the original feature)
  db.ts         bun:sqlite persistence (settings, events, chat, viewers, goals, polls)
  bus.ts        in-process pub/sub bridged to the WebSocket
  events.ts     shared event/message types + template rendering
  config.ts     defaults (alerts, general, hype tuning)
  simulator.ts  lifelike demo traffic generator
  seed.ts       first-run defaults + starter goals
public/
  dashboard.*   control-panel SPA
  tip.html      public tip page
  overlays/*    OBS browser-source widgets
  shared/       live socket client + Web Audio sound synth + shared CSS
```

- **Runtime:** Bun only — `Bun.serve` for HTTP + WebSocket, `bun:sqlite` for storage. **Zero npm dependencies.**
- **Frontend:** dependency-free ES modules, no build step.
- **Realtime:** one WebSocket topic; the server publishes every domain event to all connected overlays and dashboards.

### REST API (selected)
```
GET  /api/state                aggregate boot state
GET/PUT /api/config[/general|alerts|hype]
POST /api/events               emit an event
POST /api/test/:type           emit a randomized test event
POST /api/chat                 post a chat message
GET  /api/leaderboard | /api/donors
GET/POST/PUT/DELETE /api/goals[/:id]
GET  /api/hype   POST /api/hype/{boost,reset}
GET/POST /api/poll   POST /api/poll/:id/{vote,end}
POST /api/tip                  public tip (fires a donation alert)
GET  /api/integrations              Twitch + YouTube connection status
POST /api/integrations/twitch       { enabled, channel } — anonymous connect
POST /api/integrations/twitch/app   { clientId, clientSecret } — EventSub app
POST /api/integrations/twitch/logout
GET  /auth/twitch/login             begin OAuth (redirect)
GET  /auth/twitch/callback          OAuth redirect target
POST /api/integrations/youtube      { enabled, apiKey, target }
POST /api/sim/{start,stop}          demo simulator
```

---

## 🗺️ Notes & roadmap

Fanfare works with **real Twitch and YouTube activity today**: anonymous Twitch
chat/subs/gifts/raids/bits, authenticated Twitch follows via EventSub, and YouTube
live chat / Super Chats / memberships — plus a built-in **Demo Simulator** for
testing without a live channel. The event pipeline is provider-agnostic: every
source just calls `emitEvent(...)` / `emitChat(...)`.

On the roadmap:
- **Real tip processing** (Stripe / PayPal / Ko-fi webhooks) — the `/tip` page and
  `POST /api/tip` webhook already model the flow end-to-end.
- **Kick / TikTok Live** connectors following the same pattern.
- **Optional dashboard auth** for exposed/hosted deployments.

## License

MIT © vingaming1113
