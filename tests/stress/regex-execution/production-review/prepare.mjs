import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const name = process.argv[2];
if (!name || name === 'baseline' || !/^[a-z0-9-]+$/u.test(name)) throw new Error('unique production snapshot name required');
const owned = resolve('tests/stress/regex-execution/production-review');
const ready = await readFile('/tmp/regex-production-author-ready.txt', 'utf8');
const evidence = resolve(owned, 'evidence', name);
await mkdir(evidence, { recursive: true });
await writeFile(resolve(evidence, 'author-ready.txt'), ready, { flag: 'wx' });
for (const item of ['api', 'root-notes']) await writeFile(resolve(evidence, `${item}.txt`), await readFile(`/tmp/regex-production-${item}.txt`), { flag: 'wx' });
const frozen = spawnSync(process.execPath, [resolve(owned, 'freeze.mjs'), name], { encoding: 'utf8' });
if (frozen.status !== 0) throw new Error(frozen.stderr);
const snapshot = resolve(owned, 'snapshots', name);
const result = spawnSync(resolve('node_modules/.bin/tsc'), ['-p', resolve(snapshot, 'tsconfig.build.json')], { encoding: 'utf8' });
const emitted = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else emitted.push({ path: relative(snapshot, path), sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
  }
}
await walk(resolve(snapshot, 'dist'));
await writeFile(resolve(evidence, 'build.json'), JSON.stringify({ status: result.status, stdout: result.stdout, stderr: result.stderr, node: process.version, typescript: spawnSync(resolve('node_modules/.bin/tsc'), ['--version'], { encoding: 'utf8' }).stdout, emitted }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ name, status: result.status, emitted: emitted.length, diagnostic: result.stdout }));
if (result.status !== 0) process.exitCode = 1;
