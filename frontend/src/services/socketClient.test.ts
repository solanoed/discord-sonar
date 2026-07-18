import { describe, it, expect } from 'vitest';
import { createSocketConnection } from './socketClient';

describe('createSocketConnection', () => {
  it('creates a socket configured with withCredentials, without auto-connecting', () => {
    const socket = createSocketConnection({ autoConnect: false });

    expect(socket.io.opts.withCredentials).toBe(true);

    socket.close();
  });
});
