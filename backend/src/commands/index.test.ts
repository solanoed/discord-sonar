import { describe, it, expect } from 'vitest';
import { createCommands } from './index';

describe('createCommands', () => {
  it('registers all 9 commands keyed by their command name', () => {
    const commands = createCommands();

    expect(commands.size).toBe(9);
    expect([...commands.keys()].sort()).toEqual(
      ['pause', 'play', 'queue', 'remove', 'resume', 'shuffle', 'skip', 'stop', 'volume'].sort(),
    );
  });
});
