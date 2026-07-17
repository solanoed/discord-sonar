import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as queueService from '../services/queueService';
import { pauseCommand } from './pause';

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

describe('pauseCommand', () => {
  it('has the expected command name', () => {
    expect(pauseCommand.data.name).toBe('pause');
  });

  it('replies with a success message when the pause succeeds', async () => {
    vi.spyOn(queueService, 'pause').mockReturnValue(true);
    const interaction = fakeInteraction();

    await pauseCommand.execute(interaction, deps);

    expect(queueService.pause).toHaveBeenCalledWith(deps.player, 'guild-1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Paused'));
  });

  it('replies that nothing is playing when there is no active queue', async () => {
    vi.spyOn(queueService, 'pause').mockReturnValue(false);
    const interaction = fakeInteraction();

    await pauseCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Nothing is playing'));
  });
});
