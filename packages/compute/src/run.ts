import { openDatabase } from '@vaultbench/db';
import { loadDotEnv, logger, parseCliArgs, parseIsoDate } from '@vaultbench/shared';

import { recompute } from './recompute.js';

async function main(): Promise<void> {
  loadDotEnv();
  const args = parseCliArgs(process.argv.slice(2));
  const { db, close } = openDatabase();

  try {
    await recompute({
      db,
      ...(args.source === 'all' ? {} : { source: args.source }),
      ...(args.date === undefined ? {} : { asOf: parseIsoDate(args.date) }),
    });
  } catch (error) {
    logger.error('recompute failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    await close();
  }
}

void main();
