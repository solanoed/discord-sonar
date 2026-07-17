import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'http';
import type { Server as HttpServer } from 'http';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import type { Server } from 'socket.io';
import { createDiscordClient } from '../bot/createDiscordClient';
import { createPlayer } from '../bot/createPlayer';
import { createSocketServer } from './createSocketServer';

describe('createSocketServer', () => {
  let httpServer: HttpServer;
  let io: Server;
  let clientSocket: ClientSocket;

  afterEach(() => {
    clientSocket?.close();
    io?.close();
    httpServer?.close();
  });

  it('joins the guild room and replies with the initial idle snapshot', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    httpServer = createServer();
    io = createSocketServer(httpServer, player);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    clientSocket = ioClient(`http://localhost:${port}`);

    const snapshot = await new Promise((resolve) => {
      clientSocket.on('connect', () => {
        clientSocket.emit('guild:join', { guildId: 'guild-1' });
      });
      clientSocket.on('queue:state', resolve);
    });

    expect(snapshot).toEqual({
      status: 'idle',
      currentTrack: null,
      queue: [],
      volume: 100,
      progressMs: 0,
    });
  });

  it('emits an error and does not join when guildId is missing', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    httpServer = createServer();
    io = createSocketServer(httpServer, player);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    clientSocket = ioClient(`http://localhost:${port}`);

    const errorPayload = await new Promise((resolve) => {
      clientSocket.on('connect', () => {
        clientSocket.emit('guild:join', {});
      });
      clientSocket.on('error', resolve);
    });

    expect(errorPayload).toEqual({ message: 'guild:join requires a valid guildId' });
  });
});
