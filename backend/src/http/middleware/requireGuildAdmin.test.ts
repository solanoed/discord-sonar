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
