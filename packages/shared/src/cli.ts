export interface CliArgs {
  source: string;
  date?: string;
}

export function parseCliArgs(argv: string[]): CliArgs {
  let source: string | undefined;
  let date: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg.startsWith('--source=')) {
      source = arg.slice('--source='.length);
      continue;
    }
    if (arg === '--source') {
      source = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--date=')) {
      date = arg.slice('--date='.length);
      continue;
    }
    if (arg === '--date') {
      date = argv[i + 1];
      i += 1;
    }
  }

  if (!source) {
    throw new Error('missing --source=<id|all>');
  }

  return { source, date };
}
