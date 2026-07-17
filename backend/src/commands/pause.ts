import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as queueService from '../services/queueService';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder().setName('pause').setDescription('Pause playback');

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();
  const guildId = interaction.guildId;

  if (!guildId || !queueService.pause(deps.player, guildId)) {
    await interaction.editReply('Nothing is playing in this server.');
    return;
  }

  await interaction.editReply('Paused.');
}

export const pauseCommand: Command = { data, execute };
