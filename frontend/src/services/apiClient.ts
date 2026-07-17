import type { SessionUser, GuildInfo } from '../types';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:3001';

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
  }
}

export async function fetchMe(): Promise<SessionUser> {
  const response = await fetch(`${BACKEND_URL}/api/auth/me`, { credentials: 'include' });

  if (response.status === 401) {
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch session: ${response.status}`);
  }

  return (await response.json()) as SessionUser;
}

export async function logout(): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to log out: ${response.status}`);
  }
}

export async function fetchGuilds(): Promise<GuildInfo[]> {
  const response = await fetch(`${BACKEND_URL}/api/guilds`, { credentials: 'include' });

  if (!response.ok) {
    throw new Error(`Failed to fetch guilds: ${response.status}`);
  }

  return (await response.json()) as GuildInfo[];
}

export function getLoginUrl(): string {
  return `${BACKEND_URL}/api/auth/login`;
}
