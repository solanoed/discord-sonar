import { describe, it, expect } from 'vitest';
import type { GuildQueue, Track } from 'discord-player';
import { buildQueueSnapshot } from './buildQueueSnapshot';

function fakeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Test Song',
    author: 'Test Author',
    url: 'https://example.com/track-1',
    thumbnail: 'https://example.com/thumb.png',
    durationMS: 123000,
    ...overrides,
  } as Track;
}

describe('buildQueueSnapshot', () => {
  it('returns an idle default snapshot when queue is null', () => {
    expect(buildQueueSnapshot(null)).toEqual({
      status: 'idle',
      currentTrack: null,
      queue: [],
      volume: 100,
      progressMs: 0,
    });
  });

  it('maps a playing queue to a playing snapshot', () => {
    const current = fakeTrack({ id: 'current', title: 'Now Playing' });
    const queued = fakeTrack({ id: 'queued', title: 'Up Next' });

    const queue = {
      guild: { id: 'guild-1' },
      currentTrack: current,
      tracks: { toArray: () => [queued] },
      node: {
        isPaused: () => false,
        isPlaying: () => true,
        volume: 80,
        playbackTime: 45000,
      },
    } as unknown as GuildQueue;

    expect(buildQueueSnapshot(queue)).toEqual({
      status: 'playing',
      currentTrack: {
        id: 'current',
        title: 'Now Playing',
        author: 'Test Author',
        url: 'https://example.com/track-1',
        thumbnail: 'https://example.com/thumb.png',
        durationMs: 123000,
      },
      queue: [
        {
          id: 'queued',
          title: 'Up Next',
          author: 'Test Author',
          url: 'https://example.com/track-1',
          thumbnail: 'https://example.com/thumb.png',
          durationMs: 123000,
        },
      ],
      volume: 80,
      progressMs: 45000,
    });
  });

  it('maps a paused queue to a paused snapshot', () => {
    const queue = {
      guild: { id: 'guild-1' },
      currentTrack: fakeTrack(),
      tracks: { toArray: () => [] },
      node: {
        isPaused: () => true,
        isPlaying: () => false,
        volume: 100,
        playbackTime: 1000,
      },
    } as unknown as GuildQueue;

    expect(buildQueueSnapshot(queue).status).toBe('paused');
  });
});
