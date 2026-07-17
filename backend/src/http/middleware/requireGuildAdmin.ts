import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthenticatedRequest } from './requireAuth';

export function createRequireGuildAdmin(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthenticatedRequest).user;
    const guildId = req.params.guildId;

    if (!user) {
      res.status(401).json({ message: 'unauthorized' });
      return;
    }

    if (!user.adminGuildIds.includes(guildId)) {
      res.status(403).json({ message: 'forbidden' });
      return;
    }

    next();
  };
}
