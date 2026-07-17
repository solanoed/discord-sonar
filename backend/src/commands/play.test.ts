import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as queueService from '../services/queueService';
import { playCommand } from './play';

function fakeInteraction(query: string, guildId: string | null = 'guild-1') {
  return {
    guildId,
    user: { id: 'user-1' },
    options: { getString: vi.fn(() => query) },
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction;
}

const deps = { client: {} as Client, player: {} as Player };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('playCommand', () => {
  it('has the expected command name', () => {
    expect(playCommand.data.name).toBe('play');
  });

  it('adds the track and confirms it in the reply', async () => {
    vi.spyOn(queueService, 'addTrack').mockResolvedValue(undefined);
    const interaction = fakeInteraction('never gonna give you up');

    await playCommand.execute(interaction, deps);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(queueService.addTrack).toHaveBeenCalledWith(deps.client, deps.player, 'guild-1', 'user-1', 'never gonna give you up');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('never gonna give you up'));
  });

  it('replies with a friendly message when the user is not in a voice channel', async () => {
    vi.spyOn(queueService, 'addTrack').mockRejectedValue(new queueService.NotInVoiceChannelError());
    const interaction = fakeInteraction('song');

    await playCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('voice channel'));
  });

  it('replies with a friendly message when no search results are found', async () => {
    vi.spyOn(queueService, 'addTrack').mockRejectedValue(new queueService.NoSearchResultsError('song'));
    const interaction = fakeInteraction('song');

    await playCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('No results'));
  });

  it('replies with a friendly message when the voice connection fails', async () => {
    vi.spyOn(queueService, 'addTrack').mockRejectedValue(new queueService.VoiceConnectionError());
    const interaction = fakeInteraction('song');

    await playCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('permission'));
  });

  it('replies with a generic error message for anything unexpected', async () => {
    vi.spyOn(queueService, 'addTrack').mockRejectedValue(new Error('boom'));
    const interaction = fakeInteraction('song');

    await playCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('wrong'));
  });

  it('replies without calling addTrack when used outside a server', async () => {
    vi.spyOn(queueService, 'addTrack');
    const interaction = fakeInteraction('song', null);

    await playCommand.execute(interaction, deps);

    expect(queueService.addTrack).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('server'));
  });
});
