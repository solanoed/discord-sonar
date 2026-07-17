# WebSockets (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real-time sync infrastructure — an http.Server shared by Express and socket.io, room-per-guild join/leave, and a single `playerEventBridge` that pushes a normalized queue snapshot to the right guild room whenever discord-player's `GuildQueue` changes.

**Architecture:** Same factory-function style as Phase 1: small, independently-testable units (`buildQueueSnapshot`, `createHttpServer`, `createSocketServer`, `registerPlayerEventBridge`) composed in `src/index.ts`. No auth yet (JWT lands in Phase 3) — sockets are open, a client joins a room by sending a `guildId` it already knows. No queue-mutation actions yet (`queueService` lands in Phase 3/4) — this phase is read-only real-time sync.

**Tech Stack:** socket.io (server) + socket.io-client (dev dependency, tests only), Node's built-in `http`, discord-player's `GuildQueueEvent` API (confirmed against the installed v7.2.0 types), vitest.

## Global Constraints

- Node.js ≥ 18.17.
- Backend TypeScript compiles to CommonJS, not ESM.
- Zero comments in any source code file.
- Package manager: pnpm, existing monorepo (`backend/`).
- Testing: vitest; TDD — failing test before implementation on every task with testable logic.
- No placeholder/TODO code.
- No auth on sockets this phase (explicit, confirmed decision — do not add JWT/token checks; that's Phase 3 scope).
- No queue-mutation actions this phase (no play/skip/pause emit handlers — read-only sync only).

---

### Task 1: `buildQueueSnapshot` — normalize a GuildQueue into a wire-safe snapshot

**Files:**
- Create: `backend/src/sockets/buildQueueSnapshot.ts`
- Test: `backend/src/sockets/buildQueueSnapshot.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `QueueSnapshotTrack`, `QueueSnapshot` types, and `buildQueueSnapshot(queue: GuildQueue | null): QueueSnapshot`. Task 3 (`createSocketServer`) and Task 4 (`playerEventBridge`) both import this function and its types.

- [ ] **Step 1: Write the failing tests**

`backend/src/sockets/buildQueueSnapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { GuildQueue, Track } from 'discord-player';
import { buildQueueSnapshot } from './buildQueueSnapshot';

function fakeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Test Song',
    author: 'Test Author',
    url: 'https://example.com/track-1',
    thumbnail: 'https://example.com/thumb.png',
    durationMS: 123000,
    ...overrides,
  } as Track;
}

describe('buildQueueSnapshot', () => {
  it('returns an idle default snapshot when queue is null', () => {
    expect(buildQueueSnapshot(null)).toEqual({
      status: 'idle',
      currentTrack: null,
      queue: [],
      volume: 100,
      progressMs: 0,
    });
  });

  it('maps a playing queue to a playing snapshot', () => {
    const current = fakeTrack({ id: 'current', title: 'Now Playing' });
    const queued = fakeTrack({ id: 'queued', title: 'Up Next' });

    const queue = {
      guild: { id: 'guild-1' },
      currentTrack: current,
      tracks: { toArray: () => [queued] },
      node: {
        isPaused: () => false,
        isPlaying: () => true,
        volume: 80,
        playbackTime: 45000,
      },
    } as unknown as GuildQueue;

    expect(buildQueueSnapshot(queue)).toEqual({
      status: 'playing',
      currentTrack: {
        id: 'current',
        title: 'Now Playing',
        author: 'Test Author',
        url: 'https://example.com/track-1',
        thumbnail: 'https://example.com/thumb.png',
        durationMs: 123000,
      },
      queue: [
        {
          id: 'queued',
          title: 'Up Next',
          author: 'Test Author',
          url: 'https://example.com/track-1',
          thumbnail: 'https://example.com/thumb.png',
          durationMs: 123000,
        },
      ],
      volume: 80,
      progressMs: 45000,
    });
  });

  it('maps a paused queue to a paused snapshot', () => {
    const queue = {
      guild: { id: 'guild-1' },
      currentTrack: fakeTrack(),
      tracks: { toArray: () => [] },
      node: {
        isPaused: () => true,
        isPlaying: () => false,
        volume: 100,
        playbackTime: 1000,
      },
    } as unknown as GuildQueue;

    expect(buildQueueSnapshot(queue).status).toBe('paused');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- buildQueueSnapshot.test.ts`
Expected: FAIL with "Cannot find module './buildQueueSnapshot'".

- [ ] **Step 3: Write the implementation**

`backend/src/sockets/buildQueueSnapshot.ts`:

```ts
import type { GuildQueue, Track } from 'discord-player';

export type QueueSnapshotTrack = {
  id: string;
  title: string;
  author: string;
  url: string;
  thumbnail: string;
  durationMs: number;
};

export type QueueSnapshot = {
  status: 'idle' | 'playing' | 'paused';
  currentTrack: QueueSnapshotTrack | null;
  queue: QueueSnapshotTrack[];
  volume: number;
  progressMs: number;
};

function toSnapshotTrack(track: Track): QueueSnapshotTrack {
  return {
    id: track.id,
    title: track.title,
    author: track.author,
    url: track.url,
    thumbnail: track.thumbnail,
    durationMs: track.durationMS,
  };
}

export function buildQueueSnapshot(queue: GuildQueue | null): QueueSnapshot {
  if (!queue) {
    return {
      status: 'idle',
      currentTrack: null,
      queue: [],
      volume: 100,
      progressMs: 0,
    };
  }

  const status: QueueSnapshot['status'] = queue.node.isPaused()
    ? 'paused'
    : queue.node.isPlaying()
      ? 'playing'
      : 'idle';

  return {
    status,
    currentTrack: queue.currentTrack ? toSnapshotTrack(queue.currentTrack) : null,
    queue: queue.tracks.toArray().map(toSnapshotTrack),
    volume: queue.node.volume,
    progressMs: queue.node.playbackTime,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- buildQueueSnapshot.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sockets/buildQueueSnapshot.ts backend/src/sockets/buildQueueSnapshot.test.ts
git commit -m "feat: add buildQueueSnapshot to normalize GuildQueue state"
```

---

### Task 2: `createHttpServer` — wrap the Express app in a Node http.Server

**Files:**
- Create: `backend/src/http/createHttpServer.ts`
- Test: `backend/src/http/createHttpServer.test.ts`

**Interfaces:**
- Consumes: `createApp(): Express` from Phase 1 (`backend/src/http/createApp.ts`).
- Produces: `createHttpServer(app: Express): HttpServer` (Node's `http.Server`). Task 3 consumes this to attach socket.io; Task 5 consumes this to call `.listen(...)` instead of `app.listen(...)`.

- [ ] **Step 1: Write the failing test**

`backend/src/http/createHttpServer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './createApp';
import { createHttpServer } from './createHttpServer';

describe('createHttpServer', () => {
  it('serves the express app over a real http.Server', async () => {
    const app = createApp();
    const server = createHttpServer(app);

    const response = await request(server).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter backend test -- createHttpServer.test.ts`
Expected: FAIL with "Cannot find module './createHttpServer'".

- [ ] **Step 3: Write the implementation**

`backend/src/http/createHttpServer.ts`:

```ts
import { createServer, Server as HttpServer } from 'http';
import { Express } from 'express';

export function createHttpServer(app: Express): HttpServer {
  return createServer(app);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter backend test -- createHttpServer.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/createHttpServer.ts backend/src/http/createHttpServer.test.ts
git commit -m "feat: add createHttpServer to share the port between express and socket.io"
```

---

### Task 3: Install socket.io, `createSocketServer` — rooms + guild:join/guild:leave

**Files:**
- Modify: `backend/package.json` (add `socket.io` dependency, `socket.io-client` dev dependency)
- Create: `backend/src/sockets/createSocketServer.ts`
- Test: `backend/src/sockets/createSocketServer.test.ts`

**Interfaces:**
- Consumes: `buildQueueSnapshot(queue): QueueSnapshot` (Task 1), `createHttpServer(app): HttpServer` (Task 2, used only in the test to get a real server), `Player` from discord-player (its `.nodes.get(guildId): GuildQueue | null`).
- Produces: `createSocketServer(httpServer: HttpServer, player: Player): Server` (socket.io `Server`). Task 4 does not consume this directly (it receives the `Server` instance separately in `index.ts`); Task 5 wires this into `index.ts`.

- [ ] **Step 1: Add socket.io dependencies**

Edit `backend/package.json`: add to `"dependencies"`:

```json
    "socket.io": "^4.8.1",
```

and to `"devDependencies"`:

```json
    "socket.io-client": "^4.8.1",
```

Run: `pnpm install`
Expected: install completes, `socket.io` and `socket.io-client` appear in `backend/node_modules`.

- [ ] **Step 2: Write the failing test**

`backend/src/sockets/createSocketServer.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'http';
import type { Server as HttpServer } from 'http';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import type { Server } from 'socket.io';
import { createDiscordClient } from '../bot/createDiscordClient';
import { createPlayer } from '../bot/createPlayer';
import { createSocketServer } from './createSocketServer';

describe('createSocketServer', () => {
  let httpServer: HttpServer;
  let io: Server;
  let clientSocket: ClientSocket;

  afterEach(() => {
    clientSocket?.close();
    io?.close();
    httpServer?.close();
  });

  it('joins the guild room and replies with the initial idle snapshot', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    httpServer = createServer();
    io = createSocketServer(httpServer, player);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    clientSocket = ioClient(`http://localhost:${port}`);

    const snapshot = await new Promise((resolve) => {
      clientSocket.on('connect', () => {
        clientSocket.emit('guild:join', { guildId: 'guild-1' });
      });
      clientSocket.on('queue:state', resolve);
    });

    expect(snapshot).toEqual({
      status: 'idle',
      currentTrack: null,
      queue: [],
      volume: 100,
      progressMs: 0,
    });
  });

  it('emits an error and does not join when guildId is missing', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    httpServer = createServer();
    io = createSocketServer(httpServer, player);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    clientSocket = ioClient(`http://localhost:${port}`);

    const errorPayload = await new Promise((resolve) => {
      clientSocket.on('connect', () => {
        clientSocket.emit('guild:join', {});
      });
      clientSocket.on('error', resolve);
    });

    expect(errorPayload).toEqual({ message: 'guild:join requires a valid guildId' });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter backend test -- createSocketServer.test.ts`
Expected: FAIL with "Cannot find module './createSocketServer'".

- [ ] **Step 4: Write the implementation**

`backend/src/sockets/createSocketServer.ts`:

```ts
import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { Player } from 'discord-player';
import { buildQueueSnapshot } from './buildQueueSnapshot';

type GuildRoomPayload = {
  guildId?: string;
};

function isValidGuildId(payload: GuildRoomPayload | undefined): payload is { guildId: string } {
  return typeof payload?.guildId === 'string' && payload.guildId.length > 0;
}

export function createSocketServer(httpServer: HttpServer, player: Player): Server {
  const io = new Server(httpServer);

  io.on('connection', (socket) => {
    socket.on('guild:join', (payload: GuildRoomPayload) => {
      if (!isValidGuildId(payload)) {
        socket.emit('error', { message: 'guild:join requires a valid guildId' });
        return;
      }

      socket.join(`guild:${payload.guildId}`);
      const queue = player.nodes.get(payload.guildId);
      socket.emit('queue:state', buildQueueSnapshot(queue));
    });

    socket.on('guild:leave', (payload: GuildRoomPayload) => {
      if (isValidGuildId(payload)) {
        socket.leave(`guild:${payload.guildId}`);
      }
    });
  });

  return io;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter backend test -- createSocketServer.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json pnpm-lock.yaml backend/src/sockets/createSocketServer.ts backend/src/sockets/createSocketServer.test.ts
git commit -m "feat: add socket.io server with room-per-guild join/leave"
```

Note: `pnpm install` updates the workspace-root `pnpm-lock.yaml` (at the repo root, not inside `backend/`) — run `git status` first to confirm the exact changed path before staging.

---

### Task 4: `registerPlayerEventBridge` — push snapshots to guild rooms on player events

**Files:**
- Create: `backend/src/sockets/playerEventBridge.ts`
- Test: `backend/src/sockets/playerEventBridge.test.ts`

**Interfaces:**
- Consumes: `buildQueueSnapshot(queue): QueueSnapshot` (Task 1); `Server` type from `socket.io` (installed in Task 3); `GuildQueueEvent`, `Player`, `GuildQueue` from `discord-player`.
- Produces: `registerPlayerEventBridge(player: Player, io: Server): void`. Task 5 calls this once at boot, after both `player` and `io` exist.

- [ ] **Step 1: Write the failing test**

`backend/src/sockets/playerEventBridge.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { GuildQueueEvent } from 'discord-player';
import type { GuildQueue, Track } from 'discord-player';
import type { Server } from 'socket.io';
import { createDiscordClient } from '../bot/createDiscordClient';
import { createPlayer } from '../bot/createPlayer';
import { registerPlayerEventBridge } from './playerEventBridge';

function fakeQueue(): GuildQueue {
  return {
    guild: { id: 'guild-1' },
    currentTrack: null,
    tracks: { toArray: () => [] },
    node: {
      isPaused: () => false,
      isPlaying: () => false,
      volume: 100,
      playbackTime: 0,
    },
  } as unknown as GuildQueue;
}

function fakeTrack(): Track {
  return { id: 't1', title: 'T', author: 'A', url: 'u', thumbnail: 'th', durationMS: 1000 } as Track;
}

describe('registerPlayerEventBridge', () => {
  it('broadcasts a snapshot to the guild room when PlayerStart fires', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const io = { to } as unknown as Server;

    registerPlayerEventBridge(player, io);
    player.events.emit(GuildQueueEvent.PlayerStart, fakeQueue(), fakeTrack());

    expect(to).toHaveBeenCalledWith('guild:guild-1');
    expect(emit).toHaveBeenCalledWith('queue:state', {
      status: 'idle',
      currentTrack: null,
      queue: [],
      volume: 100,
      progressMs: 0,
    });
  });

  it('broadcasts on every bridged event, not just PlayerStart', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const io = { to } as unknown as Server;

    registerPlayerEventBridge(player, io);
    player.events.emit(GuildQueueEvent.PlayerSkip, fakeQueue(), fakeTrack(), 0, 'manual skip');
    player.events.emit(GuildQueueEvent.Disconnect, fakeQueue());

    expect(to).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- playerEventBridge.test.ts`
Expected: FAIL with "Cannot find module './playerEventBridge'".

- [ ] **Step 3: Write the implementation**

`backend/src/sockets/playerEventBridge.ts`:

```ts
import type { Server } from 'socket.io';
import { GuildQueueEvent } from 'discord-player';
import type { GuildQueue, Player } from 'discord-player';
import { buildQueueSnapshot } from './buildQueueSnapshot';

const BRIDGED_EVENTS = [
  GuildQueueEvent.PlayerStart,
  GuildQueueEvent.AudioTrackAdd,
  GuildQueueEvent.AudioTracksAdd,
  GuildQueueEvent.AudioTrackRemove,
  GuildQueueEvent.PlayerSkip,
  GuildQueueEvent.PlayerPause,
  GuildQueueEvent.PlayerResume,
  GuildQueueEvent.VolumeChange,
  GuildQueueEvent.EmptyQueue,
  GuildQueueEvent.Disconnect,
  GuildQueueEvent.PlayerError,
] as const;

export function registerPlayerEventBridge(player: Player, io: Server): void {
  const broadcast = (queue: GuildQueue): void => {
    const snapshot = buildQueueSnapshot(queue);
    io.to(`guild:${queue.guild.id}`).emit('queue:state', snapshot);
  };

  for (const event of BRIDGED_EVENTS) {
    player.events.on(event, broadcast);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- playerEventBridge.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sockets/playerEventBridge.ts backend/src/sockets/playerEventBridge.test.ts
git commit -m "feat: add playerEventBridge to broadcast queue snapshots on player events"
```

---

### Task 5: Wire `index.ts` — http server + socket server + event bridge

**Files:**
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `createHttpServer(app)` (Task 2), `createSocketServer(httpServer, player)` (Task 3), `registerPlayerEventBridge(player, io)` (Task 4), plus the Phase 1 factories already wired (`loadEnv`, `createDiscordClient`, `createPlayer`, `createApp`).
- Produces: the running backend process. No further tasks in this plan consume this file.

- [ ] **Step 1: Replace the entry point wiring**

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

  const app = createApp();
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

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `pnpm --filter backend test`
Expected: PASS, all 16 tests (8 from Phase 1 + 3 buildQueueSnapshot + 1 createHttpServer + 2 createSocketServer + 2 playerEventBridge).

- [ ] **Step 3: Manual verification with a real bot token**

No real `DISCORD_TOKEN` was available during Phase 1 either — this step is still a pending manual check for the user (documented in `backend/README.md`).

Run: `pnpm --filter backend dev`
Expected console output, in order: `HTTP server listening on port 3001`, then `Logged in as <bot-tag>`.

In a second terminal, verify the socket layer is live (requires `node` and `socket.io-client` — this can be run from `backend/` since it's already a dependency there):

```bash
node -e "
const { io } = require('socket.io-client');
const socket = io('http://localhost:3001');
socket.on('connect', () => socket.emit('guild:join', { guildId: 'test-guild' }));
socket.on('queue:state', (snapshot) => { console.log('snapshot:', snapshot); process.exit(0); });
"
```

Expected: prints `snapshot: { status: 'idle', currentTrack: null, queue: [], volume: 100, progressMs: 0 }`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat: wire http server, socket server, and player event bridge in entry point"
```
