import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as snapshotModule from '../sockets/buildQueueSnapshot';
import { queueCommand } from './queue';

function fakeInteraction(guildId: string | null = 'guild-1') {
  return {
    guildId,
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction;
}

const deps = { client: {} as Client, player: { nodes: { get: vi.fn(() => null) } } as unknown as Player };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('queueCommand', () => {
  it('has the expected command name', () => {
    expect(queueCommand.data.name).toBe('queue');
  });

  it('replies that nothing is playing when the queue is idle', async () => {
    vi.spyOn(snapshotModule, 'buildQueueSnapshot').mockReturnValue({
      status: 'idle',
      currentTrack: null,
      queue: [],
      volume: 100,
      progressMs: 0,
    });
    const interaction = fakeInteraction();

    await queueCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Nothing is playing'));
  });

  it('shows the current track and upcoming queue', async () => {
    vi.spyOn(snapshotModule, 'buildQueueSnapshot').mockReturnValue({
      status: 'playing',
      currentTrack: { id: 't1', title: 'Now Playing', author: 'A', url: 'u', thumbnail: 't', durationMs: 1000 },
      queue: [{ id: 't2', title: 'Up Next', author: 'A', url: 'u', thumbnail: 't', durationMs: 1000 }],
      volume: 80,
      progressMs: 0,
    });
    const interaction = fakeInteraction();

    await queueCommand.execute(interaction, deps);

    const [message] = (interaction.editReply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(message).toContain('Now Playing');
    expect(message).toContain('Up Next');
  });
});
