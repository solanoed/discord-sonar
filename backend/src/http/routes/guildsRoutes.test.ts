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
