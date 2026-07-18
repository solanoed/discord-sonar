import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import * as discordOAuth from '../../auth/discordOAuth';
import { DiscordOAuthConfig } from '../../auth/discordOAuth';
import { signSessionToken, verifySessionToken } from '../../auth/jwt';
import { saveTokens, getTokens } from '../../auth/tokenStore';
import { getMutualAdminGuilds } from '../../services/guildService';
import { createRequireAuth, AuthenticatedRequest } from '../middleware/requireAuth';

export type AuthRoutesConfig = {
  oauth: DiscordOAuthConfig;
  jwtSecret: string;
  frontendUrl: string;
  isProduction: boolean;
  getBotGuildIds: () => string[];
};

const SESSION_COOKIE_MAX_AGE_MS = 60 * 60 * 1000;
const OAUTH_STATE_COOKIE_MAX_AGE_MS = 5 * 60 * 1000;

export function createAuthRoutes(config: AuthRoutesConfig): Router {
  const router = Router();
  const requireAuth = createRequireAuth(config.jwtSecret);

  router.get('/login', (_req: Request, res: Response) => {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, {
      httpOnly: true,
      sameSite: config.isProduction ? 'none' : 'lax',
      secure: config.isProduction,
      maxAge: OAUTH_STATE_COOKIE_MAX_AGE_MS,
    });
    res.redirect(discordOAuth.buildAuthorizeUrl(config.oauth, state));
  });

  router.get('/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;
    const storedState = req.cookies?.oauth_state;
    res.clearCookie('oauth_state');

    if (typeof state !== 'string' || typeof storedState !== 'string' || state !== storedState) {
      res.status(400).json({ message: 'invalid oauth state' });
      return;
    }

    if (typeof code !== 'string') {
      res.status(400).json({ message: 'missing code' });
      return;
    }

    try {
      const tokenResponse = await discordOAuth.exchangeCodeForToken(config.oauth, code);
      const user = await discordOAuth.fetchDiscordUser(tokenResponse.accessToken);
      const userGuilds = await discordOAuth.fetchUserGuilds(tokenResponse.accessToken);
      const adminGuildIds = getMutualAdminGuilds(userGuilds, config.getBotGuildIds());

      saveTokens(user.id, {
        accessToken: tokenResponse.accessToken,
        refreshToken: tokenResponse.refreshToken,
        expiresAt: Date.now() + tokenResponse.expiresIn * 1000,
      });

      const sessionToken = signSessionToken({ userId: user.id, adminGuildIds }, config.jwtSecret);
      res.cookie('session', sessionToken, {
        httpOnly: true,
        sameSite: config.isProduction ? 'none' : 'lax',
        secure: config.isProduction,
        maxAge: SESSION_COOKIE_MAX_AGE_MS,
      });

      res.redirect(config.frontendUrl);
    } catch {
      res.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
    }
  });

  router.post('/refresh', async (req: Request, res: Response) => {
    const token = req.cookies?.session;

    if (typeof token !== 'string') {
      res.status(401).json({ message: 'unauthorized' });
      return;
    }

    let payload;
    try {
      payload = verifySessionToken(token, config.jwtSecret, { ignoreExpiration: true });
    } catch {
      res.status(401).json({ message: 'unauthorized' });
      return;
    }

    const stored = getTokens(payload.userId);
    if (!stored) {
      res.status(401).json({ message: 'session expired, please log in again' });
      return;
    }

    try {
      const tokenResponse = await discordOAuth.refreshAccessToken(config.oauth, stored.refreshToken);

      saveTokens(payload.userId, {
        accessToken: tokenResponse.accessToken,
        refreshToken: tokenResponse.refreshToken,
        expiresAt: Date.now() + tokenResponse.expiresIn * 1000,
      });

      const sessionToken = signSessionToken(
        { userId: payload.userId, adminGuildIds: payload.adminGuildIds },
        config.jwtSecret,
      );
      res.cookie('session', sessionToken, {
        httpOnly: true,
        sameSite: config.isProduction ? 'none' : 'lax',
        secure: config.isProduction,
        maxAge: SESSION_COOKIE_MAX_AGE_MS,
      });
      res.status(200).json({ message: 'refreshed' });
    } catch {
      res.status(502).json({ message: 'failed to refresh session' });
    }
  });

  router.post('/logout', (_req: Request, res: Response) => {
    res.clearCookie('session');
    res.status(200).json({ message: 'logged out' });
  });

  router.get('/me', requireAuth, (req: Request, res: Response) => {
    res.status(200).json((req as AuthenticatedRequest).user);
  });

  return router;
}
