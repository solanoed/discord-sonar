import { describe, it, expect } from 'vitest';
import { signSessionToken, verifySessionToken } from './jwt';

const SECRET = 'test-secret';

describe('signSessionToken / verifySessionToken', () => {
  it('round-trips a payload through sign and verify', () => {
    const payload = { userId: 'user-1', adminGuildIds: ['guild-1', 'guild-2'] };
    const token = signSessionToken(payload, SECRET);
    const decoded = verifySessionToken(token, SECRET);

    expect(decoded.userId).toBe('user-1');
    expect(decoded.adminGuildIds).toEqual(['guild-1', 'guild-2']);
  });

  it('throws when verifying with the wrong secret', () => {
    const token = signSessionToken({ userId: 'user-1', adminGuildIds: [] }, SECRET);

    expect(() => verifySessionToken(token, 'wrong-secret')).toThrow();
  });

  it('throws when the token is expired', () => {
    const expiredToken = signSessionToken({ userId: 'user-1', adminGuildIds: [] }, SECRET, -10);

    expect(() => verifySessionToken(expiredToken, SECRET)).toThrow();
  });

  it('accepts an expired token when ignoreExpiration is true', () => {
    const expiredToken = signSessionToken({ userId: 'user-1', adminGuildIds: [] }, SECRET, -10);

    const decoded = verifySessionToken(expiredToken, SECRET, { ignoreExpiration: true });

    expect(decoded.userId).toBe('user-1');
  });
});
