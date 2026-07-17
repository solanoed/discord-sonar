import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import type { Client } from 'discord.js';
import type { Player } from 'discord-player';
import { createAuthRoutes, AuthRoutesConfig } from './routes/authRoutes';
import { createGuildsRoutes } from './routes/guildsRoutes';
import { createQueueRoutes } from './routes/queueRoutes';

export function createApp(authRoutesConfig: AuthRoutesConfig, client: Client, player: Player): Express {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', createAuthRoutes(authRoutesConfig));

  app.use(
    '/api/guilds',
    createGuildsRoutes({
      jwtSecret: authRoutesConfig.jwtSecret,
      getGuildInfo: (guildIds) =>
        guildIds.map((id) => ({ id, name: client.guilds.cache.get(id)?.name ?? 'Unknown guild' })),
    }),
  );

  app.use(
    '/api/guilds/:guildId/queue',
    createQueueRoutes({ jwtSecret: authRoutesConfig.jwtSecret, client, player }),
  );

  return app;
}
