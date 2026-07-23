# AGENTS.md

Guidance for AI coding agents (and humans) contributing to **Fanfare**.

Fanfare is a self-hosted, Streamlabs-style streaming alerts & widgets platform built on **Bun** with **zero runtime dependencies** and **no build step**. Keep it that way unless there is a very good reason not to.

---

## 🚦 Golden rule: verify before you commit

**Every agent MUST check its own code for bugs before creating a commit.** A commit is only allowed after the checks below pass. Do not commit "hopeful" code, half-finished edits, or anything you have not actually run.

### Required pre-commit checklist

Run these from the repo root and make sure they succeed (run `bun install` once
first so the dev-only TypeScript types are present — the runtime has no deps):

```bash
# 1. Type-check the whole backend (must report no errors)
bunx tsc --noEmit

# 2. Boot the server on a throwaway port and confirm it starts + serves
PORT=4799 bun run src/server.ts & SF=$!; sleep 2
curl -fsS localhost:4799/api/state > /dev/null && echo "API OK"
curl -fsS localhost:4799/dashboard > /dev/null && echo "dashboard OK"
kill $SF

# 3. Syntax-check any browser modules you touched (imports are runtime-only)
bun build public/shared/sf.js --target=browser --outfile /tmp/_check.js
bun build public/dashboard.js --target=browser --external='/shared/sf.js' --outfile /tmp/_check2.js
```

If you changed a widget or overlay, **visually verify it** with headless Chromium and actually look at the screenshot before committing:

```bash
chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --virtual-time-budget=3000 --window-size=900,500 \
  --screenshot=/tmp/widget.png "http://localhost:4799/overlay/<name>?bg=1"
```

### Bug review — read your own diff

Before committing, re-read `git diff` and confirm none of these are present:

- [ ] No `console.log` / debug leftovers, no commented-out dead code.
- [ ] No hardcoded secrets, tokens, absolute machine paths, or personal data.
- [ ] All `await`ed calls are actually `async`; no unhandled promise rejections.
- [ ] No unbounded loops, intervals without cleanup, or memory that grows forever (widgets run for hours in OBS — cap arrays/DOM nodes).
- [ ] User-supplied strings rendered in the DOM go through `escapeHtml` (see `public/shared/sf.js`). Never `innerHTML` raw input.
- [ ] SQL uses parameterized queries only (never string-concatenate values into SQL).
- [ ] New API routes validate input and return a sensible status code.
- [ ] Numbers from requests/inputs are coerced (`+x` / `Number(x)`) and range-checked.
- [ ] Overlay progress/width state is set **directly** (not only via `requestAnimationFrame`) so first paint is reliable.
- [ ] No new npm/runtime dependency was added without explicit approval.

If any box can't be checked, **fix it before committing.**

---

## Commit conventions

- **One logical change per commit.** Do not batch unrelated work.
- Use Conventional Commit prefixes: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`.
  - Optionally scope it: `feat(overlay): ...`, `fix(api): ...`, `feat(hype): ...`.
- Write imperative, specific subjects ("add poll end endpoint", not "updates").
- Only commit, push, or open PRs when the task explicitly calls for it.
- Never commit the `data/` directory, `*.sqlite*` files, or `node_modules/` (already in `.gitignore`).

---

## Project map

```
src/
  server.ts     Bun.serve — HTTP routes, static serving, WebSocket fan-out
  api.ts        REST API router (/api/*)
  engine.ts     events → persistence, loyalty, goals, hype, broadcast
  twitch.ts     anonymous Twitch IRC connector + event parser
  eventsub.ts   Twitch OAuth + EventSub (authenticated follow alerts)
  youtube.ts    YouTube Live connector (chat, Super Chats, memberships)
  integrations.ts  merges connector statuses and broadcasts them
  hype.ts       Hype Train energy engine (signature feature)
  db.ts         bun:sqlite persistence
  bus.ts        in-process pub/sub bridged to the WebSocket
  events.ts     shared types + template rendering (incl. escapeHtml usage)
  config.ts     defaults (alerts, general, hype tuning)
  simulator.ts  demo traffic generator
  seed.ts       first-run defaults + starter goals
public/
  dashboard.*   control-panel SPA
  tip.html      public tip page
  overlays/*    OBS browser-source widgets
  shared/       live socket client + Web Audio sound synth + shared CSS
```

## Conventions & constraints

- **Runtime:** Bun only — `Bun.serve`, `bun:sqlite`. No Express, no ORM, no bundler.
- **Frontend:** dependency-free ES modules loaded directly by the browser. Import shared helpers from `/shared/sf.js`. No frameworks.
- **Realtime:** the server owns one WebSocket topic; publish domain changes through `src/bus.ts` (`publish(...)`) so all overlays/dashboards update. Add new message shapes to the `SocketMessage` union in `src/events.ts`.
- **Persistence:** all writes go through `src/db.ts`. New settings live in the JSON `settings` key/value store; new entities get their own table + typed helpers.
- **Types:** strict TypeScript. Keep shared shapes in `events.ts` / `config.ts`; no `any` in new public APIs.
- **Overlays** must have transparent backgrounds, support `?bg=1` preview, and never assume they just loaded (they may connect mid-stream — hydrate from REST, then live-update over WS).

## How to run

```bash
bun start        # http://localhost:4700/dashboard
bun run dev      # watch mode
PORT=8080 bun start
```

Use the dashboard's **Start Simulator** button or the `/api/test/:type` endpoints to exercise the system without a live platform connection.
