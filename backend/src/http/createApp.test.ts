import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './createApp';
import { AuthRoutesConfig } from './routes/authRoutes';
import { createDiscordClient } from '../bot/createDiscordClient';
import { createPlayer } from '../bot/createPlayer';

const testAuthConfig: AuthRoutesConfig = {
  oauth: { clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'http://localhost:3001/api/auth/callback' },
  jwtSecret: 'test-secret',
  frontendUrl: 'http://localhost:5173',
  isProduction: false,
  getBotGuildIds: () => [],
};

describe('createApp', () => {
  it('responds to GET /health with status ok', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const app = createApp(testAuthConfig, client, player);
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('sets CORS headers for the configured frontend origin', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const app = createApp(testAuthConfig, client, player);

    const response = await request(app).get('/health').set('Origin', testAuthConfig.frontendUrl);

    expect(response.headers['access-control-allow-origin']).toBe(testAuthConfig.frontendUrl);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
});
