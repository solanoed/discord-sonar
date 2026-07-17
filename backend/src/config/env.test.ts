import { describe, it, expect } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('throws when DISCORD_TOKEN is missing', () => {
    expect(() =>
      loadEnv({
        DISCORD_CLIENT_ID: 'abc',
        DISCORD_CLIENT_SECRET: 'clientsecret',
        JWT_SECRET: 'secret',
      }),
    ).toThrow();
  });

  it('throws when DISCORD_CLIENT_ID is missing', () => {
    expect(() =>
      loadEnv({
        DISCORD_TOKEN: 'token',
        DISCORD_CLIENT_SECRET: 'clientsecret',
        JWT_SECRET: 'secret',
      }),
    ).toThrow();
  });

  it('applies defaults for PORT and NODE_ENV when absent', () => {
    const env = loadEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'abc',
      DISCORD_CLIENT_SECRET: 'clientsecret',
      JWT_SECRET: 'secret',
    });
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
  });

  it('coerces PORT from a string to a number', () => {
    const env = loadEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'abc',
      DISCORD_CLIENT_SECRET: 'clientsecret',
      JWT_SECRET: 'secret',
      PORT: '4000',
    });
    expect(env.PORT).toBe(4000);
  });

  it('throws when DISCORD_CLIENT_SECRET is missing', () => {
    expect(() =>
      loadEnv({
        DISCORD_TOKEN: 'token',
        DISCORD_CLIENT_ID: 'abc',
        JWT_SECRET: 'secret',
      }),
    ).toThrow();
  });

  it('throws when JWT_SECRET is missing', () => {
    expect(() =>
      loadEnv({
        DISCORD_TOKEN: 'token',
        DISCORD_CLIENT_ID: 'abc',
        DISCORD_CLIENT_SECRET: 'clientsecret',
      }),
    ).toThrow();
  });

  it('applies defaults for FRONTEND_URL and BACKEND_BASE_URL when absent', () => {
    const env = loadEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'abc',
      DISCORD_CLIENT_SECRET: 'clientsecret',
      JWT_SECRET: 'secret',
    });
    expect(env.FRONTEND_URL).toBe('http://localhost:5173');
    expect(env.BACKEND_BASE_URL).toBe('http://localhost:3001');
  });

  it('accepts custom FRONTEND_URL and BACKEND_BASE_URL', () => {
    const env = loadEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'abc',
      DISCORD_CLIENT_SECRET: 'clientsecret',
      JWT_SECRET: 'secret',
      FRONTEND_URL: 'https://dashboard.example.com',
      BACKEND_BASE_URL: 'https://api.example.com',
    });
    expect(env.FRONTEND_URL).toBe('https://dashboard.example.com');
    expect(env.BACKEND_BASE_URL).toBe('https://api.example.com');
  });

  it('leaves TEST_GUILD_ID undefined when absent, and passes it through when present', () => {
    const withoutIt = loadEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'abc',
      DISCORD_CLIENT_SECRET: 'clientsecret',
      JWT_SECRET: 'secret',
    });
    expect(withoutIt.TEST_GUILD_ID).toBeUndefined();

    const withIt = loadEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'abc',
      DISCORD_CLIENT_SECRET: 'clientsecret',
      JWT_SECRET: 'secret',
      TEST_GUILD_ID: 'guild-123',
    });
    expect(withIt.TEST_GUILD_ID).toBe('guild-123');
  });
});
