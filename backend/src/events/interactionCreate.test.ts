import { describe, it, expect, vi } from 'vitest';
import { Collection } from 'discord.js';
import type { Client, ChatInputCommandInteraction } from 'discord.js';
import type { Player } from 'discord-player';
import { Command } from '../commands/types';
import { registerInteractionHandler } from './interactionCreate';

function buildFakeClient() {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const client = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      handlers[event] = handler;
    }),
  } as unknown as Client;
  return { client, handlers };
}

const deps = { client: {} as Client, player: {} as Player };

describe('registerInteractionHandler', () => {
  it('executes the matching command for a known chat input command', async () => {
    const { client, handlers } = buildFakeClient();
    const execute = vi.fn(async () => undefined);
    const commands = new Collection<string, Command>();
    commands.set('skip', { data: { name: 'skip', toJSON: () => ({}) }, execute });

    registerInteractionHandler(client, commands, deps);

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'skip',
    } as unknown as ChatInputCommandInteraction;

    await handlers.interactionCreate(interaction);

    expect(execute).toHaveBeenCalledWith(interaction, deps);
  });

  it('does nothing for an unknown command name', async () => {
    const { client, handlers } = buildFakeClient();
    const execute = vi.fn(async () => undefined);
    const commands = new Collection<string, Command>();
    commands.set('skip', { data: { name: 'skip', toJSON: () => ({}) }, execute });

    registerInteractionHandler(client, commands, deps);

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'unknown-command',
    } as unknown as ChatInputCommandInteraction;

    await handlers.interactionCreate(interaction);

    expect(execute).not.toHaveBeenCalled();
  });

  it('does nothing for a non-chat-input interaction', async () => {
    const { client, handlers } = buildFakeClient();
    const execute = vi.fn(async () => undefined);
    const commands = new Collection<string, Command>();
    commands.set('skip', { data: { name: 'skip', toJSON: () => ({}) }, execute });

    registerInteractionHandler(client, commands, deps);

    const interaction = {
      isChatInputCommand: () => false,
    } as unknown as ChatInputCommandInteraction;

    await handlers.interactionCreate(interaction);

    expect(execute).not.toHaveBeenCalled();
  });
});
