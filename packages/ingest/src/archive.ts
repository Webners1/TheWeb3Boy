import { archiveObjectKey, gzipJson, toIsoDate } from '@vaultbench/shared';
import type { RawArchive } from '@vaultbench/shared';

export function createRawSink(archive: RawArchive, source: string, asOf: Date) {
  const day = toIsoDate(asOf);
  return async (name: string, payload: unknown): Promise<void> => {
    const gz = await gzipJson(payload);
    await archive.put(archiveObjectKey(source, day, name), gz);
  };
}

export function rawRef(source: string, asOf: Date, name: string): string {
  return archiveObjectKey(source, toIsoDate(asOf), name);
}
