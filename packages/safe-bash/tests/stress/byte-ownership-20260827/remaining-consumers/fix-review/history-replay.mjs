import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../../..');
const original = dirname(owned);
const originalDirect = join(original, 'direct-curl');
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = path => hash(readFileSync(path));
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
const run = (binary, args, options = {}) => {
  const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000, killSignal: 'SIGKILL', ...options });
  return { command: [binary, ...args], status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message };
};
const add = (name, value) => {
  const path = join(owned, 'evidence', name);
  assert.ok(!existsSync(path));
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  assert.equal(run('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${relative(root, path)}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n` }).status, 0);
};
const fixed = JSON.parse(readFileSync(join(owned, 'evidence/fixed-authentication.json')));
const installed = dirname(fixed.loaded.find(entry => entry.path.endsWith('/dist/index.js')).path).slice(0, -5);
const snapshotProduct = () => Object.fromEntries(walk(installed).sort().map(path => [relative(installed, path), digest(path)]));
assert.deepEqual(snapshotProduct(), fixed.packageAfter);
const historical = [
  ...['public.mjs', 'vectors.mjs', 'fixtures.mjs', 'archives.json', 'freeze.json', 'REPORT.md', 'run-packed.mjs'].map(name => join(original, name)),
  ...['direct-curl.test.ts', 'expectations.json', 'source-pin.json', 'README.md', 'REPORT.md', 'run.mjs'].map(name => join(originalDirect, name)),
];
const before = Object.fromEntries(historical.map(path => [relative(root, path), digest(path)]));
const scratch = join(owned, '.work/history-replay');
assert.ok(!existsSync(scratch));
mkdirSync(scratch);
writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'original-fixture-candidate-replay', private: true, type: 'module' }));
const packagePath = join(scratch, 'node_modules/virtual-bash');
mkdirSync(packagePath, { recursive: true });
for (const path of walk(installed)) { const target = join(packagePath, relative(installed, path)); mkdirSync(dirname(target), { recursive: true }); copyFileSync(path, target); }
const packed = join(scratch, 'packed24');
const direct = join(scratch, 'direct2');
mkdirSync(packed);
mkdirSync(join(direct, 'artifacts'), { recursive: true });
for (const name of ['public.mjs', 'vectors.mjs', 'fixtures.mjs', 'archives.json']) copyFileSync(join(original, name), join(packed, name));
for (const name of ['direct-curl.test.ts', 'expectations.json', 'source-pin.json']) copyFileSync(join(originalDirect, name), join(direct, name));
const transpile = ts.transpileModule(readFileSync(join(direct, 'direct-curl.test.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 }, reportDiagnostics: true });
assert.equal(transpile.diagnostics.length, 0);
const directModule = join(direct, 'direct-curl.mjs');
writeFileSync(directModule, transpile.outputText);
const productBefore = Object.fromEntries(walk(packagePath).sort().map(path => [path, digest(path)]));
const hashes = join(scratch, 'hashes.json');
writeFileSync(hashes, JSON.stringify(productBefore));
const profiles = [{ name: 'original-packed24-candidate', file: join(packed, 'public.mjs'), count: 24, expectedPass: 23 }, { name: 'original-direct2-candidate', file: directModule, count: 2, expectedPass: 2 }];
const runs = [];
for (const profile of profiles) {
  const loadedPath = join(scratch, `${profile.name}-loaded.jsonl`);
  const execution = run(process.execPath, ['--unhandled-rejections=strict', '--import', join(owned, 'history-preload.mjs'), '--experimental-loader', join(owned, 'history-loader.mjs'), '--test', '--test-concurrency=1', '--test-reporter=tap', profile.file], { cwd: scratch, env: { ...process.env, REVIEW_HISTORY: scratch, REVIEW_DIRECT: directModule, REVIEW_PUBLIC: join(packagePath, 'dist/index.js'), REVIEW_HASHES: hashes, REVIEW_LOADED: loadedPath, REMAINING_PUBLIC: join(packagePath, 'dist/index.js'), REMAINING_ARCHIVE: join(packagePath, 'dist/commands/archive/index.js'), REMAINING_NETWORK: join(packagePath, 'dist/commands/network/index.js'), REMAINING_CANDIDATE: fixed.candidate } });
  add(`${profile.name}-execution.json`, execution);
  const loaded = readFileSync(loadedPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(loaded.some(entry => entry.path === join(packagePath, 'dist/commands/network/body.js')));
  const totals = Object.fromEntries([...execution.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  runs.push({ profile, totals, status: execution.status, signal: execution.signal, loaded });
  assert.equal(execution.signal, null);
  assert.equal(totals.tests, profile.count);
  assert.equal(totals.pass, profile.expectedPass);
  assert.equal(totals.fail, profile.count - profile.expectedPass);
}
for (const path of walk(join(direct, 'artifacts'))) add('historical-direct-' + relative(join(direct, 'artifacts'), path), JSON.parse(readFileSync(path)));
const after = Object.fromEntries(historical.map(path => [relative(root, path), digest(path)]));
const productAfter = Object.fromEntries(walk(packagePath).sort().map(path => [path, digest(path)]));
assert.deepEqual(before, after);
assert.deepEqual(productBefore, productAfter);
assert.deepEqual(snapshotProduct(), fixed.packageAfter);
const copiedFixtures = Object.fromEntries([...walk(packed), ...walk(direct).filter(path => !path.includes('/artifacts/'))].map(path => [relative(scratch, path), digest(path)]));
add('historical-candidate-authentication.json', { candidate: fixed.candidate, fixedTarHash: fixed.tarHash, before, after, productBefore, productAfter, copiedFixtures, tsVersion: ts.version, adapterHashes: Object.fromEntries(['history-replay.mjs', 'history-preload.mjs', 'history-loader.mjs', 'loader.mjs'].map(name => [name, digest(join(owned, name))])), runs, originalAcceptance: false, note: 'Separate candidate cohort. Original fixture text and source pins unchanged. Direct TS is transpiled, its original relative public-root import is rebound by explicit loader to authenticated packed root. Diagnostic marker writes alone are redirected into owned scratch; no assertion or abort fixture modification.' });
console.log(JSON.stringify(runs.map(run => ({ profile: run.profile.name, totals: run.totals, status: run.status }))));
