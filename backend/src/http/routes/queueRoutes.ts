import { Router, Request, Response } from 'express';
import type { Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as queueService from '../../services/queueService';
import { buildQueueSnapshot } from '../../sockets/buildQueueSnapshot';
import { createRequireAuth, AuthenticatedRequest } from '../middleware/requireAuth';
import { createRequireGuildAdmin } from '../middleware/requireGuildAdmin';

export type QueueRoutesConfig = {
  jwtSecret: string;
  client: Client;
  player: Player;
};

export function createQueueRoutes(config: QueueRoutesConfig): Router {
  const router = Router({ mergeParams: true });
  const requireAuth = createRequireAuth(config.jwtSecret);
  const requireGuildAdmin = createRequireGuildAdmin();

  router.use(requireAuth, requireGuildAdmin);

  router.get('/', (req: Request, res: Response) => {
    const queue = config.player.nodes.get(req.params.guildId);
    res.status(200).json(buildQueueSnapshot(queue));
  });

  router.post('/', async (req: Request, res: Response) => {
    const { query } = req.body as { query?: string };
    const user = (req as AuthenticatedRequest).user!;

    if (typeof query !== 'string' || query.length === 0) {
      res.status(400).json({ message: 'query is required' });
      return;
    }

    try {
      await queueService.addTrack(config.client, config.player, req.params.guildId, user.userId, query);
      res.status(200).json(buildQueueSnapshot(config.player.nodes.get(req.params.guildId)));
    } catch (error) {
      if (error instanceof queueService.NotInVoiceChannelError) {
        res.status(400).json({ message: error.message });
      } else if (error instanceof queueService.NoSearchResultsError) {
        res.status(404).json({ message: error.message });
      } else if (error instanceof queueService.VoiceConnectionError) {
        res.status(403).json({ message: error.message });
      } else {
        console.error(`[queue] unexpected error adding track for guild ${req.params.guildId}:`, error);
        res.status(502).json({ message: 'failed to add track' });
      }
    }
  });

  router.post('/skip', (req: Request, res: Response) => {
    const ok = queueService.skip(config.player, req.params.guildId);
    if (!ok) {
      res.status(404).json({ message: 'no active queue for this guild' });
      return;
    }
    res.status(200).json({ message: 'skipped' });
  });

  router.post('/pause', (req: Request, res: Response) => {
    const ok = queueService.pause(config.player, req.params.guildId);
    if (!ok) {
      res.status(404).json({ message: 'no active queue for this guild' });
      return;
    }
    res.status(200).json({ message: 'paused' });
  });

  router.post('/resume', (req: Request, res: Response) => {
    const ok = queueService.resume(config.player, req.params.guildId);
    if (!ok) {
      res.status(404).json({ message: 'no active queue for this guild' });
      return;
    }
    res.status(200).json({ message: 'resumed' });
  });

  router.put('/volume', (req: Request, res: Response) => {
    const { volume } = req.body as { volume?: unknown };

    if (typeof volume !== 'number') {
      res.status(400).json({ message: 'volume must be a number' });
      return;
    }

    try {
      const ok = queueService.setVolume(config.player, req.params.guildId, volume);
      if (!ok) {
        res.status(404).json({ message: 'no active queue for this guild' });
        return;
      }
      res.status(200).json({ message: 'volume updated' });
    } catch (error) {
      if (error instanceof queueService.InvalidVolumeError) {
        res.status(400).json({ message: error.message });
        return;
      }
      throw error;
    }
  });

  router.delete('/track/:trackId', (req: Request, res: Response) => {
    const ok = queueService.remove(config.player, req.params.guildId, req.params.trackId);
    if (!ok) {
      res.status(404).json({ message: 'no active queue for this guild' });
      return;
    }
    res.status(200).json({ message: 'removed' });
  });

  router.post('/shuffle', (req: Request, res: Response) => {
    const ok = queueService.shuffle(config.player, req.params.guildId);
    if (!ok) {
      res.status(404).json({ message: 'no active queue for this guild' });
      return;
    }
    res.status(200).json({ message: 'shuffled' });
  });

  router.post('/stop', (req: Request, res: Response) => {
    const ok = queueService.stop(config.player, req.params.guildId);
    if (!ok) {
      res.status(404).json({ message: 'no active queue for this guild' });
      return;
    }
    res.status(200).json({ message: 'stopped' });
  });

  return router;
}
