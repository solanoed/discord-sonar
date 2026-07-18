import { describe, it, expect, vi, afterEach } from 'vitest';
import { GuildQueueEvent, TrackSkipReason } from 'discord-player';
import type { GuildQueue, Track } from 'discord-player';
import type { Server } from 'socket.io';
import { createDiscordClient } from '../bot/createDiscordClient';
import { createPlayer } from '../bot/createPlayer';
import { registerPlayerEventBridge } from './playerEventBridge';

function fakeQueue(): GuildQueue {
  return {
    guild: { id: 'guild-1' },
    currentTrack: null,
    tracks: { toArray: () => [] },
    node: {
      isPaused: () => false,
      isPlaying: () => false,
      volume: 100,
      playbackTime: 0,
    },
  } as unknown as GuildQueue;
}

function fakeTrack(): Track {
  return { id: 't1', title: 'T', author: 'A', url: 'u', thumbnail: 'th', durationMS: 1000 } as Track;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('registerPlayerEventBridge', () => {
  it('broadcasts a snapshot to the guild room when PlayerStart fires', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const io = { to } as unknown as Server;

    registerPlayerEventBridge(player, io);
    player.events.emit(GuildQueueEvent.PlayerStart, fakeQueue(), fakeTrack());

    expect(to).toHaveBeenCalledWith('guild:guild-1');
    expect(emit).toHaveBeenCalledWith('queue:state', {
      status: 'idle',
      currentTrack: null,
      queue: [],
      volume: 100,
      progressMs: 0,
    });
  });

  it('broadcasts on every bridged event, not just PlayerStart', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const io = { to } as unknown as Server;

    registerPlayerEventBridge(player, io);
    player.events.emit(
      GuildQueueEvent.PlayerSkip,
      fakeQueue(),
      fakeTrack(),
      TrackSkipReason.Manual,
      'manual skip',
    );
    player.events.emit(GuildQueueEvent.Disconnect, fakeQueue());

    expect(to).toHaveBeenCalledTimes(2);
  });

  it('logs to console.error when PlayerError fires', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    registerPlayerEventBridge(player, io);
    const error = new Error('stream failed');
    player.events.emit(GuildQueueEvent.PlayerError, fakeQueue(), error, fakeTrack());

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('guild-1'),
      error,
    );
  });

  it('logs to console.log when Disconnect fires', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    registerPlayerEventBridge(player, io);
    player.events.emit(GuildQueueEvent.Disconnect, fakeQueue());

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('guild-1'));
  });

  it('logs to console.error when a generic queue Error fires', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    registerPlayerEventBridge(player, io);
    const error = new Error('connection failed');
    player.events.emit(GuildQueueEvent.Error, fakeQueue(), error);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('guild-1'), error);
  });

  it('logs to console.log when Debug fires', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    registerPlayerEventBridge(player, io);
    player.events.emit(GuildQueueEvent.Debug, fakeQueue(), 'trying to acquire voice connection');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('trying to acquire voice connection'));
  });

  it('logs to console.log when ConnectionDestroyed fires', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    registerPlayerEventBridge(player, io);
    player.events.emit(GuildQueueEvent.ConnectionDestroyed, fakeQueue());

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('guild-1'));
  });
});
