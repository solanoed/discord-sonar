import { createServer, Server as HttpServer } from 'http';
import { Express } from 'express';

export function createHttpServer(app: Express): HttpServer {
  return createServer(app);
}
