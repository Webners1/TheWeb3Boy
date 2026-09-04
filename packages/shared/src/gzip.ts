import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export async function gzipJson(payload: unknown): Promise<Buffer> {
  const json = JSON.stringify(payload);
  return gzipAsync(json);
}

export async function gunzipJson(buffer: Buffer): Promise<unknown> {
  const raw = await gunzipAsync(buffer);
  return JSON.parse(raw.toString('utf8')) as unknown;
}
