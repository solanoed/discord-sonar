import { Client } from 'discord.js';
import { Player } from 'discord-player';
import { DefaultExtractors } from '@discord-player/extractor';

export async function createPlayer(client: Client): Promise<Player> {
  const player = new Player(client);
  await player.extractors.loadMulti(DefaultExtractors);
  return player;
}
