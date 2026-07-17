import type { Client } from 'discord.js';
import type { Player } from 'discord-player';

export class NotInVoiceChannelError extends Error {
  constructor() {
    super('you must be in a voice channel');
  }
}

export class NoSearchResultsError extends Error {
  constructor(query: string) {
    super(`no results found for "${query}"`);
  }
}

export class VoiceConnectionError extends Error {
  constructor() {
    super('missing voice permissions');
  }
}

export async function addTrack(
  client: Client,
  player: Player,
  guildId: string,
  userId: string,
  query: string,
): Promise<void> {
  const guild = await client.guilds.fetch(guildId);
  const member = await guild.members.fetch(userId);
  const channelId = member.voice.channelId;

  if (!channelId) {
    throw new NotInVoiceChannelError();
  }

  const channel = await guild.channels.fetch(channelId);
  if (!channel || !channel.isVoiceBased()) {
    throw new NotInVoiceChannelError();
  }

  const searchResult = await player.search(query, { requestedBy: userId });
  if (searchResult.isEmpty()) {
    throw new NoSearchResultsError(query);
  }

  const queue = player.nodes.create(guild);

  if (!queue.channel) {
    try {
      await queue.connect(channel);
    } catch {
      throw new VoiceConnectionError();
    }
  }

  if (searchResult.playlist) {
    queue.addTrack(searchResult.playlist);
  } else {
    queue.addTrack(searchResult.tracks[0]);
  }

  if (!queue.node.isPlaying()) {
    await queue.node.play();
  }
}

export class InvalidVolumeError extends Error {
  constructor() {
    super('volume must be between 0 and 100');
  }
}

export function skip(player: Player, guildId: string): boolean {
  const queue = player.nodes.get(guildId);
  if (!queue) return false;
  return queue.node.skip();
}

export function pause(player: Player, guildId: string): boolean {
  const queue = player.nodes.get(guildId);
  if (!queue) return false;
  return queue.node.pause();
}

export function resume(player: Player, guildId: string): boolean {
  const queue = player.nodes.get(guildId);
  if (!queue) return false;
  return queue.node.resume();
}

export function setVolume(player: Player, guildId: string, volume: number): boolean {
  if (volume < 0 || volume > 100) {
    throw new InvalidVolumeError();
  }

  const queue = player.nodes.get(guildId);
  if (!queue) return false;
  return queue.node.setVolume(volume);
}

export function remove(player: Player, guildId: string, trackId: string): boolean {
  const queue = player.nodes.get(guildId);
  if (!queue) return false;
  return queue.removeTrack(trackId) !== null;
}

export function shuffle(player: Player, guildId: string): boolean {
  const queue = player.nodes.get(guildId);
  if (!queue) return false;
  queue.tracks.shuffle();
  return true;
}

export function stop(player: Player, guildId: string): boolean {
  const queue = player.nodes.get(guildId);
  if (!queue) return false;
  queue.delete();
  return true;
}
