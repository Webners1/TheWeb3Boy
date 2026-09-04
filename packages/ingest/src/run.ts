import { openDatabase } from '@vaultbench/db';
import {
  createArchiveFromEnv,
  loadDotEnv,
  logger,
  parseCliArgs,
} from '@vaultbench/shared';

import { ingestSources } from './job.js';

async function main(): Promise<void> {
  loadDotEnv();
  const args = parseCliArgs(process.argv.slice(2));
  const { db, close } = openDatabase();
  const archive = createArchiveFromEnv();

  try {
    await ingestSources({
      db,
      archive,
      source: args.source,
      date: args.date,
    });
  } catch (error) {
    logger.error('ingest failed', { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  } finally {
    await close();
  }
}

void main();
