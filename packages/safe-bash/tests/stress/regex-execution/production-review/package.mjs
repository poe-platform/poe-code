import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const name = process.argv[2];
const label = process.argv[3] ?? 'package';
if (!name || !/^[a-z0-9-]+$/u.test(name)) throw new Error('snapshot name required');
if (!/^[a-z0-9-]+$/u.test(label)) throw new Error('safe unique evidence label required');
const owned = resolve('tests/stress/regex-execution/production-review');
const snapshot = resolve(owned, 'snapshots', name);
const moved = resolve(owned, '.temporary', `moved-${name}-${label}`);
const packageRoot = resolve(moved, 'node_modules/virtual-bash');
await mkdir(packageRoot, { recursive: true });
await writeFile(resolve(moved, 'package.json'), JSON.stringify({ name: 'independent-regex-consumer', private: true, type: 'module' }) + '\n', { flag: 'wx' });
const commands = [];
function run(executable, args, cwd = moved) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  const record = { executable, args, cwd, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  commands.push(record);
  return record;
}
const packed = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', moved], snapshot);
if (packed.status === 0) {
  const metadata = JSON.parse(packed.stdout)[0];
  const archive = resolve(moved, metadata.filename);
  run('/usr/bin/tar', ['-xzf', archive, '-C', packageRoot, '--strip-components=1']);
  await copyFile(new URL('./package-consumer.mjs', import.meta.url), resolve(moved, 'consumer.mjs'));
  await copyFile(new URL('./package-consumer.mts', import.meta.url), resolve(moved, 'consumer.mts'));
  run(process.execPath, ['--max-old-space-size=128', resolve(moved, 'consumer.mjs')]);
  run(resolve('node_modules/.bin/tsc'), ['--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--lib', 'ES2023', '--strict', '--skipLibCheck', resolve(moved, 'consumer.mts')]);
  const asset = 'dist/commands/regex-execution/worker.js';
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  commands.push({ asset, packed: metadata.files.some(file => file.path === asset), sourceSha256: digest(await readFile(resolve(snapshot, asset))), movedSha256: digest(await readFile(resolve(packageRoot, asset))) });
}
const pass = commands.filter(command => 'status' in command).every(command => command.status === 0) && commands.some(command => command.packed && command.sourceSha256 === command.movedSha256);
await writeFile(resolve(owned, `evidence/${name}/${label}.json`), JSON.stringify({ pass, commands }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ pass, checks: commands.length }));
if (!pass) process.exitCode = 1;
