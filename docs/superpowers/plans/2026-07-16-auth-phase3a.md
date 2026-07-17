# Auth (Phase 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discord OAuth2 login, JWT session cookies, CSRF-protected callback, an in-memory Discord-token store for silent refresh, and a `guildService` that computes which guilds a user administers and shares with the bot — exposed via `GET /api/auth/login`, `GET /api/auth/callback`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`.

**Architecture:** Same factory-function style as Phases 1-2: small, independently-testable units (`jwt`, `tokenStore`, `guildService`, `discordOAuth`, `requireAuth`, `authRoutes`) composed via explicit dependency injection (secrets and config passed as parameters, never read from `process.env` inside a unit) so every unit is testable without real Discord credentials or a live network call. This phase does NOT touch queue playback — no voice, no `queueService` (that's Phase 3b).

**Tech Stack:** `jsonwebtoken` (JWT sign/verify), `cookie-parser` (Express cookie reading), Node's native `fetch` (Discord REST calls — no HTTP client library), vitest with mocked `fetch` for external calls.

## Global Constraints

- Node.js ≥ 18.17.
- Backend TypeScript compiles to CommonJS, not ESM.
- Zero comments in any source code file.
- Package manager: pnpm, existing monorepo (`backend/`).
- Testing: vitest; TDD — failing test before implementation on every task with testable logic.
- No placeholder/TODO code.
- No Passport or other third-party auth framework — plain fetch-based OAuth2 exchange.
- No queue-mutation logic in this phase (no voice join, no play/skip/pause) — that's Phase 3b.
- Secrets and config (JWT secret, Discord client id/secret, redirect URI, frontend URL) are passed as explicit parameters into every unit, never read from `process.env` directly inside `auth/`, `services/`, or route-factory files — only `index.ts` reads `env` and threads values through. This keeps every unit testable without real secrets.
- Cookie `session`: httpOnly, `sameSite: 'lax'`, `secure` only when `NODE_ENV === 'production'`.
- Cookie `oauth_state`: httpOnly, `sameSite: 'lax'`, 5-minute `maxAge`.

---

### Task 1: Extend env config with auth variables

**Files:**
- Modify: `backend/src/config/env.ts`
- Modify: `backend/src/config/env.test.ts`
- Modify: `backend/.env.example`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Env` type gains `DISCORD_CLIENT_SECRET: string`, `JWT_SECRET: string`, `FRONTEND_URL: string`, `BACKEND_BASE_URL: string`. Task 8 (`index.ts` wiring) reads these off the `loadEnv()` result to build the `AuthRoutesConfig` passed into `createApp`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/config/env.test.ts` (keep the existing 4 tests, add these):

```ts
  it('throws when DISCORD_CLIENT_SECRET is missing', () => {
    expect(() =>
      loadEnv({
        DISCORD_TOKEN: 'token',
        DISCORD_CLIENT_ID: 'abc',
        JWT_SECRET: 'secret',
      }),
    ).toThrow();
  });

  it('throws when JWT_SECRET is missing', () => {
    expect(() =>
      loadEnv({
        DISCORD_TOKEN: 'token',
        DISCORD_CLIENT_ID: 'abc',
        DISCORD_CLIENT_SECRET: 'clientsecret',
      }),
    ).toThrow();
  });

  it('applies defaults for FRONTEND_URL and BACKEND_BASE_URL when absent', () => {
    const env = loadEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'abc',
      DISCORD_CLIENT_SECRET: 'clientsecret',
      JWT_SECRET: 'secret',
    });
    expect(env.FRONTEND_URL).toBe('http://localhost:5173');
    expect(env.BACKEND_BASE_URL).toBe('http://localhost:3001');
  });

  it('accepts custom FRONTEND_URL and BACKEND_BASE_URL', () => {
    const env = loadEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'abc',
      DISCORD_CLIENT_SECRET: 'clientsecret',
      JWT_SECRET: 'secret',
      FRONTEND_URL: 'https://dashboard.example.com',
      BACKEND_BASE_URL: 'https://api.example.com',
    });
    expect(env.FRONTEND_URL).toBe('https://dashboard.example.com');
    expect(env.BACKEND_BASE_URL).toBe('https://api.example.com');
  });
```

The 4 existing tests in this file must also keep passing — update their `loadEnv(...)` calls to include `DISCORD_CLIENT_SECRET` and `JWT_SECRET` alongside the existing `DISCORD_TOKEN`/`DISCORD_CLIENT_ID`, since those are now required too.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- env.test.ts`
Expected: FAIL — the new/updated tests fail because `env.ts` doesn't yet require or default these fields.

- [ ] **Step 3: Write the implementation**

`backend/src/config/env.ts`:

```ts
import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  BACKEND_BASE_URL: z.string().url().default('http://localhost:3001'),
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- env.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Update `.env.example`**

`backend/.env.example`:

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
JWT_SECRET=
FRONTEND_URL=http://localhost:5173
BACKEND_BASE_URL=http://localhost:3001
PORT=3001
NODE_ENV=development
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/config/env.ts backend/src/config/env.test.ts backend/.env.example
git commit -m "feat: add auth env vars (client secret, jwt secret, frontend/backend urls)"
```

---

### Task 2: Install jsonwebtoken, `jwt.ts` — session token sign/verify

**Files:**
- Modify: `backend/package.json` (add `jsonwebtoken` dependency, `@types/jsonwebtoken` dev dependency)
- Create: `backend/src/auth/jwt.ts`
- Test: `backend/src/auth/jwt.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SessionPayload` type (`{ userId: string; adminGuildIds: string[] }`), `signSessionToken(payload: SessionPayload, secret: string): string`, `verifySessionToken(token: string, secret: string, options?: { ignoreExpiration?: boolean }): SessionPayload`. Task 6 (`requireAuth`) and Task 7 (`authRoutes`) both import these.

- [ ] **Step 1: Add jsonwebtoken dependency**

Edit `backend/package.json`: add to `"dependencies"`:

```json
    "jsonwebtoken": "^9.0.2",
```

and to `"devDependencies"`:

```json
    "@types/jsonwebtoken": "^9.0.7",
```

Run: `pnpm install`
Expected: install completes, `jsonwebtoken` appears in `backend/node_modules`.

- [ ] **Step 2: Write the failing tests**

`backend/src/auth/jwt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { signSessionToken, verifySessionToken } from './jwt';

const SECRET = 'test-secret';

describe('signSessionToken / verifySessionToken', () => {
  it('round-trips a payload through sign and verify', () => {
    const payload = { userId: 'user-1', adminGuildIds: ['guild-1', 'guild-2'] };
    const token = signSessionToken(payload, SECRET);
    const decoded = verifySessionToken(token, SECRET);

    expect(decoded.userId).toBe('user-1');
    expect(decoded.adminGuildIds).toEqual(['guild-1', 'guild-2']);
  });

  it('throws when verifying with the wrong secret', () => {
    const token = signSessionToken({ userId: 'user-1', adminGuildIds: [] }, SECRET);

    expect(() => verifySessionToken(token, 'wrong-secret')).toThrow();
  });

  it('throws when the token is expired', () => {
    const expiredToken = signSessionToken({ userId: 'user-1', adminGuildIds: [] }, SECRET, -10);

    expect(() => verifySessionToken(expiredToken, SECRET)).toThrow();
  });

  it('accepts an expired token when ignoreExpiration is true', () => {
    const expiredToken = signSessionToken({ userId: 'user-1', adminGuildIds: [] }, SECRET, -10);

    const decoded = verifySessionToken(expiredToken, SECRET, { ignoreExpiration: true });

    expect(decoded.userId).toBe('user-1');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter backend test -- jwt.test.ts`
Expected: FAIL with "Cannot find module './jwt'".

- [ ] **Step 4: Write the implementation**

`backend/src/auth/jwt.ts`:

```ts
import jwt from 'jsonwebtoken';

export type SessionPayload = {
  userId: string;
  adminGuildIds: string[];
};

export function signSessionToken(
  payload: SessionPayload,
  secret: string,
  expiresInSeconds: number = 60 * 60,
): string {
  return jwt.sign(payload, secret, { expiresIn: expiresInSeconds });
}

export function verifySessionToken(
  token: string,
  secret: string,
  options?: { ignoreExpiration?: boolean },
): SessionPayload {
  return jwt.verify(token, secret, {
    ignoreExpiration: options?.ignoreExpiration ?? false,
  }) as SessionPayload;
}
```

Note: the test's third case calls `signSessionToken(payload, SECRET, -10)` to mint an already-expired token — the third parameter is the expiry in seconds, defaulting to 1 hour, and a negative value produces an `exp` in the past.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter backend test -- jwt.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json pnpm-lock.yaml backend/src/auth/jwt.ts backend/src/auth/jwt.test.ts
git commit -m "feat: add jwt session token sign/verify"
```

Note: `pnpm install` updates the workspace-root `pnpm-lock.yaml` — run `git status` to confirm the exact changed path before staging.

---

### Task 3: `tokenStore.ts` — in-memory Discord token storage

**Files:**
- Create: `backend/src/auth/tokenStore.ts`
- Test: `backend/src/auth/tokenStore.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DiscordTokens` type (`{ accessToken: string; refreshToken: string; expiresAt: number }`), `saveTokens(userId: string, tokens: DiscordTokens): void`, `getTokens(userId: string): DiscordTokens | undefined`. Task 7 (`authRoutes`) uses both in `/callback` and `/refresh`.

- [ ] **Step 1: Write the failing tests**

`backend/src/auth/tokenStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { saveTokens, getTokens } from './tokenStore';

describe('tokenStore', () => {
  it('returns undefined for a userId that was never saved', () => {
    expect(getTokens('never-saved-user')).toBeUndefined();
  });

  it('round-trips tokens through saveTokens and getTokens', () => {
    const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 1000 };

    saveTokens('user-tokenstore-1', tokens);

    expect(getTokens('user-tokenstore-1')).toEqual(tokens);
  });

  it('overwrites tokens on a second save for the same userId', () => {
    saveTokens('user-tokenstore-2', { accessToken: 'old', refreshToken: 'old-r', expiresAt: 1 });
    saveTokens('user-tokenstore-2', { accessToken: 'new', refreshToken: 'new-r', expiresAt: 2 });

    expect(getTokens('user-tokenstore-2')).toEqual({ accessToken: 'new', refreshToken: 'new-r', expiresAt: 2 });
  });
});
```

Each test uses a distinct `userId` to avoid cross-test interference, since the store is a module-level singleton.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- tokenStore.test.ts`
Expected: FAIL with "Cannot find module './tokenStore'".

- [ ] **Step 3: Write the implementation**

`backend/src/auth/tokenStore.ts`:

```ts
export type DiscordTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

const store = new Map<string, DiscordTokens>();

export function saveTokens(userId: string, tokens: DiscordTokens): void {
  store.set(userId, tokens);
}

export function getTokens(userId: string): DiscordTokens | undefined {
  return store.get(userId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- tokenStore.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/tokenStore.ts backend/src/auth/tokenStore.test.ts
git commit -m "feat: add in-memory discord token store"
```

---

### Task 4: `guildService.ts` — mutual admin guild computation

**Files:**
- Create: `backend/src/services/guildService.ts`
- Test: `backend/src/services/guildService.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DiscordUserGuild` type (`{ id: string; name: string; owner: boolean; permissions: string }`), `hasManageGuildPermission(permissions: string): boolean`, `getMutualAdminGuilds(userGuilds: DiscordUserGuild[], botGuildIds: string[]): string[]`. Task 5 (`discordOAuth.fetchUserGuilds`) returns data typed as `DiscordUserGuild[]`; Task 7 (`authRoutes`) calls `getMutualAdminGuilds` in `/callback`.

- [ ] **Step 1: Write the failing tests**

`backend/src/services/guildService.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hasManageGuildPermission, getMutualAdminGuilds, DiscordUserGuild } from './guildService';

function fakeGuild(overrides: Partial<DiscordUserGuild> = {}): DiscordUserGuild {
  return {
    id: 'guild-1',
    name: 'Test Guild',
    owner: false,
    permissions: '0',
    ...overrides,
  };
}

describe('hasManageGuildPermission', () => {
  it('returns true when the MANAGE_GUILD bit (0x20) is set', () => {
    expect(hasManageGuildPermission('32')).toBe(true);
    expect(hasManageGuildPermission('40')).toBe(true);
  });

  it('returns false when the MANAGE_GUILD bit is not set', () => {
    expect(hasManageGuildPermission('0')).toBe(false);
    expect(hasManageGuildPermission('16')).toBe(false);
  });
});

describe('getMutualAdminGuilds', () => {
  it('excludes guilds the bot is not in', () => {
    const userGuilds = [fakeGuild({ id: 'guild-not-with-bot', owner: true })];
    expect(getMutualAdminGuilds(userGuilds, ['guild-other'])).toEqual([]);
  });

  it('excludes guilds where the user is neither owner nor has MANAGE_GUILD', () => {
    const userGuilds = [fakeGuild({ id: 'guild-1', owner: false, permissions: '0' })];
    expect(getMutualAdminGuilds(userGuilds, ['guild-1'])).toEqual([]);
  });

  it('includes guilds where the user is the owner', () => {
    const userGuilds = [fakeGuild({ id: 'guild-1', owner: true, permissions: '0' })];
    expect(getMutualAdminGuilds(userGuilds, ['guild-1'])).toEqual(['guild-1']);
  });

  it('includes guilds where the user has the MANAGE_GUILD permission bit', () => {
    const userGuilds = [fakeGuild({ id: 'guild-1', owner: false, permissions: '32' })];
    expect(getMutualAdminGuilds(userGuilds, ['guild-1'])).toEqual(['guild-1']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- guildService.test.ts`
Expected: FAIL with "Cannot find module './guildService'".

- [ ] **Step 3: Write the implementation**

`backend/src/services/guildService.ts`:

```ts
export type DiscordUserGuild = {
  id: string;
  name: string;
  owner: boolean;
  permissions: string;
};

const MANAGE_GUILD_BIT = 0x20n;

export function hasManageGuildPermission(permissions: string): boolean {
  const bitfield = BigInt(permissions);
  return (bitfield & MANAGE_GUILD_BIT) === MANAGE_GUILD_BIT;
}

export function getMutualAdminGuilds(userGuilds: DiscordUserGuild[], botGuildIds: string[]): string[] {
  const botGuildIdSet = new Set(botGuildIds);

  return userGuilds
    .filter((guild) => botGuildIdSet.has(guild.id))
    .filter((guild) => guild.owner || hasManageGuildPermission(guild.permissions))
    .map((guild) => guild.id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- guildService.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/guildService.ts backend/src/services/guildService.test.ts
git commit -m "feat: add guildService to compute mutual admin guilds"
```

---

### Task 5: `discordOAuth.ts` — Discord REST wrappers

**Files:**
- Create: `backend/src/auth/discordOAuth.ts`
- Test: `backend/src/auth/discordOAuth.test.ts`

**Interfaces:**
- Consumes: `DiscordUserGuild` type from Task 4 (`backend/src/services/guildService.ts`).
- Produces: `DiscordOAuthConfig` type (`{ clientId: string; clientSecret: string; redirectUri: string }`), `DiscordTokenResponse` type (`{ accessToken: string; refreshToken: string; expiresIn: number }`), `DiscordUser` type (`{ id: string; username: string }`), and functions `buildAuthorizeUrl(config, state)`, `exchangeCodeForToken(config, code)`, `refreshAccessToken(config, refreshToken)`, `fetchDiscordUser(accessToken)`, `fetchUserGuilds(accessToken)`. Task 7 (`authRoutes`) imports all five functions and the three types.

- [ ] **Step 1: Write the failing tests**

`backend/src/auth/discordOAuth.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  fetchDiscordUser,
  fetchUserGuilds,
  DiscordOAuthConfig,
} from './discordOAuth';

const config: DiscordOAuthConfig = {
  clientId: 'client-1',
  clientSecret: 'secret-1',
  redirectUri: 'http://localhost:3001/api/auth/callback',
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildAuthorizeUrl', () => {
  it('builds a Discord authorize URL with the correct query params', () => {
    const url = new URL(buildAuthorizeUrl(config, 'state-123'));

    expect(url.origin + url.pathname).toBe('https://discord.com/api/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('identify guilds');
    expect(url.searchParams.get('state')).toBe('state-123');
  });
});

describe('exchangeCodeForToken', () => {
  it('posts the authorization_code grant and parses the token response', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 604800 }),
    );

    const result = await exchangeCodeForToken(config, 'code-1');

    expect(result).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 604800 });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://discord.com/api/oauth2/token');
    expect(init?.method).toBe('POST');
    const body = new URLSearchParams(init?.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-1');
  });

  it('throws when Discord responds with a non-ok status', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 400 } as Response);

    await expect(exchangeCodeForToken(config, 'bad-code')).rejects.toThrow();
  });
});

describe('refreshAccessToken', () => {
  it('posts the refresh_token grant and parses the token response', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 604800 }),
    );

    const result = await refreshAccessToken(config, 'refresh-1');

    expect(result).toEqual({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 604800 });
    const [, init] = fetchSpy.mock.calls[0];
    const body = new URLSearchParams(init?.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-1');
  });
});

describe('fetchDiscordUser', () => {
  it('fetches the current user with a bearer token', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ id: 'user-1', username: 'tester' }));

    const user = await fetchDiscordUser('access-1');

    expect(user).toEqual({ id: 'user-1', username: 'tester' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://discord.com/api/users/@me');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
  });
});

describe('fetchUserGuilds', () => {
  it('fetches the current user guilds with a bearer token', async () => {
    const guilds = [{ id: 'guild-1', name: 'G', owner: true, permissions: '0' }];
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(guilds));

    const result = await fetchUserGuilds('access-1');

    expect(result).toEqual(guilds);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- discordOAuth.test.ts`
Expected: FAIL with "Cannot find module './discordOAuth'".

- [ ] **Step 3: Write the implementation**

`backend/src/auth/discordOAuth.ts`:

```ts
import type { DiscordUserGuild } from '../services/guildService';

export type DiscordOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type DiscordTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type DiscordUser = {
  id: string;
  username: string;
};

export function buildAuthorizeUrl(config: DiscordOAuthConfig, state: string): string {
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds');
  url.searchParams.set('state', state);
  return url.toString();
}

async function requestToken(body: URLSearchParams): Promise<DiscordTokenResponse> {
  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Discord token request failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

export function exchangeCodeForToken(config: DiscordOAuthConfig, code: string): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  });

  return requestToken(body);
}

export function refreshAccessToken(config: DiscordOAuthConfig, refreshToken: string): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  return requestToken(body);
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const response = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Discord user request failed with status ${response.status}`);
  }

  return (await response.json()) as DiscordUser;
}

export async function fetchUserGuilds(accessToken: string): Promise<DiscordUserGuild[]> {
  const response = await fetch('https://discord.com/api/users/@me/guilds', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Discord guilds request failed with status ${response.status}`);
  }

  return (await response.json()) as DiscordUserGuild[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- discordOAuth.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/discordOAuth.ts backend/src/auth/discordOAuth.test.ts
git commit -m "feat: add discordOAuth REST wrappers"
```

---

### Task 6: Install cookie-parser, `requireAuth` middleware

**Files:**
- Modify: `backend/package.json` (add `cookie-parser` dependency, `@types/cookie-parser` dev dependency)
- Create: `backend/src/http/middleware/requireAuth.ts`
- Test: `backend/src/http/middleware/requireAuth.test.ts`

**Interfaces:**
- Consumes: `SessionPayload`, `verifySessionToken` from Task 2 (`backend/src/auth/jwt.ts`).
- Produces: `AuthenticatedRequest` type (Express `Request` with an optional `user: SessionPayload`), `createRequireAuth(secret: string): RequestHandler`. Task 7 (`authRoutes`) uses `createRequireAuth` to protect `GET /me`.

- [ ] **Step 1: Add cookie-parser dependency**

Edit `backend/package.json`: add to `"dependencies"`:

```json
    "cookie-parser": "^1.4.7",
```

and to `"devDependencies"`:

```json
    "@types/cookie-parser": "^1.4.8",
```

Run: `pnpm install`
Expected: install completes, `cookie-parser` appears in `backend/node_modules`.

- [ ] **Step 2: Write the failing test**

`backend/src/http/middleware/requireAuth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { signSessionToken } from '../../auth/jwt';
import { createRequireAuth, AuthenticatedRequest } from './requireAuth';

const SECRET = 'test-secret';

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/protected', createRequireAuth(SECRET), (req, res) => {
    res.status(200).json((req as AuthenticatedRequest).user);
  });
  return app;
}

describe('createRequireAuth', () => {
  it('allows the request through with a valid session cookie', async () => {
    const app = buildTestApp();
    const token = signSessionToken({ userId: 'user-1', adminGuildIds: ['guild-1'] }, SECRET);

    const response = await request(app).get('/protected').set('Cookie', [`session=${token}`]);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: 'user-1', adminGuildIds: ['guild-1'] });
  });

  it('rejects the request when there is no session cookie', async () => {
    const app = buildTestApp();

    const response = await request(app).get('/protected');

    expect(response.status).toBe(401);
  });

  it('rejects the request when the session cookie is invalid', async () => {
    const app = buildTestApp();

    const response = await request(app).get('/protected').set('Cookie', ['session=garbage']);

    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter backend test -- requireAuth.test.ts`
Expected: FAIL with "Cannot find module './requireAuth'".

- [ ] **Step 4: Write the implementation**

`backend/src/http/middleware/requireAuth.ts`:

```ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifySessionToken, SessionPayload } from '../../auth/jwt';

export type AuthenticatedRequest = Request & { user?: SessionPayload };

export function createRequireAuth(secret: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.session;

    if (typeof token !== 'string') {
      res.status(401).json({ message: 'unauthorized' });
      return;
    }

    try {
      (req as AuthenticatedRequest).user = verifySessionToken(token, secret);
      next();
    } catch {
      res.status(401).json({ message: 'unauthorized' });
    }
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter backend test -- requireAuth.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json pnpm-lock.yaml backend/src/http/middleware/requireAuth.ts backend/src/http/middleware/requireAuth.test.ts
git commit -m "feat: add requireAuth middleware"
```

---

### Task 7: `authRoutes.ts` — login, callback, refresh, logout, me

**Files:**
- Create: `backend/src/http/routes/authRoutes.ts`
- Test: `backend/src/http/routes/authRoutes.test.ts`

**Interfaces:**
- Consumes: `buildAuthorizeUrl`, `exchangeCodeForToken`, `refreshAccessToken`, `fetchDiscordUser`, `fetchUserGuilds`, `DiscordOAuthConfig` (Task 5); `signSessionToken`, `verifySessionToken` (Task 2); `saveTokens`, `getTokens` (Task 3); `getMutualAdminGuilds` (Task 4); `createRequireAuth` (Task 6).
- Produces: `AuthRoutesConfig` type (`{ oauth: DiscordOAuthConfig; jwtSecret: string; frontendUrl: string; isProduction: boolean; getBotGuildIds: () => string[] }`), `createAuthRoutes(config: AuthRoutesConfig): Router`. Task 8 (`createApp.ts`) mounts this router at `/api/auth`.

- [ ] **Step 1: Write the failing tests**

`backend/src/http/routes/authRoutes.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as discordOAuth from '../../auth/discordOAuth';
import { signSessionToken } from '../../auth/jwt';
import { saveTokens } from '../../auth/tokenStore';
import { createAuthRoutes, AuthRoutesConfig } from './authRoutes';

const config: AuthRoutesConfig = {
  oauth: {
    clientId: 'client-1',
    clientSecret: 'secret-1',
    redirectUri: 'http://localhost:3001/api/auth/callback',
  },
  jwtSecret: 'test-secret',
  frontendUrl: 'http://localhost:5173',
  isProduction: false,
  getBotGuildIds: () => ['guild-1'],
};

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use('/api/auth', createAuthRoutes(config));
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/auth/login', () => {
  it('redirects to Discord and sets an oauth_state cookie', async () => {
    const app = buildTestApp();

    const response = await request(app).get('/api/auth/login');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('https://discord.com/api/oauth2/authorize');
    expect(response.headers['set-cookie']?.[0]).toContain('oauth_state=');
  });
});

describe('GET /api/auth/callback', () => {
  it('rejects when state does not match the oauth_state cookie', async () => {
    const app = buildTestApp();

    const response = await request(app)
      .get('/api/auth/callback?code=abc&state=mismatched')
      .set('Cookie', ['oauth_state=expected-state']);

    expect(response.status).toBe(400);
  });

  it('completes the flow and sets a session cookie on success', async () => {
    vi.spyOn(discordOAuth, 'exchangeCodeForToken').mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresIn: 604800,
    });
    vi.spyOn(discordOAuth, 'fetchDiscordUser').mockResolvedValue({ id: 'user-1', username: 'tester' });
    vi.spyOn(discordOAuth, 'fetchUserGuilds').mockResolvedValue([
      { id: 'guild-1', name: 'G', owner: true, permissions: '0' },
    ]);

    const app = buildTestApp();

    const response = await request(app)
      .get('/api/auth/callback?code=abc&state=matching-state')
      .set('Cookie', ['oauth_state=matching-state']);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('http://localhost:5173');
    expect(response.headers['set-cookie']?.some((cookie: string) => cookie.startsWith('session='))).toBe(true);
  });

  it('redirects with an error when the code exchange fails', async () => {
    vi.spyOn(discordOAuth, 'exchangeCodeForToken').mockRejectedValue(new Error('bad code'));

    const app = buildTestApp();

    const response = await request(app)
      .get('/api/auth/callback?code=bad&state=matching-state')
      .set('Cookie', ['oauth_state=matching-state']);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('http://localhost:5173/login?error=oauth_failed');
  });
});

describe('POST /api/auth/refresh', () => {
  it('rejects when there is no session cookie', async () => {
    const app = buildTestApp();

    const response = await request(app).post('/api/auth/refresh');

    expect(response.status).toBe(401);
  });

  it('rejects when the session is valid but no tokens were ever stored for that user', async () => {
    const app = buildTestApp();
    const token = signSessionToken({ userId: 'user-never-saved', adminGuildIds: [] }, config.jwtSecret);

    const response = await request(app).post('/api/auth/refresh').set('Cookie', [`session=${token}`]);

    expect(response.status).toBe(401);
  });

  it('refreshes successfully when the session is valid and tokens exist for that user', async () => {
    saveTokens('user-refresh-1', { accessToken: 'old', refreshToken: 'refresh-old', expiresAt: Date.now() });
    vi.spyOn(discordOAuth, 'refreshAccessToken').mockResolvedValue({
      accessToken: 'access-new',
      refreshToken: 'refresh-new',
      expiresIn: 604800,
    });

    const app = buildTestApp();
    const token = signSessionToken({ userId: 'user-refresh-1', adminGuildIds: ['guild-1'] }, config.jwtSecret);

    const response = await request(app).post('/api/auth/refresh').set('Cookie', [`session=${token}`]);

    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']?.some((cookie: string) => cookie.startsWith('session='))).toBe(true);
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const app = buildTestApp();

    const response = await request(app).post('/api/auth/logout');

    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']?.[0]).toContain('session=;');
  });
});

describe('GET /api/auth/me', () => {
  it('rejects when there is no session cookie', async () => {
    const app = buildTestApp();

    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
  });
});
```

Note: this test file mocks `discordOAuth`'s named exports with `vi.spyOn(discordOAuth, '...')`, which requires `authRoutes.ts` to call these functions via the module namespace import (`import * as discordOAuth from '../../auth/discordOAuth'`) rather than named imports — named imports are bound at compile time and `vi.spyOn` cannot intercept them reliably under CommonJS/vitest. Use the namespace-import style shown in the implementation below.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- authRoutes.test.ts`
Expected: FAIL with "Cannot find module './authRoutes'".

- [ ] **Step 3: Write the implementation**

`backend/src/http/routes/authRoutes.ts`:

```ts
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import * as discordOAuth from '../../auth/discordOAuth';
import { DiscordOAuthConfig } from '../../auth/discordOAuth';
import { signSessionToken, verifySessionToken } from '../../auth/jwt';
import { saveTokens, getTokens } from '../../auth/tokenStore';
import { getMutualAdminGuilds } from '../../services/guildService';
import { createRequireAuth, AuthenticatedRequest } from '../middleware/requireAuth';

export type AuthRoutesConfig = {
  oauth: DiscordOAuthConfig;
  jwtSecret: string;
  frontendUrl: string;
  isProduction: boolean;
  getBotGuildIds: () => string[];
};

const SESSION_COOKIE_MAX_AGE_MS = 60 * 60 * 1000;
const OAUTH_STATE_COOKIE_MAX_AGE_MS = 5 * 60 * 1000;

export function createAuthRoutes(config: AuthRoutesConfig): Router {
  const router = Router();
  const requireAuth = createRequireAuth(config.jwtSecret);

  router.get('/login', (_req: Request, res: Response) => {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: OAUTH_STATE_COOKIE_MAX_AGE_MS,
    });
    res.redirect(discordOAuth.buildAuthorizeUrl(config.oauth, state));
  });

  router.get('/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;
    const storedState = req.cookies?.oauth_state;
    res.clearCookie('oauth_state');

    if (typeof state !== 'string' || typeof storedState !== 'string' || state !== storedState) {
      res.status(400).json({ message: 'invalid oauth state' });
      return;
    }

    if (typeof code !== 'string') {
      res.status(400).json({ message: 'missing code' });
      return;
    }

    try {
      const tokenResponse = await discordOAuth.exchangeCodeForToken(config.oauth, code);
      const user = await discordOAuth.fetchDiscordUser(tokenResponse.accessToken);
      const userGuilds = await discordOAuth.fetchUserGuilds(tokenResponse.accessToken);
      const adminGuildIds = getMutualAdminGuilds(userGuilds, config.getBotGuildIds());

      saveTokens(user.id, {
        accessToken: tokenResponse.accessToken,
        refreshToken: tokenResponse.refreshToken,
        expiresAt: Date.now() + tokenResponse.expiresIn * 1000,
      });

      const sessionToken = signSessionToken({ userId: user.id, adminGuildIds }, config.jwtSecret);
      res.cookie('session', sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProduction,
        maxAge: SESSION_COOKIE_MAX_AGE_MS,
      });

      res.redirect(config.frontendUrl);
    } catch {
      res.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
    }
  });

  router.post('/refresh', async (req: Request, res: Response) => {
    const token = req.cookies?.session;

    if (typeof token !== 'string') {
      res.status(401).json({ message: 'unauthorized' });
      return;
    }

    let payload;
    try {
      payload = verifySessionToken(token, config.jwtSecret, { ignoreExpiration: true });
    } catch {
      res.status(401).json({ message: 'unauthorized' });
      return;
    }

    const stored = getTokens(payload.userId);
    if (!stored) {
      res.status(401).json({ message: 'session expired, please log in again' });
      return;
    }

    try {
      const tokenResponse = await discordOAuth.refreshAccessToken(config.oauth, stored.refreshToken);

      saveTokens(payload.userId, {
        accessToken: tokenResponse.accessToken,
        refreshToken: tokenResponse.refreshToken,
        expiresAt: Date.now() + tokenResponse.expiresIn * 1000,
      });

      const sessionToken = signSessionToken(payload, config.jwtSecret);
      res.cookie('session', sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProduction,
        maxAge: SESSION_COOKIE_MAX_AGE_MS,
      });
      res.status(200).json({ message: 'refreshed' });
    } catch {
      res.status(502).json({ message: 'failed to refresh session' });
    }
  });

  router.post('/logout', (_req: Request, res: Response) => {
    res.clearCookie('session');
    res.status(200).json({ message: 'logged out' });
  });

  router.get('/me', requireAuth, (req: Request, res: Response) => {
    res.status(200).json((req as AuthenticatedRequest).user);
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- authRoutes.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/authRoutes.ts backend/src/http/routes/authRoutes.test.ts
git commit -m "feat: add authRoutes (login, callback, refresh, logout, me)"
```

---

### Task 8: Wire cookie-parser + authRoutes into `createApp`, update `index.ts`

**Files:**
- Modify: `backend/src/http/createApp.ts`
- Modify: `backend/src/http/createApp.test.ts`
- Modify: `backend/src/http/createHttpServer.test.ts`
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `createAuthRoutes`, `AuthRoutesConfig` (Task 7).
- Produces: `createApp(authRoutesConfig: AuthRoutesConfig): Express` — this changes `createApp`'s signature from Phase 1/2 (previously `createApp(): Express`), so every existing caller/test must be updated in this same task. No later task in this plan depends on this file.

- [ ] **Step 1: Update `createApp.ts`**

`backend/src/http/createApp.ts`:

```ts
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { createAuthRoutes, AuthRoutesConfig } from './routes/authRoutes';

export function createApp(authRoutesConfig: AuthRoutesConfig): Express {
  const app = express();
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', createAuthRoutes(authRoutesConfig));

  return app;
}
```

- [ ] **Step 2: Update `createApp.test.ts` for the new signature**

`backend/src/http/createApp.test.ts` — replace the existing test file with:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './createApp';
import { AuthRoutesConfig } from './routes/authRoutes';

const testAuthConfig: AuthRoutesConfig = {
  oauth: { clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'http://localhost:3001/api/auth/callback' },
  jwtSecret: 'test-secret',
  frontendUrl: 'http://localhost:5173',
  isProduction: false,
  getBotGuildIds: () => [],
};

describe('createApp', () => {
  it('responds to GET /health with status ok', async () => {
    const app = createApp(testAuthConfig);
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 3: Update `createHttpServer.test.ts` for the new signature**

`backend/src/http/createHttpServer.test.ts` — replace the existing test file with:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './createApp';
import { createHttpServer } from './createHttpServer';
import { AuthRoutesConfig } from './routes/authRoutes';

const testAuthConfig: AuthRoutesConfig = {
  oauth: { clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'http://localhost:3001/api/auth/callback' },
  jwtSecret: 'test-secret',
  frontendUrl: 'http://localhost:5173',
  isProduction: false,
  getBotGuildIds: () => [],
};

describe('createHttpServer', () => {
  it('serves the express app over a real http.Server', async () => {
    const app = createApp(testAuthConfig);
    const server = createHttpServer(app);

    const response = await request(server).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

Run: `pnpm --filter backend test`
Expected: PASS, all 51 tests: 16 carried over from Phases 1-2 (`createApp`/`createHttpServer` keep 1 test each, just rewritten for the new signature — no count change there) + 8 from Task 1's `env.test.ts` (was 4) + 4 from Task 2 (`jwt`) + 3 from Task 3 (`tokenStore`) + 6 from Task 4 (`guildService`) + 6 from Task 5 (`discordOAuth`) + 3 from Task 6 (`requireAuth`) + 9 from Task 7 (`authRoutes`).

- [ ] **Step 5: Update `index.ts`**

`backend/src/index.ts`:

```ts
import 'dotenv/config';
import { loadEnv } from './config/env';
import { createDiscordClient } from './bot/createDiscordClient';
import { createPlayer } from './bot/createPlayer';
import { createApp } from './http/createApp';
import { createHttpServer } from './http/createHttpServer';
import { createSocketServer } from './sockets/createSocketServer';
import { registerPlayerEventBridge } from './sockets/playerEventBridge';

async function main(): Promise<void> {
  const env = loadEnv();
  const client = createDiscordClient();
  const player = await createPlayer(client);

  client.once('ready', (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  const app = createApp({
    oauth: {
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      redirectUri: `${env.BACKEND_BASE_URL}/api/auth/callback`,
    },
    jwtSecret: env.JWT_SECRET,
    frontendUrl: env.FRONTEND_URL,
    isProduction: env.NODE_ENV === 'production',
    getBotGuildIds: () => client.guilds.cache.map((guild) => guild.id),
  });
  const httpServer = createHttpServer(app);
  const io = createSocketServer(httpServer, player);
  registerPlayerEventBridge(player, io);

  httpServer.listen(env.PORT, () => {
    console.log(`HTTP server listening on port ${env.PORT}`);
  });

  await client.login(env.DISCORD_TOKEN);

  process.once('SIGINT', () => {
    client.destroy();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error during startup', error);
  process.exit(1);
});
```

- [ ] **Step 6: Run the full test suite again**

Run: `pnpm --filter backend test`
Expected: PASS, same total as Step 4 (this step only touched `index.ts`, which has no automated tests).

- [ ] **Step 7: Manual verification**

Copy `backend/.env.example` to `backend/.env`, fill in real `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` from the Discord Developer Portal, and a random `JWT_SECRET` (e.g. `openssl rand -hex 32`). In the Developer Portal's OAuth2 settings, add `http://localhost:3001/api/auth/callback` as a redirect URI.

Run: `pnpm --filter backend dev`

In a browser, visit `http://localhost:3001/api/auth/login` — expect a redirect to Discord's consent screen, then (after approving) a redirect back to `http://localhost:5173` (the frontend doesn't exist yet, so this will 404/connection-refused in the browser — that's expected, the important part is that a `session` cookie was set by the backend before that final redirect, visible in devtools' Application/Cookies panel for `localhost:3001`).

- [ ] **Step 8: Commit**

```bash
git add backend/src/http/createApp.ts backend/src/http/createApp.test.ts backend/src/http/createHttpServer.test.ts backend/src/index.ts
git commit -m "feat: wire cookie-parser and auth routes into createApp and index.ts"
```
