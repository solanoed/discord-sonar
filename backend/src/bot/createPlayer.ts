import { Client } from 'discord.js';
import { Player } from 'discord-player';
import { YoutubeiExtractor } from 'discord-player-youtubei';

export async function createPlayer(client: Client): Promise<Player> {
  const player = new Player(client);
  await player.extractors.register(YoutubeiExtractor, {});
  return player;
}
