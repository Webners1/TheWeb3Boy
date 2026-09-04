/**
 * One-shot: lift NTFS Alternate Data Streams into portable files.
 *
 * A colon in an archive key (`ethereum:0xabc.json.gz`) is a named stream
 * on Windows. This walks `var/archive`, lists streams on each host file,
 * and writes `hostName/streamName` as a real file. Safe to re-run.
 */
import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('var/archive');

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function streamsOf(file) {
  const escaped = file.replaceAll("'", "''");
  const raw = execSync(
    `powershell -NoProfile -Command "Get-Item -LiteralPath '${escaped}' -Stream * | Where-Object { $_.Stream -ne ':$DATA' } | ForEach-Object { $_.Stream }"`,
    { encoding: 'utf8' },
  );
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

let written = 0;
let skipped = 0;
let empty = 0;

for (const file of walk(ROOT)) {
  if (!statSync(file).isFile()) continue;
  const names = streamsOf(file);
  if (names.length === 0) continue;

  const destDir = path.join(path.dirname(file), path.basename(file));
  // The host file *is* the directory name we want (`ethereum`, `base`).
  // Park it so the directory can exist, then read streams off the parked
  // path — NTFS streams follow the file, not the original name.
  const parked = `${file}.__host`;
  if (!existsSync(parked)) {
    renameSync(file, parked);
  }
  const source = existsSync(parked) ? parked : file;
  mkdirSync(destDir, { recursive: true });

  for (const stream of names) {
    const dest = path.join(destDir, stream);
    if (existsSync(dest)) {
      skipped += 1;
      continue;
    }
    const payload = readFileSync(`${source}:${stream}`);
    if (payload.length === 0) empty += 1;
    writeFileSync(dest, payload, { flag: 'wx' });
    written += 1;
  }
}

console.log(JSON.stringify({ written, skipped, empty }));
