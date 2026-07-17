import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as queueService from '../services/queueService';
import { skipCommand } from './skip';

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

describe('skipCommand', () => {
  it('has the expected command name', () => {
    expect(skipCommand.data.name).toBe('skip');
  });

  it('replies with a success message when the skip succeeds', async () => {
    vi.spyOn(queueService, 'skip').mockReturnValue(true);
    const interaction = fakeInteraction();

    await skipCommand.execute(interaction, deps);

    expect(queueService.skip).toHaveBeenCalledWith(deps.player, 'guild-1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Skipped'));
  });

  it('replies that nothing is playing when there is no active queue', async () => {
    vi.spyOn(queueService, 'skip').mockReturnValue(false);
    const interaction = fakeInteraction();

    await skipCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Nothing is playing'));
  });
});
