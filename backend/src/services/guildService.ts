export type DiscordUserGuild = {
  id: string;
  name: string;
  owner: boolean;
  permissions: string;
};

const MANAGE_GUILD_BIT = 0x20n;

export function hasManageGuildPermission(permissions: string): boolean {
  const bitfield = BigInt(permissions);
  return (bitfield & MANAGE_GUILD_BIT) === MANAGE_GUILD_BIT;
}

export function getMutualAdminGuilds(userGuilds: DiscordUserGuild[], botGuildIds: string[]): string[] {
  const botGuildIdSet = new Set(botGuildIds);

  return userGuilds
    .filter((guild) => botGuildIdSet.has(guild.id))
    .filter((guild) => guild.owner || hasManageGuildPermission(guild.permissions))
    .map((guild) => guild.id);
}
