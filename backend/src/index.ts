import 'dotenv/config';
import { loadEnv } from './config/env';
import { createDiscordClient } from './bot/createDiscordClient';
import { createPlayer } from './bot/createPlayer';
import { createApp } from './http/createApp';
import { createHttpServer } from './http/createHttpServer';
import { createSocketServer } from './sockets/createSocketServer';
import { registerPlayerEventBridge } from './sockets/playerEventBridge';

async function main(): Promise<void> {
  const env = loadEnv();
  const client = createDiscordClient();
  const player = await createPlayer(client);

  client.once('ready', (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

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
  const io = createSocketServer(httpServer, player);
  registerPlayerEventBridge(player, io);

  httpServer.listen(env.PORT, () => {
    console.log(`HTTP server listening on port ${env.PORT}`);
  });

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
