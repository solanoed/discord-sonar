import { describe, it, expect } from 'vitest';
import { Client, GatewayIntentBits } from 'discord.js';
import { createDiscordClient } from './createDiscordClient';

describe('createDiscordClient', () => {
  it('returns a discord.js Client instance', () => {
    const client = createDiscordClient();
    expect(client).toBeInstanceOf(Client);
  });

  it('configures Guilds and GuildVoiceStates intents', () => {
    const client = createDiscordClient();
    expect(client.options.intents.has(GatewayIntentBits.Guilds)).toBe(true);
    expect(client.options.intents.has(GatewayIntentBits.GuildVoiceStates)).toBe(true);
  });
});
