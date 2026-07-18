# Playback Controls (Phase 5c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add playback control UI (play/skip/pause/resume/volume/remove/shuffle/stop) to `GuildDetailPage`, wired to the existing REST queue routes, with no manual refetch — the already-subscribed `useGuildQueue` socket hook updates the UI after each backend broadcast.

**Architecture:** Extend `frontend/src/services/apiClient.ts` with 8 thin REST wrapper functions matching `backend/src/http/routes/queueRoutes.ts`'s exact contract (already built, Phase 3b — no backend changes in this phase). Extend `GuildDetailPage.tsx` to render a play form (always visible) plus a controls block (visible only when `snapshot.currentTrack` exists), each control calling its `apiClient` function and surfacing failures in a local `actionError` state.

**Tech Stack:** React 18, TypeScript, vitest, @testing-library/react, @testing-library/user-event v14 (`userEvent.setup()` API — already a devDependency, first real usage in this codebase).

## Global Constraints

- All 8 new `apiClient` functions call `fetch` with `credentials: 'include'` (established pattern from Phase 5a).
- On a non-ok response, `apiClient` functions throw an `Error` whose message is the server's `message` field (fallback to a generic string if absent/unparseable) — no custom error subclasses needed for these 8 (unlike `UnauthorizedError`, which is specific to session auth).
- REST endpoints/methods/bodies must match `backend/src/http/routes/queueRoutes.ts` exactly:
  - `POST /api/guilds/:guildId/queue` body `{ query }`
  - `POST /api/guilds/:guildId/queue/skip`
  - `POST /api/guilds/:guildId/queue/pause`
  - `POST /api/guilds/:guildId/queue/resume`
  - `PUT /api/guilds/:guildId/queue/volume` body `{ volume }`
  - `DELETE /api/guilds/:guildId/queue/track/:trackId`
  - `POST /api/guilds/:guildId/queue/shuffle`
  - `POST /api/guilds/:guildId/queue/stop`
- No manual refetch/state-sync after a successful REST call anywhere in `GuildDetailPage` — the existing `useGuildQueue` socket subscription (Phase 5b) already re-renders on the backend's `queue:state` broadcast.
- Namespace-import convention: `GuildDetailPage.tsx` must `import * as apiClient from '../services/apiClient'` (not named imports), so its tests can `vi.spyOn(apiClient, 'skip')` etc.
- Volume client-side validation: reject (no fetch call) if not a finite number in `[0, 100]`. Backend still validates independently (defense in depth, not this phase's concern).
- `actionError` is cleared at the start of every new action, before the fetch call resolves/rejects.

---

### Task 1: Extend `apiClient.ts` with 8 queue control functions

**Files:**
- Modify: `frontend/src/services/apiClient.ts`
- Test: `frontend/src/services/apiClient.test.ts` (append `describe` blocks; reuse the existing `jsonResponse(status, body)` helper already defined at the top of the file — do not redefine it)

**Interfaces:**
- Consumes: nothing new (same `BACKEND_URL` constant already in the file).
- Produces (consumed by Task 2):
  - `addTrack(guildId: string, query: string): Promise<void>`
  - `skip(guildId: string): Promise<void>`
  - `pause(guildId: string): Promise<void>`
  - `resume(guildId: string): Promise<void>`
  - `setVolume(guildId: string, volume: number): Promise<void>`
  - `remove(guildId: string, trackId: string): Promise<void>`
  - `shuffle(guildId: string): Promise<void>`
  - `stop(guildId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/services/apiClient.test.ts` (the file already imports `describe, it, expect, vi, afterEach` and has `jsonResponse` defined — just add these `describe` blocks and extend the top import line):

```ts
// Change the top import line from:
//   import { fetchMe, logout, fetchGuilds, getLoginUrl, UnauthorizedError } from './apiClient';
// to:
import {
  fetchMe,
  logout,
  fetchGuilds,
  getLoginUrl,
  UnauthorizedError,
  addTrack,
  skip,
  pause,
  resume,
  setVolume,
  remove,
  shuffle,
  stop,
} from './apiClient';

describe('addTrack', () => {
  it('posts the query to the queue endpoint', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, {}));
    await addTrack('guild-1', 'never gonna give you up');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/guilds/guild-1/queue');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
    expect(JSON.parse(init?.body as string)).toEqual({ query: 'never gonna give you up' });
  });

  it('throws with the server message on a non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(400, { message: 'query is required' }));
    await expect(addTrack('guild-1', '')).rejects.toThrow('query is required');
  });
});

describe('skip', () => {
  it('posts to the skip endpoint', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, { message: 'skipped' }));
    await skip('guild-1');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/guilds/guild-1/queue/skip');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
  });

  it('throws with the server message on a non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(404, { message: 'no active queue for this guild' }));
    await expect(skip('guild-1')).rejects.toThrow('no active queue for this guild');
  });
});

describe('pause', () => {
  it('posts to the pause endpoint', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, { message: 'paused' }));
    await pause('guild-1');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/guilds/guild-1/queue/pause');
    expect(init?.method).toBe('POST');
  });
});

describe('resume', () => {
  it('posts to the resume endpoint', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, { message: 'resumed' }));
    await resume('guild-1');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/guilds/guild-1/queue/resume');
    expect(init?.method).toBe('POST');
  });
});

describe('setVolume', () => {
  it('puts the volume to the volume endpoint', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, { message: 'volume updated' }));
    await setVolume('guild-1', 50);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/guilds/guild-1/queue/volume');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ volume: 50 });
  });

  it('throws with the server message on a non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(400, { message: 'volume must be between 0 and 100' }));
    await expect(setVolume('guild-1', 500)).rejects.toThrow('volume must be between 0 and 100');
  });
});

describe('remove', () => {
  it('deletes the given track', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, { message: 'removed' }));
    await remove('guild-1', 'track-9');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/guilds/guild-1/queue/track/track-9');
    expect(init?.method).toBe('DELETE');
  });
});

describe('shuffle', () => {
  it('posts to the shuffle endpoint', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, { message: 'shuffled' }));
    await shuffle('guild-1');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/guilds/guild-1/queue/shuffle');
    expect(init?.method).toBe('POST');
  });
});

describe('stop', () => {
  it('posts to the stop endpoint', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, { message: 'stopped' }));
    await stop('guild-1');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/guilds/guild-1/queue/stop');
    expect(init?.method).toBe('POST');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter frontend test -- apiClient.test.ts`
Expected: FAIL — `addTrack`, `skip`, `pause`, `resume`, `setVolume`, `remove`, `shuffle`, `stop` are not exported from `./apiClient`.

- [ ] **Step 3: Implement the 8 functions**

Append to `frontend/src/services/apiClient.ts` (the file already has `BACKEND_URL` defined at the top — reuse it):

```ts
async function throwIfNotOk(response: Response, fallbackMessage: string): Promise<void> {
  if (response.ok) {
    return;
  }
  let message = fallbackMessage;
  try {
    const body = (await response.json()) as { message?: string };
    if (typeof body.message === 'string') {
      message = body.message;
    }
  } catch {
    // response had no JSON body; fall back to the generic message
  }
  throw new Error(message);
}

export async function addTrack(guildId: string, query: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  await throwIfNotOk(response, 'Failed to add track');
}

export async function skip(guildId: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue/skip`, {
    method: 'POST',
    credentials: 'include',
  });
  await throwIfNotOk(response, 'Failed to skip track');
}

export async function pause(guildId: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue/pause`, {
    method: 'POST',
    credentials: 'include',
  });
  await throwIfNotOk(response, 'Failed to pause');
}

export async function resume(guildId: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue/resume`, {
    method: 'POST',
    credentials: 'include',
  });
  await throwIfNotOk(response, 'Failed to resume');
}

export async function setVolume(guildId: string, volume: number): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue/volume`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume }),
  });
  await throwIfNotOk(response, 'Failed to set volume');
}

export async function remove(guildId: string, trackId: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue/track/${trackId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await throwIfNotOk(response, 'Failed to remove track');
}

export async function shuffle(guildId: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue/shuffle`, {
    method: 'POST',
    credentials: 'include',
  });
  await throwIfNotOk(response, 'Failed to shuffle queue');
}

export async function stop(guildId: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue/stop`, {
    method: 'POST',
    credentials: 'include',
  });
  await throwIfNotOk(response, 'Failed to stop playback');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend test -- apiClient.test.ts`
Expected: PASS, 17 tests total (6 pre-existing: `fetchMe` x2, `logout` x1, `fetchGuilds` x2, `getLoginUrl` x1 — plus 11 new: `addTrack` x2, `skip` x2, `pause` x1, `resume` x1, `setVolume` x2, `remove` x1, `shuffle` x1, `stop` x1). Verify actual count with `grep -c "it(" frontend/src/services/apiClient.test.ts` before trusting this number.)

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `pnpm --filter frontend test && pnpm --filter frontend exec tsc -b`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/apiClient.ts frontend/src/services/apiClient.test.ts
git commit -m "feat: add queue control functions to apiClient"
```

---

### Task 2: Add playback controls to `GuildDetailPage`

**Files:**
- Modify: `frontend/src/pages/GuildDetailPage.tsx`
- Test: `frontend/src/pages/GuildDetailPage.test.tsx` (append tests; the 4 existing tests must keep passing unmodified)

**Interfaces:**
- Consumes: the 8 `apiClient` functions from Task 1, imported as `import * as apiClient from '../services/apiClient'`; `QueueSnapshot`/`QueueSnapshotTrack` types from `frontend/src/types/index.ts` (already defined, unchanged).
- Produces: nothing consumed by later tasks — this is the last task in this phase.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/pages/GuildDetailPage.test.tsx`. Add `userEvent` and `apiClient` imports, and a `playingSnapshot`/`mockQueue` helper, then a new `describe` block:

```tsx
// Add to the top imports:
import userEvent from '@testing-library/user-event';
import type { QueueSnapshot } from '../types';
import * as apiClient from '../services/apiClient';

// Add alongside the existing renderPage() helper:
function playingSnapshot(overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    status: 'playing',
    currentTrack: { id: 't1', title: 'Now Playing', author: 'Artist', url: 'u', thumbnail: 't', durationMs: 1000 },
    queue: [{ id: 't2', title: 'Up Next', author: 'A', url: 'u', thumbnail: 't', durationMs: 1000 }],
    volume: 80,
    progressMs: 0,
    ...overrides,
  };
}

function mockQueue(snapshot: QueueSnapshot | null) {
  vi.spyOn(useGuildQueueModule, 'useGuildQueue').mockReturnValue({ snapshot, loading: false, error: null });
}

describe('GuildDetailPage playback controls', () => {
  it('submits the play form and calls addTrack with the guild id and query', async () => {
    mockQueue(null);
    vi.spyOn(apiClient, 'addTrack').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByPlaceholderText('Song name or URL'), 'never gonna give you up');
    await user.click(screen.getByRole('button', { name: 'Play' }));

    expect(apiClient.addTrack).toHaveBeenCalledWith('guild-1', 'never gonna give you up');
  });

  it('disables the play button when the input is empty', () => {
    mockQueue(null);
    renderPage();

    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });

  it('hides playback controls when nothing is playing', () => {
    mockQueue({ status: 'idle', currentTrack: null, queue: [], volume: 100, progressMs: 0 });
    renderPage();

    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
  });

  it('calls skip when the skip button is clicked', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'skip').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(apiClient.skip).toHaveBeenCalledWith('guild-1');
  });

  it('shows a Pause button and calls pause when the status is playing', async () => {
    mockQueue(playingSnapshot({ status: 'playing' }));
    vi.spyOn(apiClient, 'pause').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Pause' }));

    expect(apiClient.pause).toHaveBeenCalledWith('guild-1');
  });

  it('shows a Resume button and calls resume when the status is paused', async () => {
    mockQueue(playingSnapshot({ status: 'paused' }));
    vi.spyOn(apiClient, 'resume').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Resume' }));

    expect(apiClient.resume).toHaveBeenCalledWith('guild-1');
  });

  it('calls stop when the stop button is clicked', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'stop').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(apiClient.stop).toHaveBeenCalledWith('guild-1');
  });

  it('calls shuffle when the shuffle button is clicked', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'shuffle').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Shuffle' }));

    expect(apiClient.shuffle).toHaveBeenCalledWith('guild-1');
  });

  it('submits the volume form and calls setVolume with the parsed number', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'setVolume').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByPlaceholderText('0-100'), '50');
    await user.click(screen.getByRole('button', { name: 'Set volume' }));

    expect(apiClient.setVolume).toHaveBeenCalledWith('guild-1', 50);
  });

  it('does not call setVolume when the volume input is out of range', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'setVolume').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByPlaceholderText('0-100'), '500');
    await user.click(screen.getByRole('button', { name: 'Set volume' }));

    expect(apiClient.setVolume).not.toHaveBeenCalled();
  });

  it('calls remove with the guild id and track id when a remove button is clicked', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'remove').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(apiClient.remove).toHaveBeenCalledWith('guild-1', 't2');
  });

  it('shows an action error when a control call rejects', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'skip').mockRejectedValue(new Error('no active queue for this guild'));
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('no active queue for this guild');
  });

  it('clears a previous action error when a new action is triggered', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'skip').mockRejectedValueOnce(new Error('no active queue for this guild'));
    vi.spyOn(apiClient, 'shuffle').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no active queue for this guild');

    await user.click(screen.getByRole('button', { name: 'Shuffle' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
```

This adds 13 new tests to the file (4 pre-existing tests are untouched). Count them yourself with `grep -c "  it(" frontend/src/pages/GuildDetailPage.test.tsx` after writing — do not trust this number blindly.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter frontend test -- GuildDetailPage.test.tsx`
Expected: FAIL — no "Song name or URL" placeholder, no "Play"/"Skip"/"Pause"/"Resume"/"Stop"/"Shuffle"/"Set volume"/"Remove" buttons exist yet, `apiClient.addTrack` etc. are not being called.

- [ ] **Step 3: Implement the controls**

Replace the full contents of `frontend/src/pages/GuildDetailPage.tsx`:

```tsx
import { useParams } from 'react-router-dom';
import { FormEvent, useState } from 'react';
import * as useGuildQueueModule from '../hooks/useGuildQueue';
import * as apiClient from '../services/apiClient';

export function GuildDetailPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const { snapshot, loading, error } = useGuildQueueModule.useGuildQueue(guildId ?? '');
  const [query, setQuery] = useState('');
  const [volumeInput, setVolumeInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  async function runAction(action: () => Promise<void>): Promise<void> {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  function handlePlaySubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!guildId || query.trim().length === 0) {
      return;
    }
    const submittedQuery = query;
    setQuery('');
    void runAction(() => apiClient.addTrack(guildId, submittedQuery));
  }

  function handleVolumeSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const amount = Number(volumeInput);
    if (!guildId || !Number.isFinite(amount) || amount < 0 || amount > 100) {
      return;
    }
    void runAction(() => apiClient.setVolume(guildId, amount));
  }

  if (loading) {
    return <p>Loading...</p>;
  }

  if (error) {
    return <p role="alert">{error}</p>;
  }

  return (
    <div>
      {actionError ? <p role="alert">{actionError}</p> : null}

      <form onSubmit={handlePlaySubmit}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Song name or URL"
        />
        <button type="submit" disabled={query.trim().length === 0}>
          Play
        </button>
      </form>

      {!snapshot || !snapshot.currentTrack ? (
        <p>Nothing is playing in this server.</p>
      ) : (
        <div>
          <h2>{snapshot.currentTrack.title}</h2>
          <p>{snapshot.currentTrack.author}</p>
          <p>Status: {snapshot.status}</p>
          <p>Volume: {snapshot.volume}</p>

          <button onClick={() => guildId && void runAction(() => apiClient.skip(guildId))}>Skip</button>
          {snapshot.status === 'paused' ? (
            <button onClick={() => guildId && void runAction(() => apiClient.resume(guildId))}>Resume</button>
          ) : (
            <button onClick={() => guildId && void runAction(() => apiClient.pause(guildId))}>Pause</button>
          )}
          <button onClick={() => guildId && void runAction(() => apiClient.shuffle(guildId))}>Shuffle</button>
          <button onClick={() => guildId && void runAction(() => apiClient.stop(guildId))}>Stop</button>

          <form onSubmit={handleVolumeSubmit}>
            <input
              value={volumeInput}
              onChange={(event) => setVolumeInput(event.target.value)}
              placeholder="0-100"
            />
            <button type="submit">Set volume</button>
          </form>

          <ul>
            {snapshot.queue.map((track, index) => (
              <li key={track.id}>
                {index + 1}. {track.title}
                <button
                  onClick={() => guildId && void runAction(() => apiClient.remove(guildId, track.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

Notes for the implementer:
- The old early-return `if (!snapshot || !snapshot.currentTrack) return <p>Nothing is playing...</p>` is gone — the play form must render in every non-loading, non-error state, so this check moves inside the returned JSX instead of being a full alternate return.
- The pre-existing 4 tests (loading/error/idle/full-display) assert only presence of specific text — they must keep passing unmodified since none of that text was removed, only added to.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend test -- GuildDetailPage.test.tsx`
Expected: PASS. Recount `it(` blocks in the finished file (`grep -c "  it(" frontend/src/pages/GuildDetailPage.test.tsx`) and confirm it matches 4 (pre-existing) + 13 (new) = 17 before reporting done.

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `pnpm --filter frontend test && pnpm --filter frontend exec tsc -b`
Expected: all tests pass (verify the total against `apiClient.test.ts`'s count from Task 1 plus this file's 17 plus every other existing frontend test file — do not guess, sum what `pnpm --filter frontend test`'s own summary reports), no type errors.

- [ ] **Step 6: Build the frontend to confirm production build succeeds**

Run: `pnpm --filter frontend build`
Expected: build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/GuildDetailPage.tsx frontend/src/pages/GuildDetailPage.test.tsx
git commit -m "feat: add playback controls to GuildDetailPage"
```

Note in the implementer report: manual verification against a real backend + Discord bot (actually clicking Play/Skip/Pause/Volume/Remove/Shuffle/Stop in a browser against a live queue) is out of scope for this task and remains pending — the test suite verifies wiring, not end-to-end behavior against Discord/Lavalink.

---

## Post-plan notes (not part of any task — context for the final reviewer)

- No backend changes in this phase; `queueRoutes.ts` (Phase 3b) is consumed as-is.
- `progressMs` remains unrendered in the UI — explicitly out of scope per the approved Phase 5c spec ("solo controles").
- After this phase, the only unstarted roadmap item is Phase 6 (free-tier deploy).
