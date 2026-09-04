import type { Db } from '@vaultbench/db';

import { createApp, openApiConfig } from './app.js';

/**
 * The OpenAPI document, with no database involved.
 *
 * Route registration is what produces the spec; the handlers never run. The
 * stub below therefore never receives a call, and typing it as `Db` keeps
 * `createApp` honest about needing one at request time.
 */
export function specOf(serverUrl?: string): Record<string, unknown> {
  const app = createApp({
    db: {} as Db,
    ...(serverUrl === undefined ? {} : { serverUrl }),
  });
  return app.getOpenAPI31Document(openApiConfig(serverUrl)) as unknown as Record<string, unknown>;
}
