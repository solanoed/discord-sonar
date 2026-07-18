import { useEffect, useState } from 'react';
import * as socketClient from '../services/socketClient';
import type { QueueSnapshot } from '../types';

export type UseGuildQueueResult = {
  snapshot: QueueSnapshot | null;
  loading: boolean;
  error: string | null;
};

export function useGuildQueue(guildId: string): UseGuildQueueResult {
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSnapshot(null);
    setLoading(true);
    setError(null);

    const socket = socketClient.createSocketConnection();

    socket.on('connect', () => {
      setError(null);
      socket.emit('guild:join', { guildId });
    });

    socket.on('queue:state', (state: QueueSnapshot) => {
      setSnapshot(state);
      setLoading(false);
      setError(null);
    });

    socket.on('error', (payload: { message: string }) => {
      setError(payload.message);
      setLoading(false);
    });

    socket.on('connect_error', () => {
      setError('Failed to connect to the server.');
      setLoading(false);
    });

    return () => {
      socket.emit('guild:leave', { guildId });
      socket.disconnect();
    };
  }, [guildId]);

  return { snapshot, loading, error };
}
