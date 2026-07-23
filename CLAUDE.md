# CLAUDE.md

This project uses a single source of truth for contributor and AI-agent guidance:
**[`AGENTS.md`](./AGENTS.md)**. Read it in full before making changes.

## Non-negotiable

**Check your code for bugs before every commit.** Follow the "Golden rule: verify
before you commit" section in `AGENTS.md`:

1. `bunx tsc --noEmit` — no type errors.
2. Boot the server on a throwaway port and confirm `/api/state` and `/dashboard` respond.
3. Syntax-check any browser modules you edited (`bun build ... --target=browser`).
4. Visually verify any overlay you touched with a headless Chromium screenshot.
5. Re-read your `git diff` against the bug-review checklist in `AGENTS.md`.

If any check fails, fix it before committing. Do not commit unverified code.

Everything else — architecture, constraints (Bun only, zero deps, no build step),
commit conventions, and the project map — lives in `AGENTS.md`.
