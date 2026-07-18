# Sonar

A Discord music bot with a live web dashboard. Play, skip, pause, and manage the queue from Discord slash commands or from the browser — both stay in sync in real time over WebSockets.

## Stack

- **Backend** (`backend/`): Node.js, TypeScript, Express, discord.js v14, discord-player, socket.io, JWT auth.
- **Frontend** (`frontend/`): Vite, React 18, TypeScript, react-router-dom, socket.io-client.
- pnpm workspaces monorepo.

## Features

- Discord OAuth2 login, admin-only access per guild.
- Slash commands: `/play`, `/skip`, `/pause`, `/resume`, `/queue`, `/volume`, `/remove`, `/shuffle`, `/stop`.
- Web dashboard with the same controls, synced live via socket.io — no manual refresh, ever.
- Single source of truth: both the bot and the REST API drive the same `queueService`, backed by discord-player's `GuildQueue`.

## Setup

1. `pnpm install`
2. Get your own Discord app tokens (Developer Portal) and copy `backend/.env.example` → `backend/.env`, `frontend/.env.example` → `frontend/.env`.
3. `pnpm dev:backend` — Express API + bot + WebSocket server.
4. `pnpm --filter backend deploy-commands` — register slash commands to a test guild.
5. `pnpm --filter frontend dev` — dashboard.

## Testing

```bash
pnpm test:backend        # 141 tests
pnpm --filter frontend test   # 50 tests
```

## Deploying

Free-tier deploy guide (Render + Vercel): [`docs/deploy.md`](docs/deploy.md).

## Project docs

Design spec and implementation plans live under `docs/superpowers/` — every phase (auth, real-time sync, playback controls, deploy) has its own addendum documenting the architecture decisions behind it.
