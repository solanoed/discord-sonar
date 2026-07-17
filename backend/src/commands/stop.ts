import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as queueService from '../services/queueService';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue');

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();
  const guildId = interaction.guildId;

  if (!guildId || !queueService.stop(deps.player, guildId)) {
    await interaction.editReply('Nothing is playing in this server.');
    return;
  }

  await interaction.editReply('Stopped.');
}

export const stopCommand: Command = { data, execute };
