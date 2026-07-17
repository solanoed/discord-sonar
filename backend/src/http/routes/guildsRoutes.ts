import { Router, Request, Response } from 'express';
import { createRequireAuth, AuthenticatedRequest } from '../middleware/requireAuth';

export type GuildInfo = {
  id: string;
  name: string;
};

export type GuildsRoutesConfig = {
  jwtSecret: string;
  getGuildInfo: (guildIds: string[]) => GuildInfo[];
};

export function createGuildsRoutes(config: GuildsRoutesConfig): Router {
  const router = Router();
  const requireAuth = createRequireAuth(config.jwtSecret);

  router.get('/', requireAuth, (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user!;
    res.status(200).json(config.getGuildInfo(user.adminGuildIds));
  });

  return router;
}
