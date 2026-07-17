import { describe, it, expect, vi } from 'vitest';
import type { Client, Guild, GuildMember, VoiceBasedChannel } from 'discord.js';
import type { Player, GuildQueue, SearchResult, Track, Playlist } from 'discord-player';
import { addTrack, NotInVoiceChannelError, NoSearchResultsError, VoiceConnectionError } from './queueService';

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
