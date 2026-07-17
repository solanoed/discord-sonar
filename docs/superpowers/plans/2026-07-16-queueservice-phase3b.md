# QueueService (Phase 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real playback control — join voice, search, play, skip, pause, resume, volume, remove, shuffle, stop — exposed via REST under `/api/guilds/:guildId/queue`, plus `GET /api/guilds` listing the caller's admin guilds with names. All gated by `requireAuth` + a new `requireGuildAdmin` middleware.

**Architecture:** Same dependency-injection style as Phases 1-3a: `queueService` functions take `client`/`player` as explicit parameters (never read from a module-level singleton), so they're testable with plain fake objects standing in for discord.js/discord-player instances — no real Discord connection, no real voice, no real network search in tests. discord-player v7.2.0 has an internal convenience method `player.play(channel, query, options)` that exists at runtime (`backend/node_modules/discord-player/dist/index.js`) but is **not declared in its types** (`dist/index.d.ts`) — confirmed by reading both files. To avoid an `as any` cast, `queueService.addTrack` replicates that method's own internal sequence using only documented, typed API: `player.search()` → `player.nodes.create()` → `queue.connect()` (if not already connected) → `queue.addTrack()` → `queue.node.play()` (if not already playing).

**Tech Stack:** discord.js (`Client.guilds.fetch`, `Guild.members.fetch`, `Guild.channels.fetch`), discord-player (`Player.search`, `Player.nodes`, `GuildQueue`), Express (`Router({ mergeParams: true })` for nested `:guildId` routes), vitest with fully-fake test doubles (no real Discord/voice/network in any test).

## Global Constraints

- Node.js ≥ 18.17.
- Backend TypeScript compiles to CommonJS, not ESM.
- Zero comments in any source code file.
- Package manager: pnpm, existing monorepo (`backend/`).
- Testing: vitest; TDD — failing test before implementation on every task with testable logic. No test may make a real Discord API call, a real voice connection, or a real track search — all such calls are stubbed with fake objects or `vi.spyOn`/namespace-import mocks.
- No placeholder/TODO code.
- `queueService`, `requireGuildAdmin`, `queueRoutes`, `guildsRoutes` take `client`/`player`/secrets as explicit parameters — never read from `process.env` or a module-level singleton.
- Volume is validated to the 0-100 range (matches `GuildQueuePlayerNode.volume`'s real range) before being passed to discord-player.
- Every mutation route requires `requireAuth` then `requireGuildAdmin` (guildId in `req.user.adminGuildIds`) — no route bypasses guild-scoped authorization.

---

### Task 1: `requireGuildAdmin` middleware

**Files:**
- Create: `backend/src/http/middleware/requireGuildAdmin.ts`
- Test: `backend/src/http/middleware/requireGuildAdmin.test.ts`

**Interfaces:**
- Consumes: `AuthenticatedRequest` type from `backend/src/http/middleware/requireAuth.ts` (Phase 3a).
- Produces: `createRequireGuildAdmin(): RequestHandler`. Task 5 (`queueRoutes`) chains this after `requireAuth` on every route.

- [ ] **Step 1: Write the failing tests**

`backend/src/http/middleware/requireGuildAdmin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { signSessionToken } from '../../auth/jwt';
import { createRequireAuth } from './requireAuth';
import { createRequireGuildAdmin } from './requireGuildAdmin';

const SECRET = 'test-secret';

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/guilds/:guildId/protected', createRequireAuth(SECRET), createRequireGuildAdmin(), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('createRequireGuildAdmin', () => {
  it('allows the request when the guildId is in adminGuildIds', async () => {
    const app = buildTestApp();
    const token = signSessionToken({ userId: 'user-1', adminGuildIds: ['guild-1'] }, SECRET);

    const response = await request(app).get('/guilds/guild-1/protected').set('Cookie', [`session=${token}`]);

    expect(response.status).toBe(200);
  });

  it('rejects with 403 when the guildId is not in adminGuildIds', async () => {
    const app = buildTestApp();
    const token = signSessionToken({ userId: 'user-1', adminGuildIds: ['guild-other'] }, SECRET);

    const response = await request(app).get('/guilds/guild-1/protected').set('Cookie', [`session=${token}`]);

    expect(response.status).toBe(403);
  });

  it('rejects with 401 when there is no session at all', async () => {
    const app = buildTestApp();

    const response = await request(app).get('/guilds/guild-1/protected');

    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- requireGuildAdmin.test.ts`
Expected: FAIL with "Cannot find module './requireGuildAdmin'".

- [ ] **Step 3: Write the implementation**

`backend/src/http/middleware/requireGuildAdmin.ts`:

```ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthenticatedRequest } from './requireAuth';

export function createRequireGuildAdmin(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthenticatedRequest).user;
    const guildId = req.params.guildId;

    if (!user) {
      res.status(401).json({ message: 'unauthorized' });
      return;
    }

    if (!user.adminGuildIds.includes(guildId)) {
      res.status(403).json({ message: 'forbidden' });
      return;
    }

    next();
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- requireGuildAdmin.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/middleware/requireGuildAdmin.ts backend/src/http/middleware/requireGuildAdmin.test.ts
git commit -m "feat: add requireGuildAdmin middleware"
```

---

### Task 2: `guildsRoutes.ts` — `GET /api/guilds`

**Files:**
- Create: `backend/src/http/routes/guildsRoutes.ts`
- Test: `backend/src/http/routes/guildsRoutes.test.ts`

**Interfaces:**
- Consumes: `createRequireAuth`, `AuthenticatedRequest` from `backend/src/http/middleware/requireAuth.ts` (Phase 3a).
- Produces: `GuildInfo` type (`{ id: string; name: string }`), `GuildsRoutesConfig` type (`{ jwtSecret: string; getGuildInfo: (guildIds: string[]) => GuildInfo[] }`), `createGuildsRoutes(config: GuildsRoutesConfig): Router`. Task 6 (`createApp.ts`) mounts this at `/api/guilds`, building `getGuildInfo` from the real discord.js `client`.

- [ ] **Step 1: Write the failing tests**

`backend/src/http/routes/guildsRoutes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { signSessionToken } from '../../auth/jwt';
import { createGuildsRoutes, GuildsRoutesConfig } from './guildsRoutes';

const config: GuildsRoutesConfig = {
  jwtSecret: 'test-secret',
  getGuildInfo: (guildIds) => guildIds.map((id) => ({ id, name: `Guild ${id}` })),
};

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use('/api/guilds', createGuildsRoutes(config));
  return app;
}

describe('GET /api/guilds', () => {
  it('returns guild info for the admin guild ids in the session', async () => {
    const app = buildTestApp();
    const token = signSessionToken({ userId: 'user-1', adminGuildIds: ['guild-1', 'guild-2'] }, config.jwtSecret);

    const response = await request(app).get('/api/guilds').set('Cookie', [`session=${token}`]);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: 'guild-1', name: 'Guild guild-1' },
      { id: 'guild-2', name: 'Guild guild-2' },
    ]);
  });

  it('rejects without a session cookie', async () => {
    const app = buildTestApp();

    const response = await request(app).get('/api/guilds');

    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- guildsRoutes.test.ts`
Expected: FAIL with "Cannot find module './guildsRoutes'".

- [ ] **Step 3: Write the implementation**

`backend/src/http/routes/guildsRoutes.ts`:

```ts
import { Router, Request, Response } from 'express';
import { createRequireAuth, AuthenticatedRequest } from '../middleware/requireAuth';

export type GuildInfo = {
  id: string;
  name: string;
};

export type GuildsRoutesConfig = {
  jwtSecret: string;
  getGuildInfo: (guildIds: string[]) => GuildInfo[];
};

export function createGuildsRoutes(config: GuildsRoutesConfig): Router {
  const router = Router();
  const requireAuth = createRequireAuth(config.jwtSecret);

  router.get('/', requireAuth, (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user!;
    res.status(200).json(config.getGuildInfo(user.adminGuildIds));
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- guildsRoutes.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/guildsRoutes.ts backend/src/http/routes/guildsRoutes.test.ts
git commit -m "feat: add guildsRoutes (GET /api/guilds)"
```

---

### Task 3: `queueService.ts` — `addTrack`

**Files:**
- Create: `backend/src/services/queueService.ts`
- Test: `backend/src/services/queueService.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks in this plan.
- Produces: `NotInVoiceChannelError`, `NoSearchResultsError`, `VoiceConnectionError` error classes, and `addTrack(client: Client, player: Player, guildId: string, userId: string, query: string): Promise<void>`. Task 5 (`queueRoutes`) calls `addTrack` and catches these three error types to map to HTTP status codes.

- [ ] **Step 1: Write the failing tests**

`backend/src/services/queueService.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Client, Guild, GuildMember, VoiceBasedChannel } from 'discord.js';
import type { Player, GuildQueue, SearchResult, Track, Playlist } from 'discord-player';
import { addTrack, NotInVoiceChannelError, NoSearchResultsError, VoiceConnectionError } from './queueService';

function fakeTrack(): Track {
  return {
    id: 'track-1',
    title: 'Song',
    author: 'Author',
    url: 'https://example.com/track-1',
    thumbnail: 'https://example.com/thumb.png',
    durationMS: 1000,
  } as Track;
}

type BuildFakesOptions = {
  channelId?: string | null;
  searchResultOverrides?: { isEmpty?: () => boolean; playlist?: Playlist | null };
  queueChannel?: unknown;
  isPlaying?: boolean;
  connectImpl?: () => Promise<unknown>;
};

function buildFakes(options: BuildFakesOptions) {
  const track = fakeTrack();
  const searchResult = {
    isEmpty: () => false,
    playlist: null,
    tracks: [track],
    ...options.searchResultOverrides,
  } as SearchResult;

  const channel = { id: 'channel-1', isVoiceBased: () => true } as unknown as VoiceBasedChannel;

  const channelId = options.channelId === undefined ? 'channel-1' : options.channelId;
  const member = { voice: { channelId } } as unknown as GuildMember;

  const guild = {
    id: 'guild-1',
    members: { fetch: vi.fn().mockResolvedValue(member) },
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
  } as unknown as Guild;

  const client = {
    guilds: { fetch: vi.fn().mockResolvedValue(guild) },
  } as unknown as Client;

  const queue = {
    channel: options.queueChannel ?? null,
    connect: vi.fn(options.connectImpl ?? (() => Promise.resolve())),
    addTrack: vi.fn(),
    node: {
      isPlaying: vi.fn(() => options.isPlaying ?? false),
      play: vi.fn(() => Promise.resolve()),
    },
  } as unknown as GuildQueue;

  const player = {
    search: vi.fn().mockResolvedValue(searchResult),
    nodes: { create: vi.fn(() => queue) },
  } as unknown as Player;

  return { client, player, queue };
}

describe('addTrack', () => {
  it('searches, connects, adds the track, and starts playback', async () => {
    const { client, player, queue } = buildFakes({});

    await addTrack(client, player, 'guild-1', 'user-1', 'song query');

    expect(queue.connect).toHaveBeenCalledTimes(1);
    expect(queue.addTrack).toHaveBeenCalledTimes(1);
    expect(queue.node.play).toHaveBeenCalledTimes(1);
  });

  it('throws NotInVoiceChannelError when the user has no voice channel', async () => {
    const { client, player } = buildFakes({ channelId: null });

    await expect(addTrack(client, player, 'guild-1', 'user-1', 'song query')).rejects.toThrow(
      NotInVoiceChannelError,
    );
  });

  it('throws NoSearchResultsError when the search returns nothing', async () => {
    const { client, player } = buildFakes({ searchResultOverrides: { isEmpty: () => true } });

    await expect(addTrack(client, player, 'guild-1', 'user-1', 'song query')).rejects.toThrow(
      NoSearchResultsError,
    );
  });

  it('throws VoiceConnectionError when connecting to the channel fails', async () => {
    const { client, player } = buildFakes({
      connectImpl: () => Promise.reject(new Error('no permission')),
    });

    await expect(addTrack(client, player, 'guild-1', 'user-1', 'song query')).rejects.toThrow(
      VoiceConnectionError,
    );
  });

  it('does not reconnect when the queue already has a channel', async () => {
    const { client, player, queue } = buildFakes({ queueChannel: { id: 'channel-1' } });

    await addTrack(client, player, 'guild-1', 'user-1', 'song query');

    expect(queue.connect).not.toHaveBeenCalled();
  });

  it('does not call play again when the queue is already playing', async () => {
    const { client, player, queue } = buildFakes({ isPlaying: true });

    await addTrack(client, player, 'guild-1', 'user-1', 'song query');

    expect(queue.node.play).not.toHaveBeenCalled();
  });

  it('adds the playlist instead of a single track when the search result is a playlist', async () => {
    const fakePlaylist = { id: 'playlist-1' } as unknown as Playlist;
    const { client, player, queue } = buildFakes({ searchResultOverrides: { playlist: fakePlaylist } });

    await addTrack(client, player, 'guild-1', 'user-1', 'song query');

    expect(queue.addTrack).toHaveBeenCalledWith(fakePlaylist);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- queueService.test.ts`
Expected: FAIL with "Cannot find module './queueService'".

- [ ] **Step 3: Write the implementation**

`backend/src/services/queueService.ts`:

```ts
import type { Client } from 'discord.js';
import type { Player } from 'discord-player';

export class NotInVoiceChannelError extends Error {
  constructor() {
    super('you must be in a voice channel');
  }
}

export class NoSearchResultsError extends Error {
  constructor(query: string) {
    super(`no results found for "${query}"`);
  }
}

export class VoiceConnectionError extends Error {
  constructor() {
    super('missing voice permissions');
  }
}

export async function addTrack(
  client: Client,
  player: Player,
  guildId: string,
  userId: string,
  query: string,
): Promise<void> {
  const guild = await client.guilds.fetch(guildId);
  const member = await guild.members.fetch(userId);
  const channelId = member.voice.channelId;

  if (!channelId) {
    throw new NotInVoiceChannelError();
  }

  const channel = await guild.channels.fetch(channelId);
  if (!channel || !channel.isVoiceBased()) {
    throw new NotInVoiceChannelError();
  }

  const searchResult = await player.search(query, { requestedBy: userId });
  if (searchResult.isEmpty()) {
    throw new NoSearchResultsError(query);
  }

  const queue = player.nodes.create(guild);

  if (!queue.channel) {
    try {
      await queue.connect(channel);
    } catch {
      throw new VoiceConnectionError();
    }
  }

  if (searchResult.playlist) {
    queue.addTrack(searchResult.playlist);
  } else {
    queue.addTrack(searchResult.tracks[0]);
  }

  if (!queue.node.isPlaying()) {
    await queue.node.play();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- queueService.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/queueService.ts backend/src/services/queueService.test.ts
git commit -m "feat: add queueService.addTrack (search, connect, play)"
```

---

### Task 4: `queueService.ts` — control functions (skip, pause, resume, setVolume, remove, shuffle, stop)

**Files:**
- Modify: `backend/src/services/queueService.ts`
- Modify: `backend/src/services/queueService.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `InvalidVolumeError` error class, `skip`, `pause`, `resume`, `setVolume`, `remove`, `shuffle`, `stop` — all `(player: Player, guildId: string, ...) => boolean`, each returning `false` when `player.nodes.get(guildId)` is `null` (no active queue). Task 5 (`queueRoutes`) calls all seven and maps a `false` return to a 404 response.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/services/queueService.test.ts` (keep the existing `addTrack` tests, add these):

```ts
import { skip, pause, resume, setVolume, remove, shuffle, stop, InvalidVolumeError } from './queueService';

function fakeQueueForControls(overrides: Partial<{
  skip: () => boolean;
  pause: () => boolean;
  resume: () => boolean;
  setVolume: () => boolean;
  removeTrack: () => Track | null;
}> = {}): GuildQueue {
  return {
    node: {
      skip: vi.fn(overrides.skip ?? (() => true)),
      pause: vi.fn(overrides.pause ?? (() => true)),
      resume: vi.fn(overrides.resume ?? (() => true)),
      setVolume: vi.fn(overrides.setVolume ?? (() => true)),
    },
    removeTrack: vi.fn(overrides.removeTrack ?? (() => ({ id: 'track-1' }) as Track)),
    tracks: { shuffle: vi.fn() },
    delete: vi.fn(),
  } as unknown as GuildQueue;
}

function playerWithQueue(queue: GuildQueue | null): Player {
  return { nodes: { get: vi.fn(() => queue) } } as unknown as Player;
}

describe('skip', () => {
  it('returns false when there is no active queue', () => {
    expect(skip(playerWithQueue(null), 'guild-1')).toBe(false);
  });

  it('delegates to queue.node.skip() when a queue exists', () => {
    const queue = fakeQueueForControls();
    expect(skip(playerWithQueue(queue), 'guild-1')).toBe(true);
    expect(queue.node.skip).toHaveBeenCalledTimes(1);
  });
});

describe('pause', () => {
  it('returns false when there is no active queue', () => {
    expect(pause(playerWithQueue(null), 'guild-1')).toBe(false);
  });

  it('delegates to queue.node.pause() when a queue exists', () => {
    const queue = fakeQueueForControls();
    expect(pause(playerWithQueue(queue), 'guild-1')).toBe(true);
    expect(queue.node.pause).toHaveBeenCalledTimes(1);
  });
});

describe('resume', () => {
  it('returns false when there is no active queue', () => {
    expect(resume(playerWithQueue(null), 'guild-1')).toBe(false);
  });

  it('delegates to queue.node.resume() when a queue exists', () => {
    const queue = fakeQueueForControls();
    expect(resume(playerWithQueue(queue), 'guild-1')).toBe(true);
    expect(queue.node.resume).toHaveBeenCalledTimes(1);
  });
});

describe('setVolume', () => {
  it('throws InvalidVolumeError when volume is below 0', () => {
    expect(() => setVolume(playerWithQueue(null), 'guild-1', -1)).toThrow(InvalidVolumeError);
  });

  it('throws InvalidVolumeError when volume is above 100', () => {
    expect(() => setVolume(playerWithQueue(null), 'guild-1', 101)).toThrow(InvalidVolumeError);
  });

  it('returns false when there is no active queue', () => {
    expect(setVolume(playerWithQueue(null), 'guild-1', 50)).toBe(false);
  });

  it('delegates to queue.node.setVolume() when a queue exists', () => {
    const queue = fakeQueueForControls();
    expect(setVolume(playerWithQueue(queue), 'guild-1', 50)).toBe(true);
    expect(queue.node.setVolume).toHaveBeenCalledWith(50);
  });
});

describe('remove', () => {
  it('returns false when there is no active queue', () => {
    expect(remove(playerWithQueue(null), 'guild-1', 'track-1')).toBe(false);
  });

  it('returns true when the track is removed', () => {
    const queue = fakeQueueForControls();
    expect(remove(playerWithQueue(queue), 'guild-1', 'track-1')).toBe(true);
  });

  it('returns false when the track id does not match anything in the queue', () => {
    const queue = fakeQueueForControls({ removeTrack: () => null });
    expect(remove(playerWithQueue(queue), 'guild-1', 'missing-track')).toBe(false);
  });
});

describe('shuffle', () => {
  it('returns false when there is no active queue', () => {
    expect(shuffle(playerWithQueue(null), 'guild-1')).toBe(false);
  });

  it('shuffles the queue tracks when a queue exists', () => {
    const queue = fakeQueueForControls();
    expect(shuffle(playerWithQueue(queue), 'guild-1')).toBe(true);
    expect(queue.tracks.shuffle).toHaveBeenCalledTimes(1);
  });
});

describe('stop', () => {
  it('returns false when there is no active queue', () => {
    expect(stop(playerWithQueue(null), 'guild-1')).toBe(false);
  });

  it('deletes the queue when it exists', () => {
    const queue = fakeQueueForControls();
    expect(stop(playerWithQueue(queue), 'guild-1')).toBe(true);
    expect(queue.delete).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- queueService.test.ts`
Expected: FAIL — the new tests fail because `skip`/`pause`/`resume`/`setVolume`/`remove`/`shuffle`/`stop` don't exist yet in `queueService.ts`.

- [ ] **Step 3: Write the implementation**

Add to `backend/src/services/queueService.ts` (after `addTrack`):

```ts
export class InvalidVolumeError extends Error {
  constructor() {
    super('volume must be between 0 and 100');
  }
}

export function skip(player: Player, guildId: string): boolean {
  const queue = player.nodes.get(guildId);
  if (!queue) return false;
  return queue.node.skip();
}

export function pause(player: Player, guildId: string): boolean {
  const queue = player.nodes.get(guildId);
  if (!queue) return false;
  return queue.node.pause();
}

export function resume(player: Player, guildId: string): boolean {
  const queue = player.nodes.get(guildId);
  if (!queue) return false;
  return queue.node.resume();
}

export function setVolume(player: Player, guildId: string, volume: number): boolean {
  if (volume < 0 || volume > 100) {
    throw new InvalidVolumeError();
  }

  const queue = player.nodes.get(guildId);
  if (!queue) return false;
  return queue.node.setVolume(volume);
}

export function remove(player: Player, guildId: string, trackId: string): boolean {
  const queue = player.nodes.get(guildId);
  if (!queue) return false;
  return queue.removeTrack(trackId) !== null;
}

export function shuffle(player: Player, guildId: string): boolean {
  const queue = player.nodes.get(guildId);
  if (!queue) return false;
  queue.tracks.shuffle();
  return true;
}

export function stop(player: Player, guildId: string): boolean {
  const queue = player.nodes.get(guildId);
  if (!queue) return false;
  queue.delete();
  return true;
}
```

Also add `import type { GuildQueue, Track } from 'discord-player';` and `import { describe, it, expect, vi } from 'vitest';` (already present) to the top of `queueService.test.ts` for the new helper types used above — `GuildQueue`, `Track`, and `Player` types are needed by `fakeQueueForControls` and `playerWithQueue`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- queueService.test.ts`
Expected: PASS, 24 tests (7 from Task 3's `addTrack` + 17 new: 2 skip, 2 pause, 2 resume, 4 setVolume, 3 remove, 2 shuffle, 2 stop).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/queueService.ts backend/src/services/queueService.test.ts
git commit -m "feat: add queueService control functions (skip, pause, resume, volume, remove, shuffle, stop)"
```

---

### Task 5: `queueRoutes.ts` — REST surface for queue control

**Files:**
- Create: `backend/src/http/routes/queueRoutes.ts`
- Test: `backend/src/http/routes/queueRoutes.test.ts`

**Interfaces:**
- Consumes: all of `queueService` (Tasks 3-4), `buildQueueSnapshot` from `backend/src/sockets/buildQueueSnapshot.ts` (Phase 2), `createRequireAuth` + `AuthenticatedRequest` (Phase 3a), `createRequireGuildAdmin` (Task 1).
- Produces: `QueueRoutesConfig` type (`{ jwtSecret: string; client: Client; player: Player }`), `createQueueRoutes(config: QueueRoutesConfig): Router`. Task 6 mounts this at `/api/guilds/:guildId/queue` with `{ mergeParams: true }` already built into the router so it can read `req.params.guildId` from the parent mount path.

- [ ] **Step 1: Write the failing tests**

`backend/src/http/routes/queueRoutes.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Client } from 'discord.js';
import type { Player, GuildQueue } from 'discord-player';
import { signSessionToken } from '../../auth/jwt';
import * as queueService from '../../services/queueService';
import { createQueueRoutes, QueueRoutesConfig } from './queueRoutes';

const SECRET = 'test-secret';

function buildTestApp(player: Player) {
  const config: QueueRoutesConfig = {
    jwtSecret: SECRET,
    client: {} as Client,
    player,
  };
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/guilds/:guildId/queue', createQueueRoutes(config));
  return app;
}

function tokenFor(guildIds: string[]): string {
  return signSessionToken({ userId: 'user-1', adminGuildIds: guildIds }, SECRET);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/guilds/:guildId/queue', () => {
  it('returns an idle snapshot when there is no active queue', async () => {
    const player = { nodes: { get: vi.fn(() => null) } } as unknown as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .get('/api/guilds/guild-1/queue')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`]);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'idle', currentTrack: null, queue: [], volume: 100, progressMs: 0 });
  });

  it('rejects when the guild is not in the caller\'s adminGuildIds', async () => {
    const player = { nodes: { get: vi.fn(() => null) } } as unknown as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .get('/api/guilds/guild-1/queue')
      .set('Cookie', [`session=${tokenFor(['guild-other'])}`]);

    expect(response.status).toBe(403);
  });
});

describe('POST /api/guilds/:guildId/queue', () => {
  it('adds the track and returns the resulting snapshot', async () => {
    vi.spyOn(queueService, 'addTrack').mockResolvedValue(undefined);
    const player = { nodes: { get: vi.fn(() => null) } } as unknown as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .post('/api/guilds/guild-1/queue')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`])
      .send({ query: 'never gonna give you up' });

    expect(response.status).toBe(200);
    expect(queueService.addTrack).toHaveBeenCalledWith(expect.anything(), player, 'guild-1', 'user-1', 'never gonna give you up');
  });

  it('rejects with 400 when the query is missing', async () => {
    const player = { nodes: { get: vi.fn(() => null) } } as unknown as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .post('/api/guilds/guild-1/queue')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`])
      .send({});

    expect(response.status).toBe(400);
  });

  it('maps NotInVoiceChannelError to 400', async () => {
    vi.spyOn(queueService, 'addTrack').mockRejectedValue(new queueService.NotInVoiceChannelError());
    const player = { nodes: { get: vi.fn(() => null) } } as unknown as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .post('/api/guilds/guild-1/queue')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`])
      .send({ query: 'song' });

    expect(response.status).toBe(400);
  });

  it('maps NoSearchResultsError to 404', async () => {
    vi.spyOn(queueService, 'addTrack').mockRejectedValue(new queueService.NoSearchResultsError('song'));
    const player = { nodes: { get: vi.fn(() => null) } } as unknown as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .post('/api/guilds/guild-1/queue')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`])
      .send({ query: 'song' });

    expect(response.status).toBe(404);
  });
});

describe('POST /api/guilds/:guildId/queue/skip', () => {
  it('returns 200 when the skip succeeds', async () => {
    vi.spyOn(queueService, 'skip').mockReturnValue(true);
    const player = {} as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .post('/api/guilds/guild-1/queue/skip')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`]);

    expect(response.status).toBe(200);
  });

  it('returns 404 when there is no active queue', async () => {
    vi.spyOn(queueService, 'skip').mockReturnValue(false);
    const player = {} as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .post('/api/guilds/guild-1/queue/skip')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`]);

    expect(response.status).toBe(404);
  });
});

describe('PUT /api/guilds/:guildId/queue/volume', () => {
  it('rejects with 400 when volume is not a number', async () => {
    const player = {} as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .put('/api/guilds/guild-1/queue/volume')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`])
      .send({ volume: 'loud' });

    expect(response.status).toBe(400);
  });

  it('rejects with 400 when queueService.setVolume throws InvalidVolumeError', async () => {
    vi.spyOn(queueService, 'setVolume').mockImplementation(() => {
      throw new queueService.InvalidVolumeError();
    });
    const player = {} as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .put('/api/guilds/guild-1/queue/volume')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`])
      .send({ volume: 500 });

    expect(response.status).toBe(400);
  });

  it('returns 200 when the volume is set successfully', async () => {
    vi.spyOn(queueService, 'setVolume').mockReturnValue(true);
    const player = {} as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .put('/api/guilds/guild-1/queue/volume')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`])
      .send({ volume: 50 });

    expect(response.status).toBe(200);
  });
});

describe('DELETE /api/guilds/:guildId/queue/track/:trackId', () => {
  it('returns 200 when the track is removed', async () => {
    vi.spyOn(queueService, 'remove').mockReturnValue(true);
    const player = {} as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .delete('/api/guilds/guild-1/queue/track/track-1')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`]);

    expect(response.status).toBe(200);
  });

  it('returns 404 when there is nothing to remove', async () => {
    vi.spyOn(queueService, 'remove').mockReturnValue(false);
    const player = {} as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .delete('/api/guilds/guild-1/queue/track/track-1')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`]);

    expect(response.status).toBe(404);
  });
});
```

Note: this test file mocks `queueService`'s named exports with `vi.spyOn(queueService, '...')`, which requires `queueRoutes.ts` to call these functions via a namespace import (`import * as queueService from '../../services/queueService'`) — same reason as `authRoutes.ts` in Phase 3a.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- queueRoutes.test.ts`
Expected: FAIL with "Cannot find module './queueRoutes'".

- [ ] **Step 3: Write the implementation**

`backend/src/http/routes/queueRoutes.ts`:

```ts
import { Router, Request, Response } from 'express';
import type { Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as queueService from '../../services/queueService';
import { buildQueueSnapshot } from '../../sockets/buildQueueSnapshot';
import { createRequireAuth, AuthenticatedRequest } from '../middleware/requireAuth';
import { createRequireGuildAdmin } from '../middleware/requireGuildAdmin';

export type QueueRoutesConfig = {
  jwtSecret: string;
  client: Client;
  player: Player;
};

export function createQueueRoutes(config: QueueRoutesConfig): Router {
  const router = Router({ mergeParams: true });
  const requireAuth = createRequireAuth(config.jwtSecret);
  const requireGuildAdmin = createRequireGuildAdmin();

  router.use(requireAuth, requireGuildAdmin);

  router.get('/', (req: Request, res: Response) => {
    const queue = config.player.nodes.get(req.params.guildId);
    res.status(200).json(buildQueueSnapshot(queue));
  });

  router.post('/', async (req: Request, res: Response) => {
    const { query } = req.body as { query?: string };
    const user = (req as AuthenticatedRequest).user!;

    if (typeof query !== 'string' || query.length === 0) {
      res.status(400).json({ message: 'query is required' });
      return;
    }

    try {
      await queueService.addTrack(config.client, config.player, req.params.guildId, user.userId, query);
      res.status(200).json(buildQueueSnapshot(config.player.nodes.get(req.params.guildId)));
    } catch (error) {
      if (error instanceof queueService.NotInVoiceChannelError) {
        res.status(400).json({ message: error.message });
      } else if (error instanceof queueService.NoSearchResultsError) {
        res.status(404).json({ message: error.message });
      } else if (error instanceof queueService.VoiceConnectionError) {
        res.status(403).json({ message: error.message });
      } else {
        res.status(502).json({ message: 'failed to add track' });
      }
    }
  });

  router.post('/skip', (req: Request, res: Response) => {
    const ok = queueService.skip(config.player, req.params.guildId);
    if (!ok) {
      res.status(404).json({ message: 'no active queue for this guild' });
      return;
    }
    res.status(200).json({ message: 'skipped' });
  });

  router.post('/pause', (req: Request, res: Response) => {
    const ok = queueService.pause(config.player, req.params.guildId);
    if (!ok) {
      res.status(404).json({ message: 'no active queue for this guild' });
      return;
    }
    res.status(200).json({ message: 'paused' });
  });

  router.post('/resume', (req: Request, res: Response) => {
    const ok = queueService.resume(config.player, req.params.guildId);
    if (!ok) {
      res.status(404).json({ message: 'no active queue for this guild' });
      return;
    }
    res.status(200).json({ message: 'resumed' });
  });

  router.put('/volume', (req: Request, res: Response) => {
    const { volume } = req.body as { volume?: unknown };

    if (typeof volume !== 'number') {
      res.status(400).json({ message: 'volume must be a number' });
      return;
    }

    try {
      const ok = queueService.setVolume(config.player, req.params.guildId, volume);
      if (!ok) {
        res.status(404).json({ message: 'no active queue for this guild' });
        return;
      }
      res.status(200).json({ message: 'volume updated' });
    } catch (error) {
      if (error instanceof queueService.InvalidVolumeError) {
        res.status(400).json({ message: error.message });
        return;
      }
      throw error;
    }
  });

  router.delete('/track/:trackId', (req: Request, res: Response) => {
    const ok = queueService.remove(config.player, req.params.guildId, req.params.trackId);
    if (!ok) {
      res.status(404).json({ message: 'no active queue for this guild' });
      return;
    }
    res.status(200).json({ message: 'removed' });
  });

  router.post('/shuffle', (req: Request, res: Response) => {
    const ok = queueService.shuffle(config.player, req.params.guildId);
    if (!ok) {
      res.status(404).json({ message: 'no active queue for this guild' });
      return;
    }
    res.status(200).json({ message: 'shuffled' });
  });

  router.post('/stop', (req: Request, res: Response) => {
    const ok = queueService.stop(config.player, req.params.guildId);
    if (!ok) {
      res.status(404).json({ message: 'no active queue for this guild' });
      return;
    }
    res.status(200).json({ message: 'stopped' });
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- queueRoutes.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/queueRoutes.ts backend/src/http/routes/queueRoutes.test.ts
git commit -m "feat: add queueRoutes REST surface for queue control"
```

---

### Task 6: Wire `guildsRoutes` + `queueRoutes` into `createApp`, update `index.ts`

**Files:**
- Modify: `backend/src/http/createApp.ts`
- Modify: `backend/src/http/createApp.test.ts`
- Modify: `backend/src/http/createHttpServer.test.ts`
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `createGuildsRoutes` (Task 2), `createQueueRoutes` (Task 5).
- Produces: `createApp(authRoutesConfig: AuthRoutesConfig, client: Client, player: Player): Express` — this changes `createApp`'s signature again (Phase 3a had `createApp(authRoutesConfig): Express`), so both existing test files that call it must be updated in this task. No later task in this plan depends on this file.

- [ ] **Step 1: Update `createApp.ts`**

`backend/src/http/createApp.ts`:

```ts
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import type { Client } from 'discord.js';
import type { Player } from 'discord-player';
import { createAuthRoutes, AuthRoutesConfig } from './routes/authRoutes';
import { createGuildsRoutes } from './routes/guildsRoutes';
import { createQueueRoutes } from './routes/queueRoutes';

export function createApp(authRoutesConfig: AuthRoutesConfig, client: Client, player: Player): Express {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', createAuthRoutes(authRoutesConfig));

  app.use(
    '/api/guilds',
    createGuildsRoutes({
      jwtSecret: authRoutesConfig.jwtSecret,
      getGuildInfo: (guildIds) =>
        guildIds.map((id) => ({ id, name: client.guilds.cache.get(id)?.name ?? 'Unknown guild' })),
    }),
  );

  app.use(
    '/api/guilds/:guildId/queue',
    createQueueRoutes({ jwtSecret: authRoutesConfig.jwtSecret, client, player }),
  );

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
import { createDiscordClient } from '../bot/createDiscordClient';
import { createPlayer } from '../bot/createPlayer';

const testAuthConfig: AuthRoutesConfig = {
  oauth: { clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'http://localhost:3001/api/auth/callback' },
  jwtSecret: 'test-secret',
  frontendUrl: 'http://localhost:5173',
  isProduction: false,
  getBotGuildIds: () => [],
};

describe('createApp', () => {
  it('responds to GET /health with status ok', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const app = createApp(testAuthConfig, client, player);
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
import { createDiscordClient } from '../bot/createDiscordClient';
import { createPlayer } from '../bot/createPlayer';

const testAuthConfig: AuthRoutesConfig = {
  oauth: { clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'http://localhost:3001/api/auth/callback' },
  jwtSecret: 'test-secret',
  frontendUrl: 'http://localhost:5173',
  isProduction: false,
  getBotGuildIds: () => [],
};

describe('createHttpServer', () => {
  it('serves the express app over a real http.Server', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const app = createApp(testAuthConfig, client, player);
    const server = createHttpServer(app);

    const response = await request(server).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

Run: `pnpm --filter backend test`
Expected: PASS, all 93 tests: 51 carried over from Phases 1-3a (`createApp`/`createHttpServer` keep 1 test each, just rewritten for the new signature — no count change there) + 3 from Task 1 (`requireGuildAdmin`) + 2 from Task 2 (`guildsRoutes`) + 24 from Tasks 3-4 (`queueService`) + 13 from Task 5 (`queueRoutes`).

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

  const app = createApp(
    {
      oauth: {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        redirectUri: `${env.BACKEND_BASE_URL}/api/auth/callback`,
      },
      jwtSecret: env.JWT_SECRET,
      frontendUrl: env.FRONTEND_URL,
      isProduction: env.NODE_ENV === 'production',
      getBotGuildIds: () => client.guilds.cache.map((guild) => guild.id),
    },
    client,
    player,
  );
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

Same limitation as Phases 1-3a: no real Discord bot token, voice channel, or browser exists in the development environment used to build this plan. This step is a pending manual check for the user, not something the implementer can execute:

With `backend/.env` filled in with real credentials, and the bot invited to a real server: join a voice channel, obtain a `session` cookie by completing `/api/auth/login` in a browser, then use that cookie to `curl -X POST http://localhost:3001/api/guilds/<guildId>/queue -H "Content-Type: application/json" -H "Cookie: session=<token>" -d '{"query":"never gonna give you up"}'` — expect the bot to join your voice channel and start playing, and the response body to be a `playing` snapshot.

- [ ] **Step 8: Commit**

```bash
git add backend/src/http/createApp.ts backend/src/http/createApp.test.ts backend/src/http/createHttpServer.test.ts backend/src/index.ts
git commit -m "feat: wire guildsRoutes and queueRoutes into createApp and index.ts"
```
