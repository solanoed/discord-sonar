# Deploy Free-Tier (Phase 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app deployable on free-tier hosting (Render for backend+bot, Vercel for frontend) by fixing the cross-site session cookie, adding a self-ping keepalive so Render doesn't sleep the bot's gateway connection, supporting global slash-command registration for production, and providing config files + a manual deploy runbook.

**Architecture:** No structural changes — same single Node process for backend+bot, same Vite-built static frontend. This phase only touches production-readiness details (cookie flags, one new keepalive module, a branch in an existing CLI script) plus two new static config files and one new docs file.

**Tech Stack:** Same as existing project (Node/Express/discord.js backend, vitest). No new runtime dependencies.

## Global Constraints

- No new npm dependencies — `keepAlive.ts` uses the built-in `fetch` (Node 18+, already the project's baseline).
- `AuthRoutesConfig.isProduction` (already exists, already wired to `secure` on the 2 session cookies) is the single source of truth for prod-only cookie behavior — do not read `process.env` directly inside route handlers.
- `deployCommands.ts`'s existing guild-scoped behavior (when `TEST_GUILD_ID` is set) must be unchanged — only the "no `TEST_GUILD_ID`" branch changes from throwing to registering globally.
- Render blueprint fields (verified against Render's current docs, not assumed): `runtime` (not the deprecated `env`), `buildCommand`, `startCommand`, `healthCheckPath`, `rootDir`, `envVars` with `sync: false` for secrets.
- Vercel: Root Directory must stay at the repo root (default) in the dashboard — `vercel.json`'s `outputDirectory`/`buildCommand` are written relative to repo root and would break if Root Directory were changed to `frontend/`. This must be called out explicitly in `docs/deploy.md`.
- `docs/deploy.md` is operational documentation (not a superpowers spec/plan) — plain Markdown, no code changes.

---

### Task 1: Cross-site session cookie (`sameSite`/`secure` by environment)

**Files:**
- Modify: `backend/src/http/routes/authRoutes.ts:27-31` (oauth_state cookie), `:63-68` (session cookie in `/callback`), `:111-116` (session cookie in `/refresh`)
- Test: `backend/src/http/routes/authRoutes.test.ts`

**Interfaces:**
- Consumes: `AuthRoutesConfig.isProduction: boolean` (already exists, already passed in from `index.ts` as `env.NODE_ENV === 'production'` — no change needed there).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/http/routes/authRoutes.test.ts`. This file already has a `config` fixture with `isProduction: false` at the top (line 10-20) and a `buildTestApp()` helper that takes no arguments, always using that module-level `config`. To test the `isProduction: true` case, add a second helper that accepts a config override:

```ts
// Add below the existing buildTestApp() function:
function buildTestAppWithConfig(overrides: Partial<AuthRoutesConfig>) {
  const app = express();
  app.use(cookieParser());
  app.use('/api/auth', createAuthRoutes({ ...config, ...overrides }));
  return app;
}
```

Then add a new `describe` block (anywhere after the existing ones):

```ts
describe('cookie flags in production', () => {
  it('sets sameSite=none and secure=true on the oauth_state cookie', async () => {
    const app = buildTestAppWithConfig({ isProduction: true });

    const response = await request(app).get('/api/auth/login');

    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('oauth_state=');
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Secure');
  });

  it('sets sameSite=none and secure=true on the session cookie after callback', async () => {
    vi.spyOn(discordOAuth, 'exchangeCodeForToken').mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresIn: 604800,
    });
    vi.spyOn(discordOAuth, 'fetchDiscordUser').mockResolvedValue({ id: 'user-1', username: 'tester' });
    vi.spyOn(discordOAuth, 'fetchUserGuilds').mockResolvedValue([
      { id: 'guild-1', name: 'G', owner: true, permissions: '0' },
    ]);

    const app = buildTestAppWithConfig({ isProduction: true });

    const response = await request(app)
      .get('/api/auth/callback?code=abc&state=matching-state')
      .set('Cookie', ['oauth_state=matching-state']);

    const sessionCookie = (response.headers['set-cookie'] as unknown as string[])?.find((c) =>
      c.startsWith('session='),
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('SameSite=None');
    expect(sessionCookie).toContain('Secure');
  });

  it('still uses sameSite=lax and no secure flag when isProduction is false', async () => {
    const app = buildTestApp();

    const response = await request(app).get('/api/auth/login');

    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- authRoutes.test.ts`
Expected: FAIL — the 2 new "production" tests fail because cookies currently always say `SameSite=Lax` with no `Secure` flag, regardless of `isProduction`.

- [ ] **Step 3: Implement the fix**

In `backend/src/http/routes/authRoutes.ts`, change all 3 `res.cookie(...)` calls:

```ts
// Line ~27, in router.get('/login', ...):
res.cookie('oauth_state', state, {
  httpOnly: true,
  sameSite: config.isProduction ? 'none' : 'lax',
  secure: config.isProduction,
  maxAge: OAUTH_STATE_COOKIE_MAX_AGE_MS,
});
```

```ts
// Line ~63, in router.get('/callback', ...):
res.cookie('session', sessionToken, {
  httpOnly: true,
  sameSite: config.isProduction ? 'none' : 'lax',
  secure: config.isProduction,
  maxAge: SESSION_COOKIE_MAX_AGE_MS,
});
```

```ts
// Line ~111, in router.post('/refresh', ...):
res.cookie('session', sessionToken, {
  httpOnly: true,
  sameSite: config.isProduction ? 'none' : 'lax',
  secure: config.isProduction,
  maxAge: SESSION_COOKIE_MAX_AGE_MS,
});
```

(The 2 session-cookie calls already had `secure: config.isProduction` — only `sameSite` changes there. The `oauth_state` cookie gains both `secure` and the conditional `sameSite`, since it previously had neither.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- authRoutes.test.ts`
Expected: PASS, 12 tests total (9 pre-existing + 3 new). Verify with `grep -c "  it(" backend/src/http/routes/authRoutes.test.ts` before trusting this number.

- [ ] **Step 5: Run the full backend suite**

Run: `pnpm --filter backend test`
Expected: all tests pass (139 = 136 pre-existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add backend/src/http/routes/authRoutes.ts backend/src/http/routes/authRoutes.test.ts
git commit -m "fix: use sameSite=none+secure cookies in production for cross-site auth"
```

---

### Task 2: Self-ping keepalive

**Files:**
- Create: `backend/src/keepAlive.ts`
- Test: `backend/src/keepAlive.test.ts`
- Modify: `backend/src/index.ts:39-45` (wire in the call after the HTTP server starts listening)

**Interfaces:**
- Produces: `startKeepAlive(selfUrl: string): void` — consumed only by `index.ts` in this task.

- [ ] **Step 1: Write the failing test**

Create `backend/src/keepAlive.test.ts`:

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { startKeepAlive } from './keepAlive';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startKeepAlive', () => {
  it('pings the health endpoint every 10 minutes', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    startKeepAlive('https://example-backend.onrender.com');

    expect(fetchSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://example-backend.onrender.com/health');

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not throw when the ping fails', () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));

    expect(() => {
      startKeepAlive('https://example-backend.onrender.com');
      vi.advanceTimersByTime(10 * 60 * 1000);
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter backend test -- keepAlive.test.ts`
Expected: FAIL — `./keepAlive` module does not exist yet.

- [ ] **Step 3: Implement `keepAlive.ts`**

Create `backend/src/keepAlive.ts`:

```ts
const PING_INTERVAL_MS = 10 * 60 * 1000;

export function startKeepAlive(selfUrl: string): void {
  setInterval(() => {
    fetch(`${selfUrl}/health`).catch(() => {
      // ignore transient failures; the next interval tries again
    });
  }, PING_INTERVAL_MS);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter backend test -- keepAlive.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Wire into `index.ts`**

In `backend/src/index.ts`, add the import near the other local imports:

```ts
import { startKeepAlive } from './keepAlive';
```

And after the `httpServer.listen(...)` call (currently lines 43-45), add:

```ts
  httpServer.listen(env.PORT, () => {
    console.log(`HTTP server listening on port ${env.PORT}`);
  });

  if (env.NODE_ENV === 'production') {
    startKeepAlive(env.BACKEND_BASE_URL);
  }
```

This one-line conditional call is bootstrap wiring in `main()` — consistent with the rest of `index.ts`, it is not unit-tested directly (the project has no test file for `index.ts`'s `main()` function; `keepAlive.ts` itself is fully tested in Step 1-4).

- [ ] **Step 6: Run the full backend suite and typecheck**

Run: `pnpm --filter backend test && pnpm --filter backend exec tsc -p tsconfig.json --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/keepAlive.ts backend/src/keepAlive.test.ts backend/src/index.ts
git commit -m "feat: add self-ping keepalive to prevent free-tier sleep"
```

---

### Task 3: Global slash-command registration for production

**Files:**
- Modify: `backend/src/deployCommands.ts` (full file replacement — it's short)

**Interfaces:**
- No interfaces consumed/produced beyond what already exists (`loadEnv`, `createCommands`).

- [ ] **Step 1: Implement the dual-mode registration**

Replace the full contents of `backend/src/deployCommands.ts`:

```ts
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadEnv } from './config/env';
import { createCommands } from './commands';

async function main(): Promise<void> {
  const env = loadEnv();
  const commands = createCommands();
  const body = commands.map((command) => command.data.toJSON());
  const rest = new REST().setToken(env.DISCORD_TOKEN);

  if (env.TEST_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.TEST_GUILD_ID), { body });
    console.log(`Deployed ${body.length} commands to guild ${env.TEST_GUILD_ID}`);
  } else {
    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
    console.log(`Deployed ${body.length} commands globally (propagation can take up to 1 hour)`);
  }
}

main().catch((error) => {
  console.error('Failed to deploy commands', error);
  process.exit(1);
});
```

This is a mechanical change: the previous version threw when `TEST_GUILD_ID` was unset; now that becomes the "deploy globally" branch instead of an error. The `TEST_GUILD_ID`-set branch (dev workflow, used throughout this project so far) is byte-for-byte unchanged in behavior.

No test file: this script has never had one (it's a CLI entry point with `main().catch(...)` side effects at module scope, same as `index.ts` — neither is unit-tested in this project). Adding a test harness for it now would be new scope beyond this phase's goal.

- [ ] **Step 2: Verify it still typechecks**

Run: `pnpm --filter backend exec tsc -p tsconfig.json --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/deployCommands.ts
git commit -m "feat: support global slash-command registration when TEST_GUILD_ID is unset"
```

---

### Task 4: Render + Vercel config files

**Files:**
- Create: `render.yaml` (repo root)
- Create: `vercel.json` (repo root)

**Interfaces:** None — static deploy configuration, no code.

- [ ] **Step 1: Create `render.yaml`**

Create at the repo root (`/home/solanoed/proyectos/discord/render.yaml` in this worktree — i.e. sibling to `backend/`, `frontend/`, `pnpm-workspace.yaml`):

```yaml
services:
  - type: web
    name: discord-music-backend
    runtime: node
    plan: free
    rootDir: backend
    buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm run build
    startCommand: pnpm run start
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 3001
      - key: DISCORD_TOKEN
        sync: false
      - key: DISCORD_CLIENT_ID
        sync: false
      - key: DISCORD_CLIENT_SECRET
        sync: false
      - key: JWT_SECRET
        sync: false
      - key: FRONTEND_URL
        sync: false
      - key: BACKEND_BASE_URL
        sync: false
```

Notes for the implementer:
- `runtime: node` is the current field name (Render's older `env: node` still works but is discouraged — use `runtime`).
- `rootDir: backend` changes Render's build/start working directory to `backend/`, but `pnpm install` from there still resolves the workspace root via `pnpm-workspace.yaml` (pnpm walks up automatically) — this is standard pnpm monorepo behavior, not Render-specific.
- Every `sync: false` var must be filled in by hand in the Render dashboard on first deploy (documented in Task 5's runbook) — never commit real secret values into this file.
- `TEST_GUILD_ID` is deliberately NOT listed here — leaving it unset in production is what makes `deployCommands.ts` (Task 3) register commands globally.

- [ ] **Step 2: Create `vercel.json`**

Create at the repo root:

```json
{
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm --filter frontend build",
  "outputDirectory": "frontend/dist"
}
```

Notes for the implementer:
- This file lives at the repo root and all paths in it (`outputDirectory`) are relative to the repo root — this only works because the Vercel project's **Root Directory** setting stays at its default (the repo root). If Root Directory were changed to `frontend/` in the Vercel dashboard, this file would break (see Task 5's runbook, which calls this out explicitly).
- `VITE_BACKEND_URL` is not part of this file — it's a regular (non-secret) environment variable set in the Vercel dashboard, since its value (the deployed backend's URL) isn't known until Task 5's Render deploy step completes.

- [ ] **Step 3: Commit**

```bash
git add render.yaml vercel.json
git commit -m "feat: add Render and Vercel deploy configs"
```

(No automated test for this task — static config validated by the real deploy in Task 5's manual runbook.)

---

### Task 5: Manual deploy runbook

**Files:**
- Create: `docs/deploy.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Write `docs/deploy.md`**

Create `docs/deploy.md`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/deploy.md
git commit -m "docs: add manual free-tier deploy runbook"
```

(No automated test — this is documentation, validated by a human actually following it during the real deploy, which is outside the scope of this plan's execution.)

---

## Post-plan notes (context for the final reviewer)

- Tasks 1-3 are backend code with tests; Tasks 4-5 are static config/docs with no automated coverage — that's expected for this phase, not a gap to flag.
- The actual live deploy (following `docs/deploy.md` against real Render/Vercel accounts) is explicitly out of scope for subagent execution — no subagent has credentials for those services. This plan only produces the code/config/docs needed for a human to do it.
- After this phase, every roadmap item in the design spec is complete.
