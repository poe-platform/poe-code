import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const owned = resolve('tests/stress/regex-execution/production-continuation-review');
const name = process.argv[2];
if (!['baseline', 'candidate'].includes(name)) throw new Error('explicit frozen source required');
const snapshot = resolve(owned, 'snapshots', name);
const freeze = JSON.parse(await readFile(resolve(owned, `evidence/${name}-freeze.json`)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const entry of freeze.identities) {
  if (hash(await readFile(resolve(snapshot, entry.path))) !== entry.sha256) throw new Error(`snapshot drift: ${entry.path}`);
}
const compiler = resolve('node_modules/.bin/tsc');
const build = spawnSync(compiler, ['-p', resolve(snapshot, 'tsconfig.build.json')], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
const emitted = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else emitted.push({ path: relative(snapshot, path), sha256: hash(await readFile(path)) });
  }
}
await walk(resolve(snapshot, 'dist'));
await mkdir(resolve(owned, 'evidence', name), { recursive: true });
await writeFile(resolve(owned, 'evidence', name, 'build.json'), JSON.stringify({ status: build.status, signal: build.signal, stdout: build.stdout, stderr: build.stderr, error: build.error?.message, node: process.version, typescript: spawnSync(compiler, ['--version'], { encoding: 'utf8' }).stdout, emitted }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ name, status: build.status, emitted: emitted.length, diagnostic: build.stdout }));
if (build.status !== 0) process.exitCode = 1;
