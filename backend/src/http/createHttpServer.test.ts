import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './createApp';
import { createHttpServer } from './createHttpServer';

describe('createHttpServer', () => {
  it('serves the express app over a real http.Server', async () => {
    const app = createApp();
    const server = createHttpServer(app);

    const response = await request(server).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
