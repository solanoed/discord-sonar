import { describe, it, expect } from 'vitest';
import { saveTokens, getTokens } from './tokenStore';

describe('tokenStore', () => {
  it('returns undefined for a userId that was never saved', () => {
    expect(getTokens('never-saved-user')).toBeUndefined();
  });

  it('round-trips tokens through saveTokens and getTokens', () => {
    const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 1000 };

    saveTokens('user-tokenstore-1', tokens);

    expect(getTokens('user-tokenstore-1')).toEqual(tokens);
  });

  it('overwrites tokens on a second save for the same userId', () => {
    saveTokens('user-tokenstore-2', { accessToken: 'old', refreshToken: 'old-r', expiresAt: 1 });
    saveTokens('user-tokenstore-2', { accessToken: 'new', refreshToken: 'new-r', expiresAt: 2 });

    expect(getTokens('user-tokenstore-2')).toEqual({ accessToken: 'new', refreshToken: 'new-r', expiresAt: 2 });
  });
});
