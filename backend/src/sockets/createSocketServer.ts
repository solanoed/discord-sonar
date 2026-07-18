import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { Player } from 'discord-player';
import { parse as parseCookie } from 'cookie';
import { verifySessionToken, SessionPayload } from '../auth/jwt';
import { buildQueueSnapshot } from './buildQueueSnapshot';

type GuildRoomPayload = {
  guildId?: string;
};

function isValidGuildId(payload: GuildRoomPayload | undefined): payload is { guildId: string } {
  return typeof payload?.guildId === 'string' && payload.guildId.length > 0;
}

export function createSocketServer(
  httpServer: HttpServer,
  player: Player,
  jwtSecret: string,
  frontendUrl: string,
): Server {
  const io = new Server(httpServer, {
    cors: { origin: frontendUrl, credentials: true },
  });

  io.use((socket, next) => {
    const cookieHeader = socket.request.headers.cookie;
    const cookies = cookieHeader ? parseCookie(cookieHeader) : {};
    const token = cookies.session;

    if (typeof token !== 'string') {
      next(new Error('unauthorized'));
      return;
    }

    try {
      const payload = verifySessionToken(token, jwtSecret);
      (socket.data as { user: SessionPayload }).user = payload;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('guild:join', (payload: GuildRoomPayload) => {
      if (!isValidGuildId(payload)) {
        socket.emit('error', { message: 'guild:join requires a valid guildId' });
        return;
      }

      const user = (socket.data as { user: SessionPayload }).user;
      if (!user.adminGuildIds.includes(payload.guildId)) {
        socket.emit('error', { message: 'you do not have access to this guild' });
        return;
      }

      socket.join(`guild:${payload.guildId}`);
      const queue = player.nodes.get(payload.guildId);
      socket.emit('queue:state', buildQueueSnapshot(queue));
    });

    socket.on('guild:leave', (payload: GuildRoomPayload) => {
      if (isValidGuildId(payload)) {
        socket.leave(`guild:${payload.guildId}`);
      }
    });
  });

  return io;
}
