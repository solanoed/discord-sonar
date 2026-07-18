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

function buildTestAppWithConfig(overrides: Partial<AuthRoutesConfig>) {
  const app = express();
  app.use(cookieParser());
  app.use('/api/auth', createAuthRoutes({ ...config, ...overrides }));
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
    expect(
      (response.headers['set-cookie'] as unknown as string[])?.some((cookie) => cookie.startsWith('session=')),
    ).toBe(true);
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
    expect(
      (response.headers['set-cookie'] as unknown as string[])?.some((cookie) => cookie.startsWith('session=')),
    ).toBe(true);
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
