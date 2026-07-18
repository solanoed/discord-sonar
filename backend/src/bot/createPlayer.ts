import { Client } from 'discord.js';
import { Player } from 'discord-player';
import { AttachmentExtractor, SoundCloudExtractor } from '@discord-player/extractor';

export async function createPlayer(client: Client): Promise<Player> {
  const player = new Player(client, { skipFFmpeg: false });
  await player.extractors.register(SoundCloudExtractor, {});
  await player.extractors.register(AttachmentExtractor, {});
  return player;
}
