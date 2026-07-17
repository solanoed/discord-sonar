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

    try {
      await command.execute(interaction, deps);
    } catch (error) {
      console.error(`Unhandled error in /${interaction.commandName}`, error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('Something went wrong running that command.');
      }
    }
  });
}
