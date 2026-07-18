# Deploying to free-tier hosting

Backend + Discord bot on [Render](https://render.com) (free web service), frontend on [Vercel](https://vercel.com) (free static hosting). No CI/CD — this is a manual, one-time-per-environment flow.

## Prerequisites

- This repo pushed to a GitHub (or GitLab/Bitbucket) remote — both Render and Vercel deploy from a connected Git repo.
- A free Render account and a free Vercel account.
- Your own Discord app tokens (see the local setup guide for how to get `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`).

## 1. Push to GitHub

If you haven't already:

```bash
git remote add origin <your-repo-url>
git push -u origin master
```

## 2. Deploy the backend on Render

1. Render dashboard → **New** → **Blueprint** → connect your repo. Render detects `render.yaml` at the repo root automatically.
2. You'll be prompted to fill in every variable marked `sync: false`: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `JWT_SECRET` (any long random string), `FRONTEND_URL` (leave a placeholder like `https://placeholder.vercel.app` for now — you'll update it in step 4), `BACKEND_BASE_URL` (leave blank for now too — Render assigns the URL after first deploy, then you fill this in and redeploy).
3. Deploy. Once live, note the assigned URL, e.g. `https://discord-music-backend.onrender.com`.
4. Go back to the service's environment variables and set `BACKEND_BASE_URL` to that exact URL, then trigger a manual redeploy (this value is used to build the OAuth `redirect_uri` and the keepalive ping target).

## 3. Deploy the frontend on Vercel

1. Vercel dashboard → **Add New** → **Project** → import the same repo.
2. **Important:** when Vercel asks for a Root Directory, leave it at the repo root (the default). Do **not** set it to `frontend/` — `vercel.json`'s `outputDirectory` is written relative to the repo root and depends on this.
3. Add environment variable `VITE_BACKEND_URL` = the Render URL from step 2.3 (e.g. `https://discord-music-backend.onrender.com`).
4. Deploy. Note the assigned URL, e.g. `https://your-app.vercel.app`.

## 4. Close the loop: point the backend at the real frontend URL

Back in Render's environment variables, set `FRONTEND_URL` to the Vercel URL from step 3.4, then redeploy. This is what makes CORS and the post-login redirect work.

## 5. Update the Discord OAuth redirect URI

Discord Developer Portal → your app → OAuth2 → General → Redirects → add:

```
https://<your-render-url>/api/auth/callback
```

(exactly matching `BACKEND_BASE_URL` + `/api/auth/callback` — same rule as in local setup, just with the production URL instead of `localhost`.)

## 6. Register slash commands globally

Locally, with your production Discord credentials in a temporary `.env` (or exported in your shell) and **`TEST_GUILD_ID` unset**:

```bash
pnpm --filter backend deploy-commands
```

This registers commands globally (`Routes.applicationCommands`) instead of to a single test guild — propagation to all servers the bot is in can take up to an hour.

## 7. Smoke test

1. Open the Vercel URL, log in with Discord.
2. Join a voice channel in a server where the bot is invited.
3. Play a track from the dashboard, then from `/play` in Discord — confirm both stay in sync.
4. Leave the dashboard tab open for 15+ minutes, confirm the bot is still connected (keepalive should have prevented Render from sleeping it).
