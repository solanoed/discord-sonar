export type DiscordTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

const store = new Map<string, DiscordTokens>();

export function saveTokens(userId: string, tokens: DiscordTokens): void {
  store.set(userId, tokens);
}

export function getTokens(userId: string): DiscordTokens | undefined {
  return store.get(userId);
}
