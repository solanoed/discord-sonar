import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as queueService from '../services/queueService';
import * as snapshotModule from '../sockets/buildQueueSnapshot';
import { removeCommand } from './remove';

function fakeInteraction(position: number, guildId: string | null = 'guild-1') {
  return {
    guildId,
    options: { getInteger: vi.fn(() => position) },
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction;
}

const deps = { client: {} as Client, player: {} as Player };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('removeCommand', () => {
  it('has the expected command name', () => {
    expect(removeCommand.data.name).toBe('remove');
  });

  it('removes the track at the given position and confirms it', async () => {
    vi.spyOn(snapshotModule, 'buildQueueSnapshot').mockReturnValue({
      status: 'playing',
      currentTrack: null,
      queue: [{ id: 'track-1', title: 'Song One', author: 'A', url: 'u', thumbnail: 't', durationMs: 1000 }],
      volume: 100,
      progressMs: 0,
    });
    vi.spyOn(queueService, 'remove').mockReturnValue(true);
    const interaction = fakeInteraction(1);

    await removeCommand.execute(interaction, deps);

    expect(queueService.remove).toHaveBeenCalledWith(deps.player, 'guild-1', 'track-1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Song One'));
  });

  it('replies with an invalid-position message when the position is out of range', async () => {
    vi.spyOn(snapshotModule, 'buildQueueSnapshot').mockReturnValue({
      status: 'playing',
      currentTrack: null,
      queue: [],
      volume: 100,
      progressMs: 0,
    });
    const interaction = fakeInteraction(1);

    await removeCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Invalid position'));
  });
});
