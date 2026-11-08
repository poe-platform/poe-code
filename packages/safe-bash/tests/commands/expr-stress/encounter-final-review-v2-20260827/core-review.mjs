import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, lstatSync, readlinkSync, symlinkSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const candidate = 'c3e40f8bd721da5e496f3b3abfd51aee45db5a84';
const label = process.argv[2];
assert(/^[a-z0-9-]+$/u.test(label ?? ''));
const output = join(owned, label), scratch = join(owned, 'node_modules', label);
assert(!existsSync(output) && !existsSync(scratch));
mkdirSync(output);
mkdirSync(scratch, { recursive: true });
const save = (name, value) => writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = join(scratch, 'source'), temporary = join(scratch, 'temporary');
mkdirSync(source); mkdirSync(temporary);
const environment = { ...process.env, TMPDIR: temporary, TSX_DISABLE_CACHE: '1' };
const processes = [];
function command(name, executable, args, cwd = source, extra = {}) {
  const started = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd, env: environment, timeout: 180000, maxBuffer: 32 * 1024 * 1024, ...extra });
  const record = { executable, args, cwd, started, finished: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout?.toString(), stderr: result.stderr?.toString() };
  save(`${name}-process.json`, record); processes.push({ name, status: record.status, signal: record.signal });
  return record;
}
function inventory(directory, excludes = []) {
  const records = {};
  function walk(current, prefix = '') {
    for (const entry of readdirSync(current).sort()) {
      if (!prefix && excludes.includes(entry)) continue;
      const filename = prefix ? `${prefix}/${entry}` : entry;
      const absolute = join(current, entry), stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) records[filename] = { kind: 'symlink', target: readlinkSync(absolute) };
      else if (stat.isDirectory()) { records[filename] = { kind: 'directory' }; walk(absolute, filename); }
      else records[filename] = { kind: 'file', bytes: stat.size, sha256: hash(readFileSync(absolute)) };
    }
  }
  walk(directory);
  return records;
}
const selected = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
const archive = () => {
  const result = spawnSync('git', ['archive', '--format=tar', candidate, ...selected], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0);
  return result.stdout;
};
try {
  const archived = archive();
  assert.equal(command('extract', 'tar', ['-xf', '-', '-C', source], root, { input: archived }).status, 0);
  const before = inventory(source);
  save('source-before.json', before);
  symlinkSync(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
  assert.equal(command('build', process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--skipLibCheck', 'false']).status, 0);
  const compiled = inventory(join(source, 'dist'));
  save('compiled-before.json', compiled);
  const pack = command('pack', 'npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', join(scratch, 'pack-cache'), '--pack-destination', scratch]);
  assert.equal(pack.status, 0);
  const artifact = JSON.parse(pack.stdout)[0];
  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), '{"name":"expr-core-physical-review","private":true,"type":"module"}\n', { flag: 'wx' });
  assert.equal(command('install', 'npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(scratch, 'install-cache'), join(scratch, artifact.filename)], consumer).status, 0);
  const relocated = join(scratch, 'relocated');
  renameSync(consumer, relocated);
  const installed = join(relocated, 'node_modules/virtual-bash');
  const installedBefore = inventory(installed);
  save('installed-before.json', installedBefore);
  assert.deepEqual(inventory(join(installed, 'dist')), compiled);
  const result = command('core', process.execPath, [join(owned, 'core-bound.mjs'), label], relocated, { env: { ...environment, REVIEW_INSTALLED: installed, REVIEW_COMMIT: candidate, REVIEW_TMP: temporary, REVIEW_OUTPUT: output, REVIEW_TAR_SHA256: hash(readFileSync(join(scratch, artifact.filename))), NODE_PATH: '' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const controls = JSON.parse(readFileSync(join(output, 'core-controls.json')));
  save('summary.json', { candidate, selected, archiveSha256: hash(archived), passed: controls.rows.filter(row => row.passed).length, total: controls.rows.length, failed: controls.failedSubcases, frozenTuplesUnchanged: true, bindingDeltas: '../core-binding-deltas.json', noPublicExprClaim: true, noNativeRecapture: true });
  save('source-after.json', inventory(source, ['dist', 'node_modules']));
  assert.deepEqual(inventory(source, ['dist', 'node_modules']), before);
  assert.deepEqual(inventory(join(source, 'dist')), compiled);
  assert.deepEqual(inventory(installed), installedBefore);
  assert.equal(hash(archive()), hash(archived));
  save('integrity.json', { selectedSourceAndBuiltAndInstalledEntrySetsUnchanged: true, detectsAppendedEntries: true, candidateArchiveUnchanged: true, globalClaim: false });
  console.log(JSON.stringify({ passed: controls.rows.filter(row => row.passed).length, total: controls.rows.length, failed: controls.failedSubcases }));
} finally {
  save('temporary-before-cleanup.json', inventory(temporary));
  rmSync(scratch, { recursive: true, force: true });
  save('cleanup.json', { scratch, absent: !existsSync(scratch), processes, finished: new Date().toISOString() });
}
