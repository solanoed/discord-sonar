import { describe, it, expect } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('throws when DISCORD_TOKEN is missing', () => {
    expect(() => loadEnv({ DISCORD_CLIENT_ID: 'abc' })).toThrow();
  });

  it('throws when DISCORD_CLIENT_ID is missing', () => {
    expect(() => loadEnv({ DISCORD_TOKEN: 'token' })).toThrow();
  });

  it('applies defaults for PORT and NODE_ENV when absent', () => {
    const env = loadEnv({ DISCORD_TOKEN: 'token', DISCORD_CLIENT_ID: 'abc' });
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
  });

  it('coerces PORT from a string to a number', () => {
    const env = loadEnv({ DISCORD_TOKEN: 'token', DISCORD_CLIENT_ID: 'abc', PORT: '4000' });
    expect(env.PORT).toBe(4000);
  });
});
