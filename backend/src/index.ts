import 'dotenv/config';
import { loadEnv } from './config/env';
import { createDiscordClient } from './bot/createDiscordClient';
import { createPlayer } from './bot/createPlayer';
import { createApp } from './http/createApp';
import { createHttpServer } from './http/createHttpServer';
import { createSocketServer } from './sockets/createSocketServer';
import { registerPlayerEventBridge } from './sockets/playerEventBridge';
import { createCommands } from './commands';
import { registerInteractionHandler } from './events/interactionCreate';
import { startKeepAlive } from './keepAlive';

async function main(): Promise<void> {
  const env = loadEnv();
  const client = createDiscordClient();
  const player = await createPlayer(client);

  client.once('ready', (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  const commands = createCommands();
  registerInteractionHandler(client, commands, { client, player });

  const app = createApp(
    {
      oauth: {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        redirectUri: `${env.BACKEND_BASE_URL}/api/auth/callback`,
      },
      jwtSecret: env.JWT_SECRET,
      frontendUrl: env.FRONTEND_URL,
      isProduction: env.NODE_ENV === 'production',
      getBotGuildIds: () => client.guilds.cache.map((guild) => guild.id),
    },
    client,
    player,
  );
  const httpServer = createHttpServer(app);
  const io = createSocketServer(httpServer, player, env.JWT_SECRET, env.FRONTEND_URL);
  registerPlayerEventBridge(player, io);

  httpServer.listen(env.PORT, () => {
    console.log(`HTTP server listening on port ${env.PORT}`);
  });

  if (env.NODE_ENV === 'production') {
    startKeepAlive(env.BACKEND_BASE_URL);
  }

  await client.login(env.DISCORD_TOKEN);

  process.once('SIGINT', () => {
    client.destroy();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error during startup', error);
  process.exit(1);
});
