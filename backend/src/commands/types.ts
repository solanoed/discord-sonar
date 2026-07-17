import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';

export type CommandDeps = {
  client: Client;
  player: Player;
};

export type Command = {
  data: { name: string; toJSON(): unknown };
  execute: (interaction: ChatInputCommandInteraction, deps: CommandDeps) => Promise<void>;
};
