import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const owned = resolve('tests/stress/regex-execution/cleanup-boundary-review');
const label = process.argv[2];
if (!/^[a-z][a-z0-9-]*$/u.test(label ?? '')) throw new Error('snapshot label required');
const snapshot = resolve(owned, '.temporary', label);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(resolve(owned, 'evidence', `${label}-freeze.json`)));
for (const entry of manifest.identities) if (hash(await readFile(resolve(snapshot, entry.path))) !== entry.sha256) throw new Error(`source drift: ${entry.path}`);
const compiler = resolve('node_modules/.bin/tsc');
const result = spawnSync(compiler, ['-p', resolve(snapshot, 'tsconfig.build.json')], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
const emitted = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else emitted.push({ path: relative(snapshot, path), sha256: hash(await readFile(path)) });
  }
}
if (result.status === 0) await walk(resolve(snapshot, 'dist'));
const record = { label, sourceCommit: manifest.commit, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message, node: process.version, typescript: spawnSync(compiler, ['--version'], { encoding: 'utf8' }).stdout.trim(), emitted };
await writeFile(resolve(owned, 'evidence', `${label}-build.json`), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ label, status: result.status, emitted: emitted.length, diagnostic: result.stdout }));
if (result.status !== 0) process.exitCode = 1;
