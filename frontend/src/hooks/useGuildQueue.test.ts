import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import * as socketClient from '../services/socketClient';
import { useGuildQueue } from './useGuildQueue';

function fakeSocket() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    _handlers: handlers,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useGuildQueue', () => {
  it('joins the guild on connect and updates the snapshot on queue:state', async () => {
    const socket = fakeSocket();
    vi.spyOn(socketClient, 'createSocketConnection').mockReturnValue(socket as never);

    const { result } = renderHook(() => useGuildQueue('guild-1'));

    expect(result.current.loading).toBe(true);

    act(() => {
      socket._handlers.connect();
    });
    expect(socket.emit).toHaveBeenCalledWith('guild:join', { guildId: 'guild-1' });

    const snapshot = { status: 'idle', currentTrack: null, queue: [], volume: 100, progressMs: 0 };
    act(() => {
      socket._handlers['queue:state'](snapshot);
    });

    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));
    expect(result.current.loading).toBe(false);
  });

  it('sets an error when the server emits an error event', async () => {
    const socket = fakeSocket();
    vi.spyOn(socketClient, 'createSocketConnection').mockReturnValue(socket as never);

    const { result } = renderHook(() => useGuildQueue('guild-1'));

    act(() => {
      socket._handlers.error({ message: 'you do not have access to this guild' });
    });

    await waitFor(() => expect(result.current.error).toBe('you do not have access to this guild'));
  });

  it('clears a stale error once the connection recovers and fresh state arrives', async () => {
    const socket = fakeSocket();
    vi.spyOn(socketClient, 'createSocketConnection').mockReturnValue(socket as never);

    const { result } = renderHook(() => useGuildQueue('guild-1'));

    act(() => {
      socket._handlers.connect_error();
    });
    await waitFor(() => expect(result.current.error).toBe('Failed to connect to the server.'));

    act(() => {
      socket._handlers.connect();
    });
    expect(result.current.error).toBeNull();

    const snapshot = { status: 'idle', currentTrack: null, queue: [], volume: 100, progressMs: 0 };
    act(() => {
      socket._handlers['queue:state'](snapshot);
    });

    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));
    expect(result.current.error).toBeNull();
  });

  it('leaves the guild and disconnects on unmount', () => {
    const socket = fakeSocket();
    vi.spyOn(socketClient, 'createSocketConnection').mockReturnValue(socket as never);

    const { unmount } = renderHook(() => useGuildQueue('guild-1'));
    unmount();

    expect(socket.emit).toHaveBeenCalledWith('guild:leave', { guildId: 'guild-1' });
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });
});
