import { describe, it, expect, vi } from 'vitest';
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
});
