# Real-Time Sync (Phase 5b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect `GuildDetailPage` to the backend's socket.io server (Phase 2) for live queue state, and — closing a gap deliberately deferred since Phase 2 — add auth to the socket handshake so only a guild's actual admins can join its room. Read-only: no playback control buttons yet (that's Phase 5c).

**Architecture:** The socket handshake is a real HTTP request (engine.io intercepts it before Express's middleware chain ever runs, so `cookie-parser` doesn't apply here) — the `session` httpOnly cookie is parsed manually from the raw `Cookie` header inside a socket.io connection middleware (`io.use(...)`), then verified with the same `verifySessionToken` REST already uses. `guild:join` now checks the verified `adminGuildIds` before joining the room — same authorization shape as `requireGuildAdmin`, just applied at the socket layer instead of Express middleware. Frontend: `socketClient.createSocketConnection()` wraps `socket.io-client` with `withCredentials: true` (so the cookie rides the handshake), `useGuildQueue(guildId)` owns the connection lifecycle and exposes `{ snapshot, loading, error }`, and `GuildDetailPage` renders it.

**Tech Stack:** `socket.io`'s connection middleware (`io.use`), the `cookie` package (raw `Cookie` header parsing — not `cookie-parser`, which never sees socket.io's handshake), `socket.io-client` (now a frontend production dependency, not just a backend test dependency), vitest + `@testing-library/react`'s `renderHook`.

## Global Constraints

- Node.js ≥ 18.17. Backend stays CommonJS; frontend stays ESM/bundler (unchanged from Phase 5a).
- Zero comments in any source code file.
- Testing: vitest; TDD. No test makes a real Discord/network call — backend socket tests use a real ephemeral `http.Server` + real `socket.io-client` (same pattern as Phase 2), frontend tests mock `socketClient`/`useGuildQueue` via namespace import + `vi.spyOn`.
- No placeholder/TODO code.
- Every file that needs to be `vi.spyOn`-mocked by its own tests or a consumer's tests imports the mocked module as a namespace (`import * as x from '...'`), not named imports — established project-wide convention.
- The socket handshake authenticates via the `session` httpOnly cookie riding the request automatically (`withCredentials` + CORS `credentials: true`, already configured) — never via a client-supplied token, since the cookie is httpOnly and JS cannot read it to pass one explicitly.
- `guild:join` must reject (via the existing `error` event) any guildId not present in the authenticated user's `adminGuildIds` — this check happens in addition to, not instead of, the existing "is this a valid guildId at all" check from Phase 2.

---

### Task 1: Socket handshake auth — `createSocketServer.ts` + `index.ts` wiring

**Files:**
- Modify: `backend/package.json` (add `cookie` dependency, `@types/cookie` dev dependency)
- Modify: `backend/src/sockets/createSocketServer.ts`
- Modify: `backend/src/sockets/createSocketServer.test.ts`
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `verifySessionToken`, `SessionPayload` from `backend/src/auth/jwt.ts` (Phase 3a); `signSessionToken` (test only).
- Produces: `createSocketServer(httpServer: HttpServer, player: Player, jwtSecret: string, frontendUrl: string): Server` — signature extended with two new required parameters. This is the only task in this plan that touches backend files; no later task depends on it directly (the frontend tasks talk to the running backend over the network, not via imports).

- [ ] **Step 1: Add the `cookie` dependency**

Edit `backend/package.json`: add to `"dependencies"`:

```json
    "cookie": "^0.7.2",
```

and to `"devDependencies"`:

```json
    "@types/cookie": "^0.6.0",
```

Run: `pnpm install`
Expected: install completes, `cookie` appears in `backend/node_modules`.

- [ ] **Step 2: Write the failing tests**

Replace `backend/src/sockets/createSocketServer.test.ts` entirely with:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'http';
import type { Server as HttpServer } from 'http';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import type { Server } from 'socket.io';
import type { Player } from 'discord-player';
import { createDiscordClient } from '../bot/createDiscordClient';
import { createPlayer } from '../bot/createPlayer';
import { signSessionToken } from '../auth/jwt';
import { createSocketServer } from './createSocketServer';

const JWT_SECRET = 'test-secret';
const FRONTEND_URL = 'http://localhost:5173';

describe('createSocketServer', () => {
  let httpServer: HttpServer;
  let io: Server;
  let clientSocket: ClientSocket;

  afterEach(() => {
    clientSocket?.close();
    io?.close();
    httpServer?.close();
  });

  async function startServer(player: Player): Promise<number> {
    httpServer = createServer();
    io = createSocketServer(httpServer, player, JWT_SECRET, FRONTEND_URL);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  it('joins the guild room and replies with the initial idle snapshot', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const port = await startServer(player);
    const token = signSessionToken({ userId: 'user-1', adminGuildIds: ['guild-1'] }, JWT_SECRET);

    clientSocket = ioClient(`http://localhost:${port}`, {
      extraHeaders: { Cookie: `session=${token}` },
    });

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
    const port = await startServer(player);
    const token = signSessionToken({ userId: 'user-1', adminGuildIds: ['guild-1'] }, JWT_SECRET);

    clientSocket = ioClient(`http://localhost:${port}`, {
      extraHeaders: { Cookie: `session=${token}` },
    });

    const errorPayload = await new Promise((resolve) => {
      clientSocket.on('connect', () => {
        clientSocket.emit('guild:join', {});
      });
      clientSocket.on('error', resolve);
    });

    expect(errorPayload).toEqual({ message: 'guild:join requires a valid guildId' });
  });

  it('emits an error and does not join when the guild is not in the user\'s adminGuildIds', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const port = await startServer(player);
    const token = signSessionToken({ userId: 'user-1', adminGuildIds: ['guild-other'] }, JWT_SECRET);

    clientSocket = ioClient(`http://localhost:${port}`, {
      extraHeaders: { Cookie: `session=${token}` },
    });

    const errorPayload = await new Promise((resolve) => {
      clientSocket.on('connect', () => {
        clientSocket.emit('guild:join', { guildId: 'guild-1' });
      });
      clientSocket.on('error', resolve);
    });

    expect(errorPayload).toEqual({ message: 'you do not have access to this guild' });
  });

  it('rejects the connection when there is no session cookie', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const port = await startServer(player);

    clientSocket = ioClient(`http://localhost:${port}`);

    const connectError = await new Promise((resolve) => {
      clientSocket.on('connect_error', resolve);
    });

    expect(connectError).toBeInstanceOf(Error);
  });

  it('rejects the connection when the session cookie is invalid', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const port = await startServer(player);

    clientSocket = ioClient(`http://localhost:${port}`, {
      extraHeaders: { Cookie: 'session=garbage' },
    });

    const connectError = await new Promise((resolve) => {
      clientSocket.on('connect_error', resolve);
    });

    expect(connectError).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter backend test -- createSocketServer.test.ts`
Expected: FAIL — `createSocketServer` doesn't accept a 3rd/4th argument yet, no auth middleware exists, so every test either type-errors or behaves like the old unauthenticated version (the two "missing guildId"/"joins the room" tests would pass without auth even being implemented, but the three new auth-specific tests would fail: no `connect_error` is ever emitted, and the `adminGuildIds` check doesn't exist).

- [ ] **Step 4: Write the implementation**

`backend/src/sockets/createSocketServer.ts`:

```ts
import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { Player } from 'discord-player';
import { parse as parseCookie } from 'cookie';
import { verifySessionToken, SessionPayload } from '../auth/jwt';
import { buildQueueSnapshot } from './buildQueueSnapshot';

type GuildRoomPayload = {
  guildId?: string;
};

function isValidGuildId(payload: GuildRoomPayload | undefined): payload is { guildId: string } {
  return typeof payload?.guildId === 'string' && payload.guildId.length > 0;
}

export function createSocketServer(
  httpServer: HttpServer,
  player: Player,
  jwtSecret: string,
  frontendUrl: string,
): Server {
  const io = new Server(httpServer, {
    cors: { origin: frontendUrl, credentials: true },
  });

  io.use((socket, next) => {
    const cookieHeader = socket.request.headers.cookie;
    const cookies = cookieHeader ? parseCookie(cookieHeader) : {};
    const token = cookies.session;

    if (typeof token !== 'string') {
      next(new Error('unauthorized'));
      return;
    }

    try {
      const payload = verifySessionToken(token, jwtSecret);
      (socket.data as { user: SessionPayload }).user = payload;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('guild:join', (payload: GuildRoomPayload) => {
      if (!isValidGuildId(payload)) {
        socket.emit('error', { message: 'guild:join requires a valid guildId' });
        return;
      }

      const user = (socket.data as { user: SessionPayload }).user;
      if (!user.adminGuildIds.includes(payload.guildId)) {
        socket.emit('error', { message: 'you do not have access to this guild' });
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

- [ ] **Step 5: Update `index.ts`**

In `backend/src/index.ts`, change:

```ts
  const io = createSocketServer(httpServer, player);
```

to:

```ts
  const io = createSocketServer(httpServer, player, env.JWT_SECRET, env.FRONTEND_URL);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter backend test -- createSocketServer.test.ts`
Expected: PASS, 5 tests.

Run: `pnpm --filter backend test`
Expected: PASS, all 136 tests (133 carried over from Phases 1-5a + 3 net new in this file: 2 existing tests kept, 3 new added).

- [ ] **Step 7: Commit**

```bash
git add backend/package.json pnpm-lock.yaml backend/src/sockets/createSocketServer.ts backend/src/sockets/createSocketServer.test.ts backend/src/index.ts
git commit -m "feat: authenticate socket.io handshake via session cookie, gate guild:join by adminGuildIds"
```

Note: `pnpm install` updates the workspace-root `pnpm-lock.yaml` — run `git status` to confirm the exact changed path before staging.

---

### Task 2: Frontend `services/socketClient.ts`

**Files:**
- Modify: `frontend/package.json` (add `socket.io-client` dependency — this is now real app code, not just a backend test dependency)
- Create: `frontend/src/services/socketClient.ts`
- Test: `frontend/src/services/socketClient.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createSocketConnection(options?: Partial<ManagerOptions & SocketOptions>): Socket`. Task 3 (`useGuildQueue`) calls `createSocketConnection()` with no arguments in real usage; its own test calls it with `{ autoConnect: false }` to avoid a real (doomed) connection attempt during the test run.

- [ ] **Step 1: Add the `socket.io-client` dependency**

Edit `frontend/package.json`: add to `"dependencies"`:

```json
    "socket.io-client": "^4.8.1",
```

Run: `pnpm install`
Expected: install completes, `socket.io-client` appears in `frontend/node_modules`.

- [ ] **Step 2: Write the failing test**

`frontend/src/services/socketClient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createSocketConnection } from './socketClient';

describe('createSocketConnection', () => {
  it('creates a socket configured with withCredentials, without auto-connecting', () => {
    const socket = createSocketConnection({ autoConnect: false });

    expect(socket.io.opts.withCredentials).toBe(true);

    socket.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter frontend test -- socketClient.test.ts`
Expected: FAIL with "Cannot find module './socketClient'".

- [ ] **Step 4: Write the implementation**

`frontend/src/services/socketClient.ts`:

```ts
import { io, Socket } from 'socket.io-client';
import type { ManagerOptions, SocketOptions } from 'socket.io-client';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:3001';

export function createSocketConnection(options?: Partial<ManagerOptions & SocketOptions>): Socket {
  return io(BACKEND_URL, { withCredentials: true, ...options });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter frontend test -- socketClient.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json pnpm-lock.yaml frontend/src/services/socketClient.ts frontend/src/services/socketClient.test.ts
git commit -m "feat: add socketClient with credentialed socket.io connection"
```

---

### Task 3: `hooks/useGuildQueue.ts`

**Files:**
- Modify: `frontend/src/types/index.ts` (add `QueueSnapshotTrack`, `QueueSnapshot` types mirroring the backend's `buildQueueSnapshot.ts`)
- Create: `frontend/src/hooks/useGuildQueue.ts`
- Test: `frontend/src/hooks/useGuildQueue.test.ts`

**Interfaces:**
- Consumes: `createSocketConnection` (Task 2).
- Produces: `QueueSnapshotTrack`/`QueueSnapshot` types, `UseGuildQueueResult` type (`{ snapshot: QueueSnapshot | null; loading: boolean; error: string | null }`), `useGuildQueue(guildId: string): UseGuildQueueResult`. Task 4 (`GuildDetailPage`) imports and calls `useGuildQueue`.

- [ ] **Step 1: Add the shared types**

Add to `frontend/src/types/index.ts` (keep the existing `SessionUser`/`GuildInfo`, add these):

```ts
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
```

- [ ] **Step 2: Write the failing tests**

`frontend/src/hooks/useGuildQueue.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import * as socketClient from '../services/socketClient';
import { useGuildQueue } from './useGuildQueue';

function fakeSocket() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    _handlers: handlers,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useGuildQueue', () => {
  it('joins the guild on connect and updates the snapshot on queue:state', async () => {
    const socket = fakeSocket();
    vi.spyOn(socketClient, 'createSocketConnection').mockReturnValue(socket as never);

    const { result } = renderHook(() => useGuildQueue('guild-1'));

    expect(result.current.loading).toBe(true);

    act(() => {
      socket._handlers.connect();
    });
    expect(socket.emit).toHaveBeenCalledWith('guild:join', { guildId: 'guild-1' });

    const snapshot = { status: 'idle', currentTrack: null, queue: [], volume: 100, progressMs: 0 };
    act(() => {
      socket._handlers['queue:state'](snapshot);
    });

    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));
    expect(result.current.loading).toBe(false);
  });

  it('sets an error when the server emits an error event', async () => {
    const socket = fakeSocket();
    vi.spyOn(socketClient, 'createSocketConnection').mockReturnValue(socket as never);

    const { result } = renderHook(() => useGuildQueue('guild-1'));

    act(() => {
      socket._handlers.error({ message: 'you do not have access to this guild' });
    });

    await waitFor(() => expect(result.current.error).toBe('you do not have access to this guild'));
  });

  it('leaves the guild and disconnects on unmount', () => {
    const socket = fakeSocket();
    vi.spyOn(socketClient, 'createSocketConnection').mockReturnValue(socket as never);

    const { unmount } = renderHook(() => useGuildQueue('guild-1'));
    unmount();

    expect(socket.emit).toHaveBeenCalledWith('guild:leave', { guildId: 'guild-1' });
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });
});
```

Note: this test mocks `createSocketConnection` via `vi.spyOn(socketClient, 'createSocketConnection')`, requiring `useGuildQueue.ts` to import it as a namespace (`import * as socketClient from '../services/socketClient'`) — same reason as everywhere else in this project.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter frontend test -- useGuildQueue.test.ts`
Expected: FAIL with "Cannot find module './useGuildQueue'".

- [ ] **Step 4: Write the implementation**

`frontend/src/hooks/useGuildQueue.ts`:

```ts
import { useEffect, useState } from 'react';
import * as socketClient from '../services/socketClient';
import type { QueueSnapshot } from '../types';

export type UseGuildQueueResult = {
  snapshot: QueueSnapshot | null;
  loading: boolean;
  error: string | null;
};

export function useGuildQueue(guildId: string): UseGuildQueueResult {
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSnapshot(null);
    setLoading(true);
    setError(null);

    const socket = socketClient.createSocketConnection();

    socket.on('connect', () => {
      socket.emit('guild:join', { guildId });
    });

    socket.on('queue:state', (state: QueueSnapshot) => {
      setSnapshot(state);
      setLoading(false);
    });

    socket.on('error', (payload: { message: string }) => {
      setError(payload.message);
      setLoading(false);
    });

    socket.on('connect_error', () => {
      setError('Failed to connect to the server.');
      setLoading(false);
    });

    return () => {
      socket.emit('guild:leave', { guildId });
      socket.disconnect();
    };
  }, [guildId]);

  return { snapshot, loading, error };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter frontend test -- useGuildQueue.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/hooks/useGuildQueue.ts frontend/src/hooks/useGuildQueue.test.ts
git commit -m "feat: add useGuildQueue hook for live queue state"
```

---

### Task 4: `pages/GuildDetailPage.tsx` — replace placeholder with live view

**Files:**
- Modify: `frontend/src/pages/GuildDetailPage.tsx`
- Modify: `frontend/src/pages/GuildDetailPage.test.tsx`

**Interfaces:**
- Consumes: `useGuildQueue` (Task 3).
- Produces: `GuildDetailPage(): JSX.Element` — same export name as Phase 5a's placeholder, entirely new behavior. No later task in this plan consumes this file.

- [ ] **Step 1: Write the failing tests**

Replace `frontend/src/pages/GuildDetailPage.test.tsx` entirely with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import * as useGuildQueueModule from '../hooks/useGuildQueue';
import { GuildDetailPage } from './GuildDetailPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/guilds/guild-1']}>
      <Routes>
        <Route path="/guilds/:guildId" element={<GuildDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('GuildDetailPage', () => {
  it('shows a loading state', () => {
    vi.spyOn(useGuildQueueModule, 'useGuildQueue').mockReturnValue({ snapshot: null, loading: true, error: null });

    renderPage();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows an error message', () => {
    vi.spyOn(useGuildQueueModule, 'useGuildQueue').mockReturnValue({
      snapshot: null,
      loading: false,
      error: 'you do not have access to this guild',
    });

    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('you do not have access to this guild');
  });

  it('shows an idle message when nothing is playing', () => {
    vi.spyOn(useGuildQueueModule, 'useGuildQueue').mockReturnValue({
      snapshot: { status: 'idle', currentTrack: null, queue: [], volume: 100, progressMs: 0 },
      loading: false,
      error: null,
    });

    renderPage();

    expect(screen.getByText('Nothing is playing in this server.')).toBeInTheDocument();
  });

  it('shows the current track, status, volume, and queue', () => {
    vi.spyOn(useGuildQueueModule, 'useGuildQueue').mockReturnValue({
      snapshot: {
        status: 'playing',
        currentTrack: {
          id: 't1',
          title: 'Now Playing',
          author: 'Artist',
          url: 'u',
          thumbnail: 't',
          durationMs: 1000,
        },
        queue: [{ id: 't2', title: 'Up Next', author: 'A', url: 'u', thumbnail: 't', durationMs: 1000 }],
        volume: 80,
        progressMs: 0,
      },
      loading: false,
      error: null,
    });

    renderPage();

    expect(screen.getByText('Now Playing')).toBeInTheDocument();
    expect(screen.getByText('Artist')).toBeInTheDocument();
    expect(screen.getByText(/playing/)).toBeInTheDocument();
    expect(screen.getByText(/80/)).toBeInTheDocument();
    expect(screen.getByText(/Up Next/)).toBeInTheDocument();
  });
});
```

Note: this test mocks `useGuildQueue` via `vi.spyOn(useGuildQueueModule, 'useGuildQueue')`, requiring `GuildDetailPage.tsx` to import it as a namespace (`import * as useGuildQueueModule from '../hooks/useGuildQueue'`) and call `useGuildQueueModule.useGuildQueue(...)` — same reason as everywhere else in this project.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter frontend test -- GuildDetailPage.test.tsx`
Expected: FAIL — the old placeholder test/component no longer match (the file doesn't yet import `useGuildQueue`, so the mocked hook has no effect on the still-placeholder markup and none of the new assertions find their expected text).

- [ ] **Step 3: Write the implementation**

`frontend/src/pages/GuildDetailPage.tsx`:

```tsx
import { useParams } from 'react-router-dom';
import * as useGuildQueueModule from '../hooks/useGuildQueue';

export function GuildDetailPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const { snapshot, loading, error } = useGuildQueueModule.useGuildQueue(guildId ?? '');

  if (loading) {
    return <p>Loading...</p>;
  }

  if (error) {
    return <p role="alert">{error}</p>;
  }

  if (!snapshot || !snapshot.currentTrack) {
    return <p>Nothing is playing in this server.</p>;
  }

  return (
    <div>
      <h2>{snapshot.currentTrack.title}</h2>
      <p>{snapshot.currentTrack.author}</p>
      <p>Status: {snapshot.status}</p>
      <p>Volume: {snapshot.volume}</p>
      <ul>
        {snapshot.queue.map((track, index) => (
          <li key={track.id}>
            {index + 1}. {track.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend test -- GuildDetailPage.test.tsx`
Expected: PASS, 4 tests.

Run: `pnpm --filter frontend test`
Expected: PASS, all 24 tests (17 carried over from Phase 5a, minus the 1 old placeholder test this task replaces, plus 1 from Task 2, 3 from Task 3, and 4 new in this task — net: 17 + 1 + 3 + (4 − 1) = 24).

- [ ] **Step 5: Build verification**

Run: `pnpm --filter frontend build`
Expected: `tsc -b && vite build` completes cleanly. Clean up the generated `dist/`, `.tsbuildinfo`, and compiled `.js`/`.d.ts` siblings afterward (gitignored, but tidy your `git status` before committing).

- [ ] **Step 6: Manual verification**

No real Discord bot token, test guild, or browser exists in this development environment — actually seeing live playback state update in the dashboard is a pending manual step for the user:

1. Run the backend (`pnpm --filter backend dev`) and frontend (`pnpm --filter frontend dev`) in parallel with real credentials.
2. Log in via the dashboard, click into a guild you administer.
3. Start playback in that guild (via a slash command or the REST API directly, since Phase 5c's UI buttons don't exist yet) — expect `GuildDetailPage` to update live with the current track, status, and queue without a page refresh.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/GuildDetailPage.tsx frontend/src/pages/GuildDetailPage.test.tsx
git commit -m "feat: replace GuildDetailPage placeholder with live queue view"
```
