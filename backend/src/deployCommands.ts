import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadEnv } from './config/env';
import { createCommands } from './commands';

async function main(): Promise<void> {
  const env = loadEnv();

  if (!env.TEST_GUILD_ID) {
    throw new Error('TEST_GUILD_ID must be set to deploy commands to a test guild');
  }

  const commands = createCommands();
  const body = commands.map((command) => command.data.toJSON());

  const rest = new REST().setToken(env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.TEST_GUILD_ID), { body });

  console.log(`Deployed ${body.length} commands to guild ${env.TEST_GUILD_ID}`);
}

main().catch((error) => {
  console.error('Failed to deploy commands', error);
  process.exit(1);
});
