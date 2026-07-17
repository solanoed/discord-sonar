import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as queueService from '../services/queueService';
import { stopCommand } from './stop';

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

describe('stopCommand', () => {
  it('has the expected command name', () => {
    expect(stopCommand.data.name).toBe('stop');
  });

  it('replies with a success message when the stop succeeds', async () => {
    vi.spyOn(queueService, 'stop').mockReturnValue(true);
    const interaction = fakeInteraction();

    await stopCommand.execute(interaction, deps);

    expect(queueService.stop).toHaveBeenCalledWith(deps.player, 'guild-1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Stopped'));
  });

  it('replies that nothing is playing when there is no active queue', async () => {
    vi.spyOn(queueService, 'stop').mockReturnValue(false);
    const interaction = fakeInteraction();

    await stopCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Nothing is playing'));
  });
});
