import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sourceFiles } from './cases.mjs';

export function snapshot() {
  return Object.fromEntries(sourceFiles.map(name => [name, createHash('sha256')
    .update(readFileSync(new URL(`../../../../${name}`, import.meta.url))).digest('hex')]));
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.length !== 2) throw new Error('No snapshot arguments permitted');
  process.stdout.write(JSON.stringify({ utc: new Date().toISOString(), node: process.version,
    v8: process.versions.v8, executable: process.execPath, platform: process.platform,
    arch: process.arch, nodeOptions: process.env.NODE_OPTIONS ?? null, hashes: snapshot() }, null, 2) + '\n');
}
