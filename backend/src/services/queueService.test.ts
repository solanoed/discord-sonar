import { describe, it, expect, vi } from 'vitest';
import type { Client, Guild, GuildMember, VoiceBasedChannel } from 'discord.js';
import type { Player, GuildQueue, SearchResult, Track, Playlist } from 'discord-player';
import { addTrack, NotInVoiceChannelError, NoSearchResultsError, VoiceConnectionError, skip, pause, resume, setVolume, remove, shuffle, stop, InvalidVolumeError } from './queueService';

function fakeTrack(): Track {
  return {
    id: 'track-1',
    title: 'Song',
    author: 'Author',
    url: 'https://example.com/track-1',
    thumbnail: 'https://example.com/thumb.png',
    durationMS: 1000,
  } as Track;
}

type BuildFakesOptions = {
  channelId?: string | null;
  searchResultOverrides?: { isEmpty?: () => boolean; playlist?: Playlist | null };
  queueChannel?: unknown;
  isPlaying?: boolean;
  connectImpl?: () => Promise<unknown>;
};

function buildFakes(options: BuildFakesOptions) {
  const track = fakeTrack();
  const searchResult = {
    isEmpty: () => false,
    playlist: null,
    tracks: [track],
    ...options.searchResultOverrides,
  } as SearchResult;

  const channel = { id: 'channel-1', isVoiceBased: () => true } as unknown as VoiceBasedChannel;

  const channelId = options.channelId === undefined ? 'channel-1' : options.channelId;
  const member = { voice: { channelId } } as unknown as GuildMember;

  const guild = {
    id: 'guild-1',
    members: { fetch: vi.fn().mockResolvedValue(member) },
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
  } as unknown as Guild;

  const client = {
    guilds: { fetch: vi.fn().mockResolvedValue(guild) },
  } as unknown as Client;

  const queue = {
    channel: options.queueChannel ?? null,
    connect: vi.fn(options.connectImpl ?? (() => Promise.resolve())),
    addTrack: vi.fn(),
    node: {
      isPlaying: vi.fn(() => options.isPlaying ?? false),
      play: vi.fn(() => Promise.resolve()),
    },
  } as unknown as GuildQueue;

  const player = {
    search: vi.fn().mockResolvedValue(searchResult),
    nodes: { create: vi.fn(() => queue) },
  } as unknown as Player;

  return { client, player, queue };
}

describe('addTrack', () => {
  it('searches, connects, adds the track, and starts playback', async () => {
    const { client, player, queue } = buildFakes({});

    await addTrack(client, player, 'guild-1', 'user-1', 'song query');

    expect(queue.connect).toHaveBeenCalledTimes(1);
    expect(queue.addTrack).toHaveBeenCalledTimes(1);
    expect(queue.node.play).toHaveBeenCalledTimes(1);
  });

  it('throws NotInVoiceChannelError when the user has no voice channel', async () => {
    const { client, player } = buildFakes({ channelId: null });

    await expect(addTrack(client, player, 'guild-1', 'user-1', 'song query')).rejects.toThrow(
      NotInVoiceChannelError,
    );
  });

  it('throws NoSearchResultsError when the search returns nothing', async () => {
    const { client, player } = buildFakes({ searchResultOverrides: { isEmpty: () => true } });

    await expect(addTrack(client, player, 'guild-1', 'user-1', 'song query')).rejects.toThrow(
      NoSearchResultsError,
    );
  });

  it('throws VoiceConnectionError when connecting to the channel fails', async () => {
    const { client, player } = buildFakes({
      connectImpl: () => Promise.reject(new Error('no permission')),
    });

    await expect(addTrack(client, player, 'guild-1', 'user-1', 'song query')).rejects.toThrow(
      VoiceConnectionError,
    );
  });

  it('does not reconnect when the queue already has a channel', async () => {
    const { client, player, queue } = buildFakes({ queueChannel: { id: 'channel-1' } });

    await addTrack(client, player, 'guild-1', 'user-1', 'song query');

    expect(queue.connect).not.toHaveBeenCalled();
  });

  it('does not call play again when the queue is already playing', async () => {
    const { client, player, queue } = buildFakes({ isPlaying: true });

    await addTrack(client, player, 'guild-1', 'user-1', 'song query');

    expect(queue.node.play).not.toHaveBeenCalled();
  });

  it('adds the playlist instead of a single track when the search result is a playlist', async () => {
    const fakePlaylist = { id: 'playlist-1' } as unknown as Playlist;
    const { client, player, queue } = buildFakes({ searchResultOverrides: { playlist: fakePlaylist } });

    await addTrack(client, player, 'guild-1', 'user-1', 'song query');

    expect(queue.addTrack).toHaveBeenCalledWith(fakePlaylist);
  });
});

function fakeQueueForControls(overrides: Partial<{
  skip: () => boolean;
  pause: () => boolean;
  resume: () => boolean;
  setVolume: () => boolean;
  removeTrack: () => Track | null;
}> = {}): GuildQueue {
  return {
    node: {
      skip: vi.fn(overrides.skip ?? (() => true)),
      pause: vi.fn(overrides.pause ?? (() => true)),
      resume: vi.fn(overrides.resume ?? (() => true)),
      setVolume: vi.fn(overrides.setVolume ?? (() => true)),
    },
    removeTrack: vi.fn(overrides.removeTrack ?? (() => ({ id: 'track-1' }) as Track)),
    tracks: { shuffle: vi.fn() },
    delete: vi.fn(),
  } as unknown as GuildQueue;
}

function playerWithQueue(queue: GuildQueue | null): Player {
  return { nodes: { get: vi.fn(() => queue) } } as unknown as Player;
}

describe('skip', () => {
  it('returns false when there is no active queue', () => {
    expect(skip(playerWithQueue(null), 'guild-1')).toBe(false);
  });

  it('delegates to queue.node.skip() when a queue exists', () => {
    const queue = fakeQueueForControls();
    expect(skip(playerWithQueue(queue), 'guild-1')).toBe(true);
    expect(queue.node.skip).toHaveBeenCalledTimes(1);
  });
});

describe('pause', () => {
  it('returns false when there is no active queue', () => {
    expect(pause(playerWithQueue(null), 'guild-1')).toBe(false);
  });

  it('delegates to queue.node.pause() when a queue exists', () => {
    const queue = fakeQueueForControls();
    expect(pause(playerWithQueue(queue), 'guild-1')).toBe(true);
    expect(queue.node.pause).toHaveBeenCalledTimes(1);
  });
});

describe('resume', () => {
  it('returns false when there is no active queue', () => {
    expect(resume(playerWithQueue(null), 'guild-1')).toBe(false);
  });

  it('delegates to queue.node.resume() when a queue exists', () => {
    const queue = fakeQueueForControls();
    expect(resume(playerWithQueue(queue), 'guild-1')).toBe(true);
    expect(queue.node.resume).toHaveBeenCalledTimes(1);
  });
});

describe('setVolume', () => {
  it('throws InvalidVolumeError when volume is below 0', () => {
    expect(() => setVolume(playerWithQueue(null), 'guild-1', -1)).toThrow(InvalidVolumeError);
  });

  it('throws InvalidVolumeError when volume is above 100', () => {
    expect(() => setVolume(playerWithQueue(null), 'guild-1', 101)).toThrow(InvalidVolumeError);
  });

  it('returns false when there is no active queue', () => {
    expect(setVolume(playerWithQueue(null), 'guild-1', 50)).toBe(false);
  });

  it('delegates to queue.node.setVolume() when a queue exists', () => {
    const queue = fakeQueueForControls();
    expect(setVolume(playerWithQueue(queue), 'guild-1', 50)).toBe(true);
    expect(queue.node.setVolume).toHaveBeenCalledWith(50);
  });
});

describe('remove', () => {
  it('returns false when there is no active queue', () => {
    expect(remove(playerWithQueue(null), 'guild-1', 'track-1')).toBe(false);
  });

  it('returns true when the track is removed', () => {
    const queue = fakeQueueForControls();
    expect(remove(playerWithQueue(queue), 'guild-1', 'track-1')).toBe(true);
  });

  it('returns false when the track id does not match anything in the queue', () => {
    const queue = fakeQueueForControls({ removeTrack: () => null });
    expect(remove(playerWithQueue(queue), 'guild-1', 'missing-track')).toBe(false);
  });
});

describe('shuffle', () => {
  it('returns false when there is no active queue', () => {
    expect(shuffle(playerWithQueue(null), 'guild-1')).toBe(false);
  });

  it('shuffles the queue tracks when a queue exists', () => {
    const queue = fakeQueueForControls();
    expect(shuffle(playerWithQueue(queue), 'guild-1')).toBe(true);
    expect(queue.tracks.shuffle).toHaveBeenCalledTimes(1);
  });
});

describe('stop', () => {
  it('returns false when there is no active queue', () => {
    expect(stop(playerWithQueue(null), 'guild-1')).toBe(false);
  });

  it('deletes the queue when it exists', () => {
    const queue = fakeQueueForControls();
    expect(stop(playerWithQueue(queue), 'guild-1')).toBe(true);
    expect(queue.delete).toHaveBeenCalledTimes(1);
  });
});
