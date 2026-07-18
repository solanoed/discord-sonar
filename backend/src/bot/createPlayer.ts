import { Client } from 'discord.js';
import { Player } from 'discord-player';
import { AttachmentExtractor, SoundCloudExtractor } from '@discord-player/extractor';
import { YoutubeiExtractor } from 'discord-player-youtubei';

export type CreatePlayerOptions = {
  youtubeCookie?: string;
};

export async function createPlayer(client: Client, options: CreatePlayerOptions = {}): Promise<Player> {
  const player = new Player(client, { skipFFmpeg: false });
  await player.extractors.register(SoundCloudExtractor, {});
  await player.extractors.register(YoutubeiExtractor, {
    cookie: options.youtubeCookie,
  });
  await player.extractors.register(AttachmentExtractor, {});
  return player;
}
