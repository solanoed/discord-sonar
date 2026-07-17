import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Client } from 'discord.js';
import type { Player, GuildQueue } from 'discord-player';
import { signSessionToken } from '../../auth/jwt';
import * as queueService from '../../services/queueService';
import { createQueueRoutes, QueueRoutesConfig } from './queueRoutes';

const SECRET = 'test-secret';

function buildTestApp(player: Player) {
  const config: QueueRoutesConfig = {
    jwtSecret: SECRET,
    client: {} as Client,
    player,
  };
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/guilds/:guildId/queue', createQueueRoutes(config));
  return app;
}

function tokenFor(guildIds: string[]): string {
  return signSessionToken({ userId: 'user-1', adminGuildIds: guildIds }, SECRET);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/guilds/:guildId/queue', () => {
  it('returns an idle snapshot when there is no active queue', async () => {
    const player = { nodes: { get: vi.fn(() => null) } } as unknown as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .get('/api/guilds/guild-1/queue')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`]);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'idle', currentTrack: null, queue: [], volume: 100, progressMs: 0 });
  });

  it('rejects when the guild is not in the caller\'s adminGuildIds', async () => {
    const player = { nodes: { get: vi.fn(() => null) } } as unknown as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .get('/api/guilds/guild-1/queue')
      .set('Cookie', [`session=${tokenFor(['guild-other'])}`]);

    expect(response.status).toBe(403);
  });
});

describe('POST /api/guilds/:guildId/queue', () => {
  it('adds the track and returns the resulting snapshot', async () => {
    vi.spyOn(queueService, 'addTrack').mockResolvedValue(undefined);
    const player = { nodes: { get: vi.fn(() => null) } } as unknown as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .post('/api/guilds/guild-1/queue')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`])
      .send({ query: 'never gonna give you up' });

    expect(response.status).toBe(200);
    expect(queueService.addTrack).toHaveBeenCalledWith(expect.anything(), player, 'guild-1', 'user-1', 'never gonna give you up');
  });

  it('rejects with 400 when the query is missing', async () => {
    const player = { nodes: { get: vi.fn(() => null) } } as unknown as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .post('/api/guilds/guild-1/queue')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`])
      .send({});

    expect(response.status).toBe(400);
  });

  it('maps NotInVoiceChannelError to 400', async () => {
    vi.spyOn(queueService, 'addTrack').mockRejectedValue(new queueService.NotInVoiceChannelError());
    const player = { nodes: { get: vi.fn(() => null) } } as unknown as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .post('/api/guilds/guild-1/queue')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`])
      .send({ query: 'song' });

    expect(response.status).toBe(400);
  });

  it('maps NoSearchResultsError to 404', async () => {
    vi.spyOn(queueService, 'addTrack').mockRejectedValue(new queueService.NoSearchResultsError('song'));
    const player = { nodes: { get: vi.fn(() => null) } } as unknown as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .post('/api/guilds/guild-1/queue')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`])
      .send({ query: 'song' });

    expect(response.status).toBe(404);
  });
});

describe('POST /api/guilds/:guildId/queue/skip', () => {
  it('returns 200 when the skip succeeds', async () => {
    vi.spyOn(queueService, 'skip').mockReturnValue(true);
    const player = {} as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .post('/api/guilds/guild-1/queue/skip')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`]);

    expect(response.status).toBe(200);
  });

  it('returns 404 when there is no active queue', async () => {
    vi.spyOn(queueService, 'skip').mockReturnValue(false);
    const player = {} as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .post('/api/guilds/guild-1/queue/skip')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`]);

    expect(response.status).toBe(404);
  });
});

describe('PUT /api/guilds/:guildId/queue/volume', () => {
  it('rejects with 400 when volume is not a number', async () => {
    const player = {} as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .put('/api/guilds/guild-1/queue/volume')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`])
      .send({ volume: 'loud' });

    expect(response.status).toBe(400);
  });

  it('rejects with 400 when queueService.setVolume throws InvalidVolumeError', async () => {
    vi.spyOn(queueService, 'setVolume').mockImplementation(() => {
      throw new queueService.InvalidVolumeError();
    });
    const player = {} as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .put('/api/guilds/guild-1/queue/volume')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`])
      .send({ volume: 500 });

    expect(response.status).toBe(400);
  });

  it('returns 200 when the volume is set successfully', async () => {
    vi.spyOn(queueService, 'setVolume').mockReturnValue(true);
    const player = {} as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .put('/api/guilds/guild-1/queue/volume')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`])
      .send({ volume: 50 });

    expect(response.status).toBe(200);
  });
});

describe('DELETE /api/guilds/:guildId/queue/track/:trackId', () => {
  it('returns 200 when the track is removed', async () => {
    vi.spyOn(queueService, 'remove').mockReturnValue(true);
    const player = {} as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .delete('/api/guilds/guild-1/queue/track/track-1')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`]);

    expect(response.status).toBe(200);
  });

  it('returns 404 when there is nothing to remove', async () => {
    vi.spyOn(queueService, 'remove').mockReturnValue(false);
    const player = {} as Player;
    const app = buildTestApp(player);

    const response = await request(app)
      .delete('/api/guilds/guild-1/queue/track/track-1')
      .set('Cookie', [`session=${tokenFor(['guild-1'])}`]);

    expect(response.status).toBe(404);
  });
});
