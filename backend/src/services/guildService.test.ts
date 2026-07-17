import { describe, it, expect } from 'vitest';
import { hasManageGuildPermission, getMutualAdminGuilds, DiscordUserGuild } from './guildService';

function fakeGuild(overrides: Partial<DiscordUserGuild> = {}): DiscordUserGuild {
  return {
    id: 'guild-1',
    name: 'Test Guild',
    owner: false,
    permissions: '0',
    ...overrides,
  };
}

describe('hasManageGuildPermission', () => {
  it('returns true when the MANAGE_GUILD bit (0x20) is set', () => {
    expect(hasManageGuildPermission('32')).toBe(true);
    expect(hasManageGuildPermission('40')).toBe(true);
  });

  it('returns false when the MANAGE_GUILD bit is not set', () => {
    expect(hasManageGuildPermission('0')).toBe(false);
    expect(hasManageGuildPermission('16')).toBe(false);
  });
});

describe('getMutualAdminGuilds', () => {
  it('excludes guilds the bot is not in', () => {
    const userGuilds = [fakeGuild({ id: 'guild-not-with-bot', owner: true })];
    expect(getMutualAdminGuilds(userGuilds, ['guild-other'])).toEqual([]);
  });

  it('excludes guilds where the user is neither owner nor has MANAGE_GUILD', () => {
    const userGuilds = [fakeGuild({ id: 'guild-1', owner: false, permissions: '0' })];
    expect(getMutualAdminGuilds(userGuilds, ['guild-1'])).toEqual([]);
  });

  it('includes guilds where the user is the owner', () => {
    const userGuilds = [fakeGuild({ id: 'guild-1', owner: true, permissions: '0' })];
    expect(getMutualAdminGuilds(userGuilds, ['guild-1'])).toEqual(['guild-1']);
  });

  it('includes guilds where the user has the MANAGE_GUILD permission bit', () => {
    const userGuilds = [fakeGuild({ id: 'guild-1', owner: false, permissions: '32' })];
    expect(getMutualAdminGuilds(userGuilds, ['guild-1'])).toEqual(['guild-1']);
  });
});
