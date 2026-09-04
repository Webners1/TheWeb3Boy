import { serve } from '@hono/node-server';
import { openDatabase } from '@vaultbench/db';
import { logger } from '@vaultbench/shared';

import { createApp } from './app.js';

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
const { db, close } = openDatabase();
const app = createApp({
  db,
  ...(process.env.API_PUBLIC_URL === undefined ? {} : { serverUrl: process.env.API_PUBLIC_URL }),
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  logger.info('api listening', { port: info.port, spec: `/openapi.json` });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void close().then(() => process.exit(0));
    });
  });
}
