import { describe, it, expect } from 'vitest';
import { createDiscordClient } from './createDiscordClient';
import { createPlayer } from './createPlayer';

describe('createPlayer', () => {
  it('registers the default extractors', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    expect(player.extractors.store.size).toBeGreaterThan(0);
  });
});
