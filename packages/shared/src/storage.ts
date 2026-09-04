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
  const root = process.env.ARCHIVE_ROOT ?? path.join(process.cwd(), 'var', 'archive');
  return new LocalFileArchive(root);
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
