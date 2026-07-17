import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './createApp';

describe('createApp', () => {
  it('responds to GET /health with status ok', async () => {
    const app = createApp();
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
