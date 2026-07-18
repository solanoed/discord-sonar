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

async function throwIfNotOk(response: Response, fallbackMessage: string): Promise<void> {
  if (response.ok) {
    return;
  }
  let message = fallbackMessage;
  try {
    const body = (await response.json()) as { message?: string };
    if (typeof body.message === 'string') {
      message = body.message;
    }
  } catch {
    // response had no JSON body; fall back to the generic message
  }
  throw new Error(message);
}

export type TrackSource = 'youtube' | 'soundcloud';

export async function addTrack(guildId: string, query: string, source?: TrackSource): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, source }),
  });
  await throwIfNotOk(response, 'Failed to add track');
}

export async function skip(guildId: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue/skip`, {
    method: 'POST',
    credentials: 'include',
  });
  await throwIfNotOk(response, 'Failed to skip track');
}

export async function pause(guildId: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue/pause`, {
    method: 'POST',
    credentials: 'include',
  });
  await throwIfNotOk(response, 'Failed to pause');
}

export async function resume(guildId: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue/resume`, {
    method: 'POST',
    credentials: 'include',
  });
  await throwIfNotOk(response, 'Failed to resume');
}

export async function setVolume(guildId: string, volume: number): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue/volume`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume }),
  });
  await throwIfNotOk(response, 'Failed to set volume');
}

export async function remove(guildId: string, trackId: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue/track/${trackId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await throwIfNotOk(response, 'Failed to remove track');
}

export async function shuffle(guildId: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue/shuffle`, {
    method: 'POST',
    credentials: 'include',
  });
  await throwIfNotOk(response, 'Failed to shuffle queue');
}

export async function stop(guildId: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/guilds/${guildId}/queue/stop`, {
    method: 'POST',
    credentials: 'include',
  });
  await throwIfNotOk(response, 'Failed to stop playback');
}
