import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as queueService from '../services/queueService';
import * as snapshotModule from '../sockets/buildQueueSnapshot';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder()
  .setName('remove')
  .setDescription('Remove a track from the queue by position')
  .addIntegerOption((option) =>
    option.setName('position').setDescription('Position in the queue (1 = next up)').setRequired(true),
  );

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();
  const guildId = interaction.guildId;
  const position = interaction.options.getInteger('position', true);

  if (!guildId) {
    await interaction.editReply('This command only works in a server.');
    return;
  }

  const snapshot = snapshotModule.buildQueueSnapshot(deps.player.nodes.get(guildId));
  const track = snapshot.queue[position - 1];

  if (!track) {
    await interaction.editReply('Invalid position.');
    return;
  }

  queueService.remove(deps.player, guildId, track.id);
  await interaction.editReply(`Removed **${track.title}** from the queue.`);
}

export const removeCommand: Command = { data, execute };
