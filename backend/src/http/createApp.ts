import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { createAuthRoutes, AuthRoutesConfig } from './routes/authRoutes';

export function createApp(authRoutesConfig: AuthRoutesConfig): Express {
  const app = express();
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', createAuthRoutes(authRoutesConfig));

  return app;
}
