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
