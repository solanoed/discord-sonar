# Backend

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | yes | - | Bot token from the Discord Developer Portal |
| `DISCORD_CLIENT_ID` | yes | - | Application (client) ID, used later for OAuth2 and invite links |
| `PORT` | no | `3001` | HTTP port for the Express server |
| `NODE_ENV` | no | `development` | `development`, `production`, or `test` |

Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` before running `pnpm dev`.

## Commands

- `pnpm --filter backend dev` — run with file-watch reload
- `pnpm --filter backend build` — compile to `dist/`
- `pnpm --filter backend start` — run compiled output
- `pnpm --filter backend test` — run the unit test suite
