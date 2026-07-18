import { describe, it, expect, vi, afterEach } from 'vitest';
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

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchMe', () => {
  it('returns the session user on success', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, { userId: 'user-1', adminGuildIds: ['guild-1'] }),
    );

    const result = await fetchMe();

    expect(result).toEqual({ userId: 'user-1', adminGuildIds: ['guild-1'] });
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/api/auth/me');
    expect(init?.credentials).toBe('include');
  });

  it('throws UnauthorizedError on a 401', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(401, {}));

    await expect(fetchMe()).rejects.toThrow(UnauthorizedError);
  });
});

describe('logout', () => {
  it('posts to the logout endpoint with credentials included', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, {}));

    await logout();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/auth/logout');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
  });
});

describe('fetchGuilds', () => {
  it('returns the guild list on success', async () => {
    const guilds = [{ id: 'guild-1', name: 'My Server' }];
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, guilds));

    const result = await fetchGuilds();

    expect(result).toEqual(guilds);
  });

  it('throws when the response is not ok', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(500, {}));

    await expect(fetchGuilds()).rejects.toThrow();
  });
});

describe('getLoginUrl', () => {
  it('returns a URL pointing at the backend login route', () => {
    expect(getLoginUrl()).toContain('/api/auth/login');
  });
});

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
