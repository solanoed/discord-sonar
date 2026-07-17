import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as snapshotModule from '../sockets/buildQueueSnapshot';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder().setName('queue').setDescription('Show the current queue');

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.editReply('This command only works in a server.');
    return;
  }

  const snapshot = snapshotModule.buildQueueSnapshot(deps.player.nodes.get(guildId));

  if (!snapshot.currentTrack) {
    await interaction.editReply('Nothing is playing in this server.');
    return;
  }

  const nowPlaying = `Now playing: **${snapshot.currentTrack.title}** (${snapshot.status}, volume ${snapshot.volume})`;
  const upcoming = snapshot.queue.map((track, index) => `${index + 1}. ${track.title}`).join('\n');
  const message = upcoming.length > 0 ? `${nowPlaying}\n\nUp next:\n${upcoming}` : nowPlaying;

  await interaction.editReply(message);
}

export const queueCommand: Command = { data, execute };
