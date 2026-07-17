import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { signSessionToken } from '../../auth/jwt';
import { createRequireAuth, AuthenticatedRequest } from './requireAuth';

const SECRET = 'test-secret';

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/protected', createRequireAuth(SECRET), (req, res) => {
    res.status(200).json((req as AuthenticatedRequest).user);
  });
  return app;
}

describe('createRequireAuth', () => {
  it('allows the request through with a valid session cookie', async () => {
    const app = buildTestApp();
    const token = signSessionToken({ userId: 'user-1', adminGuildIds: ['guild-1'] }, SECRET);

    const response = await request(app).get('/protected').set('Cookie', [`session=${token}`]);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: 'user-1', adminGuildIds: ['guild-1'] });
  });

  it('rejects the request when there is no session cookie', async () => {
    const app = buildTestApp();

    const response = await request(app).get('/protected');

    expect(response.status).toBe(401);
  });

  it('rejects the request when the session cookie is invalid', async () => {
    const app = buildTestApp();

    const response = await request(app).get('/protected').set('Cookie', ['session=garbage']);

    expect(response.status).toBe(401);
  });
});
