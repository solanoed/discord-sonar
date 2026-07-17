import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as queueService from '../services/queueService';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Play a track in your current voice channel')
  .addStringOption((option) => option.setName('query').setDescription('Song name or URL').setRequired(true));

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();

  const guildId = interaction.guildId;
  const query = interaction.options.getString('query', true);

  if (!guildId) {
    await interaction.editReply('This command only works in a server.');
    return;
  }

  try {
    await queueService.addTrack(deps.client, deps.player, guildId, interaction.user.id, query);
    await interaction.editReply(`Added **${query}** to the queue.`);
  } catch (error) {
    if (error instanceof queueService.NotInVoiceChannelError) {
      await interaction.editReply('You need to be in a voice channel.');
    } else if (error instanceof queueService.NoSearchResultsError) {
      await interaction.editReply('No results found for that search.');
    } else if (error instanceof queueService.VoiceConnectionError) {
      await interaction.editReply("I don't have permission to join that channel.");
    } else {
      await interaction.editReply('Something went wrong while adding that track.');
    }
  }
}

export const playCommand: Command = { data, execute };
