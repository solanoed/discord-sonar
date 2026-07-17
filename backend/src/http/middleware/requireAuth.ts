import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifySessionToken, SessionPayload } from '../../auth/jwt';

export type AuthenticatedRequest = Request & { user?: SessionPayload };

export function createRequireAuth(secret: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.session;

    if (typeof token !== 'string') {
      res.status(401).json({ message: 'unauthorized' });
      return;
    }

    try {
      const decoded = verifySessionToken(token, secret);
      (req as AuthenticatedRequest).user = {
        userId: decoded.userId,
        adminGuildIds: decoded.adminGuildIds,
      };
      next();
    } catch {
      res.status(401).json({ message: 'unauthorized' });
    }
  };
}
