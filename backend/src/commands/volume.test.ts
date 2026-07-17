import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as queueService from '../services/queueService';
import { volumeCommand } from './volume';

function fakeInteraction(amount: number, guildId: string | null = 'guild-1') {
  return {
    guildId,
    options: { getInteger: vi.fn(() => amount) },
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction;
}

const deps = { client: {} as Client, player: {} as Player };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('volumeCommand', () => {
  it('has the expected command name', () => {
    expect(volumeCommand.data.name).toBe('volume');
  });

  it('sets the volume and confirms it', async () => {
    vi.spyOn(queueService, 'setVolume').mockReturnValue(true);
    const interaction = fakeInteraction(50);

    await volumeCommand.execute(interaction, deps);

    expect(queueService.setVolume).toHaveBeenCalledWith(deps.player, 'guild-1', 50);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('50'));
  });

  it('replies that nothing is playing when there is no active queue', async () => {
    vi.spyOn(queueService, 'setVolume').mockReturnValue(false);
    const interaction = fakeInteraction(50);

    await volumeCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Nothing is playing'));
  });

  it('replies with a friendly message when the volume is out of range', async () => {
    vi.spyOn(queueService, 'setVolume').mockImplementation(() => {
      throw new queueService.InvalidVolumeError();
    });
    const interaction = fakeInteraction(500);

    await volumeCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('between 0 and 100'));
  });
});
