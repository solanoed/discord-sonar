import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as queueService from '../services/queueService';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder()
  .setName('volume')
  .setDescription('Set the playback volume (0-100)')
  .addIntegerOption((option) => option.setName('amount').setDescription('Volume percentage').setRequired(true));

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();
  const guildId = interaction.guildId;
  const amount = interaction.options.getInteger('amount', true);

  if (!guildId) {
    await interaction.editReply('This command only works in a server.');
    return;
  }

  try {
    if (!queueService.setVolume(deps.player, guildId, amount)) {
      await interaction.editReply('Nothing is playing in this server.');
      return;
    }
    await interaction.editReply(`Volume set to ${amount}.`);
  } catch (error) {
    if (error instanceof queueService.InvalidVolumeError) {
      await interaction.editReply('Volume must be between 0 and 100.');
      return;
    }
    throw error;
  }
}

export const volumeCommand: Command = { data, execute };
