import { Client } from 'discord.js';
import { Player } from 'discord-player';
import { AttachmentExtractor, SoundCloudExtractor } from '@discord-player/extractor';
import { YoutubeiExtractor } from 'discord-player-youtubei';
import ffmpegPath from 'ffmpeg-static';

export type CreatePlayerOptions = {
  youtubeCookie?: string;
};

export async function createPlayer(client: Client, options: CreatePlayerOptions = {}): Promise<Player> {
  const player = new Player(client, { skipFFmpeg: false, ffmpegPath: ffmpegPath ?? undefined });
  await player.extractors.register(SoundCloudExtractor, {});
  await player.extractors.register(YoutubeiExtractor, {
    cookie: options.youtubeCookie,
  });
  await player.extractors.register(AttachmentExtractor, {});
  return player;
}
