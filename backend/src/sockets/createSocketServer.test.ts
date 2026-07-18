import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'http';
import type { Server as HttpServer } from 'http';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import type { Server } from 'socket.io';
import type { Player } from 'discord-player';
import { createDiscordClient } from '../bot/createDiscordClient';
import { createPlayer } from '../bot/createPlayer';
import { signSessionToken } from '../auth/jwt';
import { createSocketServer } from './createSocketServer';

const JWT_SECRET = 'test-secret';
const FRONTEND_URL = 'http://localhost:5173';

describe('createSocketServer', () => {
  let httpServer: HttpServer;
  let io: Server;
  let clientSocket: ClientSocket;

  afterEach(() => {
    clientSocket?.close();
    io?.close();
    httpServer?.close();
  });

  async function startServer(player: Player): Promise<number> {
    httpServer = createServer();
    io = createSocketServer(httpServer, player, JWT_SECRET, FRONTEND_URL);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  it('joins the guild room and replies with the initial idle snapshot', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const port = await startServer(player);
    const token = signSessionToken({ userId: 'user-1', adminGuildIds: ['guild-1'] }, JWT_SECRET);

    clientSocket = ioClient(`http://localhost:${port}`, {
      extraHeaders: { Cookie: `session=${token}` },
    });

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
    const port = await startServer(player);
    const token = signSessionToken({ userId: 'user-1', adminGuildIds: ['guild-1'] }, JWT_SECRET);

    clientSocket = ioClient(`http://localhost:${port}`, {
      extraHeaders: { Cookie: `session=${token}` },
    });

    const errorPayload = await new Promise((resolve) => {
      clientSocket.on('connect', () => {
        clientSocket.emit('guild:join', {});
      });
      clientSocket.on('error', resolve);
    });

    expect(errorPayload).toEqual({ message: 'guild:join requires a valid guildId' });
  });

  it('emits an error and does not join when the guild is not in the user\'s adminGuildIds', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const port = await startServer(player);
    const token = signSessionToken({ userId: 'user-1', adminGuildIds: ['guild-other'] }, JWT_SECRET);

    clientSocket = ioClient(`http://localhost:${port}`, {
      extraHeaders: { Cookie: `session=${token}` },
    });

    const errorPayload = await new Promise((resolve) => {
      clientSocket.on('connect', () => {
        clientSocket.emit('guild:join', { guildId: 'guild-1' });
      });
      clientSocket.on('error', resolve);
    });

    expect(errorPayload).toEqual({ message: 'you do not have access to this guild' });
  });

  it('rejects the connection when there is no session cookie', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const port = await startServer(player);

    clientSocket = ioClient(`http://localhost:${port}`);

    const connectError = await new Promise((resolve) => {
      clientSocket.on('connect_error', resolve);
    });

    expect(connectError).toBeInstanceOf(Error);
  });

  it('rejects the connection when the session cookie is invalid', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const port = await startServer(player);

    clientSocket = ioClient(`http://localhost:${port}`, {
      extraHeaders: { Cookie: 'session=garbage' },
    });

    const connectError = await new Promise((resolve) => {
      clientSocket.on('connect_error', resolve);
    });

    expect(connectError).toBeInstanceOf(Error);
  });
});
