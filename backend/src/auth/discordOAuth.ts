import type { DiscordUserGuild } from '../services/guildService';

export type DiscordOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type DiscordTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type DiscordUser = {
  id: string;
  username: string;
};

export function buildAuthorizeUrl(config: DiscordOAuthConfig, state: string): string {
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds');
  url.searchParams.set('state', state);
  return url.toString();
}

async function requestToken(body: URLSearchParams): Promise<DiscordTokenResponse> {
  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Discord token request failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

export function exchangeCodeForToken(config: DiscordOAuthConfig, code: string): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  });

  return requestToken(body);
}

export function refreshAccessToken(config: DiscordOAuthConfig, refreshToken: string): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  return requestToken(body);
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const response = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Discord user request failed with status ${response.status}`);
  }

  return (await response.json()) as DiscordUser;
}

export async function fetchUserGuilds(accessToken: string): Promise<DiscordUserGuild[]> {
  const response = await fetch('https://discord.com/api/users/@me/guilds', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Discord guilds request failed with status ${response.status}`);
  }

  return (await response.json()) as DiscordUserGuild[];
}
