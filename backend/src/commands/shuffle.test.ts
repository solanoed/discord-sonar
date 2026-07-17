import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as queueService from '../services/queueService';
import { shuffleCommand } from './shuffle';

function fakeInteraction(guildId: string | null = 'guild-1') {
  return {
    guildId,
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction;
}

const deps = { client: {} as Client, player: {} as Player };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shuffleCommand', () => {
  it('has the expected command name', () => {
    expect(shuffleCommand.data.name).toBe('shuffle');
  });

  it('replies with a success message when the shuffle succeeds', async () => {
    vi.spyOn(queueService, 'shuffle').mockReturnValue(true);
    const interaction = fakeInteraction();

    await shuffleCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Shuffled'));
  });

  it('replies that nothing is playing when there is no active queue', async () => {
    vi.spyOn(queueService, 'shuffle').mockReturnValue(false);
    const interaction = fakeInteraction();

    await shuffleCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Nothing is playing'));
  });
});
