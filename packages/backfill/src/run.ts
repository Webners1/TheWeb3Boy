import { loadDotEnv, logger, parseCliArgs } from '@vaultbench/shared';
import { runBackfill } from '@vaultbench/ingest';

async function main(): Promise<void> {
  loadDotEnv();
  const args = parseCliArgs(process.argv.slice(2));
  try {
    await runBackfill(args.source, args.date);
  } catch (error) {
    logger.error('backfill failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}

void main();
