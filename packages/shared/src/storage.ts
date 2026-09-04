import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Append-only raw-payload archive. There is intentionally no update or
 * delete operation: raw data is append-only (AGENTS.md).
 *
 * `put` is idempotent for the same key: if the object already exists it is
 * left untouched and `'exists'` is returned. Re-running a day must not
 * overwrite yesterday's gzipped payload.
 */
export interface RawArchive {
  put(key: string, payload: Buffer | string): Promise<'written' | 'exists'>;
}

/** Local-filesystem archive for development, tests, and GitHub Actions. */
export class LocalFileArchive implements RawArchive {
  constructor(private readonly rootDir: string) {}

  async put(key: string, payload: Buffer | string): Promise<'written' | 'exists'> {
    assertSafeArchiveKey(key);
    const root = path.resolve(this.rootDir);
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep)) {
      throw new Error(`archive key escapes root: ${key}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, payload, { flag: 'wx' });
      return 'written';
    } catch (error) {
      if (isAlreadyExists(error)) return 'exists';
      throw error;
    }
  }
}

/** S3-compatible archive (Cloudflare R2 or Supabase Storage). */
export class S3Archive implements RawArchive {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        region: process.env.S3_REGION ?? 'auto',
        endpoint: process.env.S3_ENDPOINT,
        credentials: credentialsFromEnv(),
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      });
  }

  async put(key: string, payload: Buffer | string): Promise<'written' | 'exists'> {
    const body = typeof payload === 'string' ? Buffer.from(payload) : payload;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: 'application/gzip',
          IfNoneMatch: '*',
        }),
      );
      return 'written';
    } catch (error) {
      if (isPreconditionFailed(error)) return 'exists';
      throw error;
    }
  }
}

export function createArchiveFromEnv(): RawArchive {
  const bucket = process.env.S3_BUCKET;
  if (bucket) {
    return new S3Archive(bucket);
  }
  return new LocalFileArchive(resolveArchiveRoot(process.env.ARCHIVE_ROOT));
}

/**
 * Where a relative `ARCHIVE_ROOT` actually points.
 *
 * Resolved against the workspace root, *not* `process.cwd()`. pnpm runs each
 * package's script with that package as the working directory, so the
 * documented `ARCHIVE_ROOT=./var/archive` silently became
 * `packages/ingest/var/archive` for the daily job and
 * `packages/backfill/var/archive` for the historical loader. Two archives,
 * neither at the documented path, splitting the same entity's raw payloads
 * across directories that a `pnpm clean` would not think twice about.
 *
 * Raw payloads are the append-only ground truth — the thing every derived
 * figure can be re-checked against. They get one home.
 */
export function resolveArchiveRoot(configured: string | undefined): string {
  const root = configured ?? './var/archive';
  if (path.isAbsolute(root)) return root;
  return path.resolve(workspaceRoot(), root);
}

/**
 * Nearest ancestor holding `pnpm-workspace.yaml`. Falls back to the working
 * directory, which is only reached when running outside the repository.
 */
/**
 * Characters that cannot appear in a portable archive key.
 *
 * `:` is legal on Linux and an NTFS Alternate Data Stream separator on
 * Windows. A key of `vaultTimeSeries/ethereum:0xabc.json.gz` writes a
 * 0-byte file named `ethereum` and hides the payload in a named stream.
 * `Get-ChildItem`, `git`, `rsync` and a copy to another machine all see an
 * empty file. Found after a "successful" Enzyme backfill of 1.1M rows:
 * every history payload was an ADS on one file. Chamber's
 * `tokenPriceHistory/base:0x…` had the same shape.
 *
 * The other characters are Windows-illegal in a path segment. Rejecting
 * them here means a Linux CI cannot write a key a Windows developer cannot
 * read.
 */
const ILLEGAL_ARCHIVE_CHAR = /[<>:"|?*]/;

/**
 * Turn an adapter's archive name into a portable object key.
 *
 * `:` becomes `/`, so `ethereum:0xabc` lands at `ethereum/0xabc.json.gz`
 * rather than as a named stream. Everything else is left alone; if that
 * still contains an illegal character, `LocalFileArchive.put` refuses it.
 */
export function archiveObjectKey(source: string, day: string, name: string): string {
  const safe = name.replaceAll(':', '/');
  return `raw/${source}/${day}/${safe}.json.gz`;
}

export function assertSafeArchiveKey(key: string): void {
  if (ILLEGAL_ARCHIVE_CHAR.test(key)) {
    throw new Error(
      `archive key is not portable (illegal character): ${key}. ` +
        'Replace ":" with "/" in the adapter name; do not write NTFS streams.',
    );
  }
}

function workspaceRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

export function archiveRootExists(rootDir: string): boolean {
  return existsSync(rootDir);
}

function credentialsFromEnv(): { accessKeyId: string; secretAccessKey: string } | undefined {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return undefined;
  return { accessKeyId, secretAccessKey };
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'EEXIST'
  );
}

function isPreconditionFailed(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = 'name' in error ? String((error as { name: unknown }).name) : '';
  const http =
    '$metadata' in error
      ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      : undefined;
  return status === 'PreconditionFailed' || http === 412;
}
