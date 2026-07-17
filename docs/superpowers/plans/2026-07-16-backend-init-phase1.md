# Backend Init (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the backend monorepo skeleton — discord.js Client, discord-player Player with default extractors, and a basic Express server — wired together behind validated environment configuration.

**Architecture:** pnpm monorepo (`backend/`, `frontend/` reserved for Phase 5). Backend factored into small factory functions (`loadEnv`, `createDiscordClient`, `createPlayer`, `createApp`) each independently unit-testable without a real Discord token or network call. `src/index.ts` is thin wiring only, exercised by manual run rather than automated test.

**Tech Stack:** Node.js, TypeScript (CommonJS), discord.js v14, discord-player v7 + `@discord-player/extractor`, express, zod, vitest, supertest, pnpm.

## Global Constraints

- Node.js ≥ 18.17 (discord.js v14 floor).
- Backend TypeScript compiles to CommonJS, not ESM — avoids discord.js/discord-player import interop issues.
- Zero comments in any source code file — explanations belong in plan text/chat, never in code blocks.
- Package manager: pnpm, monorepo via `pnpm-workspace.yaml` (`backend/`, `frontend/`).
- Testing: vitest for unit tests, supertest for HTTP; every task with testable logic follows TDD (failing test → minimal implementation → passing test).
- No placeholder/TODO code — every function is fully implemented in the task that introduces it.

---

### Task 1: Monorepo scaffolding + backend TS toolchain

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json` (root)
- Create: `.gitignore` (root)
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/vitest.config.ts`
- Create: `backend/.env.example`
- Create: `backend/README.md`
- Create: `backend/src/index.ts` (placeholder)

**Interfaces:**
- Produces: a working `pnpm --filter backend dev` command that runs `backend/src/index.ts` under `tsx watch`; a working `pnpm --filter backend test` command that runs `vitest run`. Later tasks assume both commands exist.

- [ ] **Step 1: Create root workspace files**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "backend"
  - "frontend"
```

`package.json`:

```json
{
  "name": "discord-music-dashboard",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "dev:backend": "pnpm --filter backend dev",
    "build:backend": "pnpm --filter backend build",
    "test:backend": "pnpm --filter backend test"
  }
}
```

`.gitignore`:

```
node_modules
dist
.env
.env.*
!.env.example
```

- [ ] **Step 2: Create backend package manifest**

`backend/package.json`:

```json
{
  "name": "backend",
  "version": "1.0.0",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@discord-player/extractor": "^7.1.0",
    "@discordjs/opus": "^0.9.0",
    "discord-player": "^7.1.0",
    "discord.js": "^14.16.3",
    "dotenv": "^16.4.5",
    "express": "^4.21.1",
    "ffmpeg-static": "^5.2.0",
    "libsodium-wrappers": "^0.7.15",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.9.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 3: Create backend TypeScript config**

`backend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

`backend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create env example and README**

`backend/.env.example`:

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
PORT=3001
NODE_ENV=development
```

`backend/README.md`:

```markdown
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
```

- [ ] **Step 5: Create placeholder entry point**

`backend/src/index.ts`:

```ts
console.log('backend toolchain ready');
```

- [ ] **Step 6: Install dependencies and verify toolchain**

Run: `cd /home/solanoed/proyectos/discord && pnpm install`
Expected: install completes with no errors, `backend/node_modules` created.

Run: `pnpm --filter backend dev`
Expected: prints `backend toolchain ready`, process stays running under `tsx watch` (stop with Ctrl+C).

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml package.json .gitignore backend/package.json backend/tsconfig.json backend/vitest.config.ts backend/.env.example backend/README.md backend/src/index.ts
git commit -m "chore: scaffold backend monorepo toolchain"
```

---

### Task 2: Environment config loader/validator

**Files:**
- Create: `backend/src/config/env.ts`
- Test: `backend/src/config/env.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `loadEnv(source?: NodeJS.ProcessEnv): Env` and `type Env = { DISCORD_TOKEN: string; DISCORD_CLIENT_ID: string; PORT: number; NODE_ENV: 'development' | 'production' | 'test' }`. Task 6 (`src/index.ts`) calls `loadEnv()` with no arguments to read `process.env`.

- [ ] **Step 1: Write the failing tests**

`backend/src/config/env.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('throws when DISCORD_TOKEN is missing', () => {
    expect(() => loadEnv({ DISCORD_CLIENT_ID: 'abc' })).toThrow();
  });

  it('throws when DISCORD_CLIENT_ID is missing', () => {
    expect(() => loadEnv({ DISCORD_TOKEN: 'token' })).toThrow();
  });

  it('applies defaults for PORT and NODE_ENV when absent', () => {
    const env = loadEnv({ DISCORD_TOKEN: 'token', DISCORD_CLIENT_ID: 'abc' });
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
  });

  it('coerces PORT from a string to a number', () => {
    const env = loadEnv({ DISCORD_TOKEN: 'token', DISCORD_CLIENT_ID: 'abc', PORT: '4000' });
    expect(env.PORT).toBe(4000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- env.test.ts`
Expected: FAIL with "Cannot find module './env'" (file does not exist yet).

- [ ] **Step 3: Write the implementation**

`backend/src/config/env.ts`:

```ts
import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
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
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/config/env.ts backend/src/config/env.test.ts
git commit -m "feat: add validated env config loader"
```

---

### Task 3: Express app factory with health endpoint

**Files:**
- Create: `backend/src/http/createApp.ts`
- Test: `backend/src/http/createApp.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createApp(): express.Express`. Task 6 calls `createApp()` and then `app.listen(env.PORT, ...)`.

- [ ] **Step 1: Write the failing test**

`backend/src/http/createApp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './createApp';

describe('createApp', () => {
  it('responds to GET /health with status ok', async () => {
    const app = createApp();
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter backend test -- createApp.test.ts`
Expected: FAIL with "Cannot find module './createApp'".

- [ ] **Step 3: Write the implementation**

`backend/src/http/createApp.ts`:

```ts
import express, { Express } from 'express';

export function createApp(): Express {
  const app = express();

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter backend test -- createApp.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/createApp.ts backend/src/http/createApp.test.ts
git commit -m "feat: add express app factory with health endpoint"
```

---

### Task 4: Discord client factory

**Files:**
- Create: `backend/src/bot/createDiscordClient.ts`
- Test: `backend/src/bot/createDiscordClient.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createDiscordClient(): Client` (discord.js `Client`, configured with `GatewayIntentBits.Guilds` and `GatewayIntentBits.GuildVoiceStates`, not logged in). Task 5 consumes this `Client` instance to construct a `Player`. Task 6 calls `createDiscordClient()` then `client.login(env.DISCORD_TOKEN)`.

- [ ] **Step 1: Write the failing tests**

`backend/src/bot/createDiscordClient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Client, GatewayIntentBits } from 'discord.js';
import { createDiscordClient } from './createDiscordClient';

describe('createDiscordClient', () => {
  it('returns a discord.js Client instance', () => {
    const client = createDiscordClient();
    expect(client).toBeInstanceOf(Client);
  });

  it('configures Guilds and GuildVoiceStates intents', () => {
    const client = createDiscordClient();
    expect(client.options.intents.has(GatewayIntentBits.Guilds)).toBe(true);
    expect(client.options.intents.has(GatewayIntentBits.GuildVoiceStates)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- createDiscordClient.test.ts`
Expected: FAIL with "Cannot find module './createDiscordClient'".

- [ ] **Step 3: Write the implementation**

`backend/src/bot/createDiscordClient.ts`:

```ts
import { Client, GatewayIntentBits } from 'discord.js';

export function createDiscordClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- createDiscordClient.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/bot/createDiscordClient.ts backend/src/bot/createDiscordClient.test.ts
git commit -m "feat: add discord client factory"
```

---

### Task 5: discord-player Player factory with default extractors

**Files:**
- Create: `backend/src/bot/createPlayer.ts`
- Test: `backend/src/bot/createPlayer.test.ts`

**Interfaces:**
- Consumes: `createDiscordClient(): Client` from Task 4.
- Produces: `createPlayer(client: Client): Promise<Player>` (discord-player `Player`, with `DefaultExtractors` from `@discord-player/extractor` registered). Task 6 calls `await createPlayer(client)` after creating the client.

- [ ] **Step 1: Write the failing test**

`backend/src/bot/createPlayer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDiscordClient } from './createDiscordClient';
import { createPlayer } from './createPlayer';

describe('createPlayer', () => {
  it('registers the default extractors', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    expect(player.extractors.store.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter backend test -- createPlayer.test.ts`
Expected: FAIL with "Cannot find module './createPlayer'".

- [ ] **Step 3: Write the implementation**

`backend/src/bot/createPlayer.ts`:

```ts
import { Client } from 'discord.js';
import { Player } from 'discord-player';
import { DefaultExtractors } from '@discord-player/extractor';

export async function createPlayer(client: Client): Promise<Player> {
  const player = new Player(client);
  await player.extractors.loadMulti(DefaultExtractors);
  return player;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter backend test -- createPlayer.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/bot/createPlayer.ts backend/src/bot/createPlayer.test.ts
git commit -m "feat: add discord-player factory with default extractors"
```

---

### Task 6: Wire entry point (bot + player + express server)

**Files:**
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `loadEnv()` (Task 2), `createApp()` (Task 3), `createDiscordClient()` (Task 4), `createPlayer(client)` (Task 5).
- Produces: the running backend process. No further tasks in this plan consume this file; Phase 2 will extend it to wire socket.io.

- [ ] **Step 1: Replace the placeholder entry point**

`backend/src/index.ts`:

```ts
import 'dotenv/config';
import { loadEnv } from './config/env';
import { createDiscordClient } from './bot/createDiscordClient';
import { createPlayer } from './bot/createPlayer';
import { createApp } from './http/createApp';

async function main(): Promise<void> {
  const env = loadEnv();
  const client = createDiscordClient();
  await createPlayer(client);

  client.once('ready', (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  const app = createApp();
  app.listen(env.PORT, () => {
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

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `pnpm --filter backend test`
Expected: PASS, all 8 tests across `env.test.ts`, `createApp.test.ts`, `createDiscordClient.test.ts`, `createPlayer.test.ts`.

- [ ] **Step 3: Manual verification with a real bot token**

Copy `backend/.env.example` to `backend/.env`, fill in a real `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` from the Discord Developer Portal.

Run: `pnpm --filter backend dev`
Expected console output, in order: `HTTP server listening on port 3001`, then `Logged in as <bot-tag>`.

Run in another terminal: `curl http://localhost:3001/health`
Expected: `{"status":"ok"}`

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat: wire discord client, player, and http server in entry point"
```
