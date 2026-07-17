import type { Client } from 'discord.js';
import { Collection } from 'discord.js';
import { Command, CommandDeps } from '../commands/types';

export function registerInteractionHandler(
  client: Client,
  commands: Collection<string, Command>,
  deps: CommandDeps,
): void {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) return;

    await command.execute(interaction, deps);
  });
}
