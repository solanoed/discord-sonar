import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './createApp';
import { createHttpServer } from './createHttpServer';
import { AuthRoutesConfig } from './routes/authRoutes';

const testAuthConfig: AuthRoutesConfig = {
  oauth: { clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'http://localhost:3001/api/auth/callback' },
  jwtSecret: 'test-secret',
  frontendUrl: 'http://localhost:5173',
  isProduction: false,
  getBotGuildIds: () => [],
};

describe('createHttpServer', () => {
  it('serves the express app over a real http.Server', async () => {
    const app = createApp(testAuthConfig);
    const server = createHttpServer(app);

    const response = await request(server).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
