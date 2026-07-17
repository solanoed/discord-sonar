import jwt from 'jsonwebtoken';

export type SessionPayload = {
  userId: string;
  adminGuildIds: string[];
};

export function signSessionToken(
  payload: SessionPayload,
  secret: string,
  expiresInSeconds: number = 60 * 60,
): string {
  return jwt.sign(payload, secret, { expiresIn: expiresInSeconds });
}

export function verifySessionToken(
  token: string,
  secret: string,
  options?: { ignoreExpiration?: boolean },
): SessionPayload {
  return jwt.verify(token, secret, {
    ignoreExpiration: options?.ignoreExpiration ?? false,
  }) as SessionPayload;
}
