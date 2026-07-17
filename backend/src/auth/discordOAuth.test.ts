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
