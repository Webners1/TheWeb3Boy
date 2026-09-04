import { gzipJson, toIsoDate } from '@vaultbench/shared';
import type { RawArchive } from '@vaultbench/shared';

export function createRawSink(archive: RawArchive, source: string, asOf: Date) {
  const day = toIsoDate(asOf);
  return async (name: string, payload: unknown): Promise<void> => {
    const key = `raw/${source}/${day}/${name}.json.gz`;
    const gz = await gzipJson(payload);
    await archive.put(key, gz);
  };
}

export function rawRef(source: string, asOf: Date, name: string): string {
  return `raw/${source}/${toIsoDate(asOf)}/${name}.json.gz`;
}
