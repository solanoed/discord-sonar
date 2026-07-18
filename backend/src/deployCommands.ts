import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadEnv } from './config/env';
import { createCommands } from './commands';

async function main(): Promise<void> {
  const env = loadEnv();
  const commands = createCommands();
  const body = commands.map((command) => command.data.toJSON());
  const rest = new REST().setToken(env.DISCORD_TOKEN);

  if (env.TEST_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.TEST_GUILD_ID), { body });
    console.log(`Deployed ${body.length} commands to guild ${env.TEST_GUILD_ID}`);
  } else {
    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
    console.log(`Deployed ${body.length} commands globally (propagation can take up to 1 hour)`);
  }
}

main().catch((error) => {
  console.error('Failed to deploy commands', error);
  process.exit(1);
});
