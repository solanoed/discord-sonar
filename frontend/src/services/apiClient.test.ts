import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchMe, logout, fetchGuilds, getLoginUrl, UnauthorizedError } from './apiClient';

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
