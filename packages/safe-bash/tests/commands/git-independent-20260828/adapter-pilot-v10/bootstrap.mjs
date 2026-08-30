import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const seal = JSON.parse(readFileSync(join(root, 'PRESEAL.json')));
const manifestBytes = readFileSync(join(root, 'RUN-01/MODULES.json'));
const manifest = JSON.parse(manifestBytes);
for (const name of ['bootstrap.mjs', 'loader.mjs']) assert.equal(hash(readFileSync(join(root, name))), seal.files.find(row => row.path === name).sha256);
console.log(JSON.stringify({ kind: 'birth', role: 'pilot', pid: process.pid, ppid: process.ppid, execPath: process.execPath,
  version: process.version, bootstrapUrl: import.meta.url, bootstrapSha256: hash(readFileSync(fileURLToPath(import.meta.url))), manifestSha256: hash(manifestBytes) }));
register(pathToFileURL(join(root, 'loader.mjs')).href, { parentURL: import.meta.url, data: {
  files: manifest.files, manifestSha256: hash(manifestBytes), trace: join(root, 'RUN-01/loads.jsonl'),
  loaderSha256: seal.files.find(row => row.path === 'loader.mjs').sha256, allowedBuiltins: seal.allowedBuiltins,
} });
const worker = await import('./worker.mjs');
await worker.run();
