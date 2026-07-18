import { io, Socket } from 'socket.io-client';
import type { ManagerOptions, SocketOptions } from 'socket.io-client';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:3001';

export function createSocketConnection(options?: Partial<ManagerOptions & SocketOptions>): Socket {
  return io(BACKEND_URL, { withCredentials: true, ...options });
}
