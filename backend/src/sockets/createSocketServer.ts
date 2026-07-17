import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { Player } from 'discord-player';
import { buildQueueSnapshot } from './buildQueueSnapshot';

type GuildRoomPayload = {
  guildId?: string;
};

function isValidGuildId(payload: GuildRoomPayload | undefined): payload is { guildId: string } {
  return typeof payload?.guildId === 'string' && payload.guildId.length > 0;
}

export function createSocketServer(httpServer: HttpServer, player: Player): Server {
  const io = new Server(httpServer);

  io.on('connection', (socket) => {
    socket.on('guild:join', (payload: GuildRoomPayload) => {
      if (!isValidGuildId(payload)) {
        socket.emit('error', { message: 'guild:join requires a valid guildId' });
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
