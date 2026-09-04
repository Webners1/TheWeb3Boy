import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Append-only raw-payload archive. There is intentionally no update or
 * delete operation: raw data is append-only (AGENTS.md).
 */
export interface RawArchive {
  put(key: string, payload: Buffer | string): Promise<void>;
}

/** Local-filesystem archive for development and tests. */
export class LocalFileArchive implements RawArchive {
  constructor(private readonly rootDir: string) {}

  async put(key: string, payload: Buffer | string): Promise<void> {
    const root = path.resolve(this.rootDir);
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep)) {
      throw new Error(`archive key escapes root: ${key}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    // 'wx': fail rather than overwrite an existing payload.
    await writeFile(target, payload, { flag: 'wx' });
  }
}
