import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { nativeCases, hostCases } from './cases.mjs';
import { runChild, sha256, owned, environment, entries, save } from './support.mjs';

assert.equal(process.argv[2], '--root-authorized-ready', 'Preparation only until ROOT explicitly resumes acceptance');
const [readyPath, revision, outputName] = process.argv.slice(3);
assert.match(revision ?? '', /^[a-f0-9]{40}$/);
assert.ok(outputName && outputName !== 'native-frozen.json' && outputName !== 'preparation.json');
const ready = await readFile(readyPath, 'utf8');
assert.ok(ready.includes(revision));
assert.match(ready, /(?:lease[^\n]*relinquished|relinquished[^\n]*lease)/i);
const nativeBytes = await readFile(`${owned}/native-frozen.json`);
const native = JSON.parse(nativeBytes);
const prepared = JSON.parse(await readFile(`${owned}/preparation.json`));
for (const [path, hash] of Object.entries(prepared.fixedInputs)) assert.equal(sha256(await readFile(path)), hash, `Frozen consumer input changed: ${path}`);
assert.equal(native.casesHash, sha256(await readFile(`${owned}/cases.mjs`)));
const scratch = await realpath(await mkdtemp(resolve(tmpdir(), 'safe-bash-public-built-consumer-')));
const snapshot = resolve(scratch, 'package');
const consumer = resolve(scratch, 'consumer');
const phases = [];
const report = { revision, ready, readyHash: sha256(ready), nativeHash: sha256(nativeBytes), snapshot, phases, product: [], note: 'Committed archive only. No live source overlay; build dependency symlink removed before public consumer resolution.' };
try {
  await mkdir(snapshot);
  await mkdir(consumer);
  const archive = execFileSync('/usr/bin/git', ['archive', '--format=tar', revision, 'package.json', 'tsconfig.json', 'tsconfig.build.json', 'src'], { maxBuffer: 32e6 });
  report.archiveHash = sha256(archive);
  const unpack = await runChild('/usr/bin/tar', ['-xf', '-', '-C', snapshot], { stdin: archive, env: environment, deadline: 15000 });
  phases.push({ id: 'archive', run: unpack });
  assert.equal(unpack.status, 0);
  const packageBytes = await readFile(resolve(snapshot, 'package.json'));
  assert.equal(sha256(packageBytes), prepared.packageHash, 'Manifest/exports changed; ROOT must review, never overlay');
  const manifest = JSON.parse(packageBytes);
  assert.equal(manifest.name, 'virtual-bash');
  assert.equal(manifest.exports['.'].import, './dist/index.js');
  assert.equal(manifest.exports['./contracts'].import, './dist/contracts/index.js');
  assert.equal(manifest.scripts.build, 'tsc -p tsconfig.build.json');
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
  const archived = await entries(snapshot);
  report.archivedFiles = Object.fromEntries(Object.entries(archived).map(([path, entry]) => [path, entry.hex === undefined ? entry : { sha256: sha256(Buffer.from(entry.hex, 'hex')), mode: entry.mode }]));
  for (const [path, entry] of Object.entries(archived)) if (entry.hex !== undefined) assert.equal(sha256(Buffer.from(entry.hex, 'hex')), sha256(execFileSync('/usr/bin/git', ['show', `${revision}:${path}`], { maxBuffer: 8e6 })), `Archive differs from committed blob: ${path}`);
  report.shellAnchors = {};
  for (const path of ['src/shell/runtime.ts', 'src/shell/parser.ts']) {
    const hash = sha256(await readFile(resolve(snapshot, path)));
    assert.ok(ready.includes(hash), `READY must contain committed ${path} SHA256`);
    report.shellAnchors[path] = hash;
  }
  const modules = await realpath('node_modules');
  await symlink(modules, resolve(snapshot, 'node_modules'));
  report.buildOnlyModules = modules;
  const compiler = resolve(modules, 'typescript/bin/tsc');
  report.compilerHash = sha256(await readFile(compiler));
  report.compilerImplementationHash = sha256(await readFile(resolve(modules, 'typescript/lib/_tsc.js')));
  assert.equal(report.compilerHash, prepared.toolchain.tscHash, 'Development compiler changed after preparation');
  assert.equal(report.compilerImplementationHash, prepared.toolchain.implementationHash, 'Development compiler implementation changed after preparation');
  const build = await runChild(process.execPath, [compiler, '-p', resolve(snapshot, 'tsconfig.build.json'), '--listFiles'], { cwd: snapshot, env: environment, deadline: 60000 });
  phases.push({ id: 'isolated-build', argv: [process.execPath, compiler, '-p', resolve(snapshot, 'tsconfig.build.json'), '--listFiles'], run: build });
  assert.equal(build.status, 0, Buffer.from(build.stdout, 'base64').toString() + Buffer.from(build.stderr, 'base64').toString());
  assert.equal(build.timedOut || build.overflow, false);
  const listed = Buffer.from(build.stdout, 'base64').toString().split('\n').filter(path => path.startsWith('/'));
  report.compilerInputs = Object.fromEntries(await Promise.all(listed.map(async path => [path, { realpath: await realpath(path), sha256: sha256(await readFile(path)) }])));
  assert.ok(listed.every(path => path.startsWith(snapshot + '/') || path.startsWith(modules + '/')), 'Live source alias in compiler inputs');
  await rm(resolve(snapshot, 'node_modules'));
  const emittedBefore = await entries(resolve(snapshot, 'dist'));
  report.emittedDigest = sha256(JSON.stringify(emittedBefore));
  report.emittedBefore = Object.fromEntries(Object.entries(emittedBefore).filter(([, entry]) => entry.hex !== undefined).map(([path, entry]) => ['dist/' + path, sha256(Buffer.from(entry.hex, 'hex'))]));
  for (const name of ['consumer.mjs', 'cases.mjs']) await writeFile(resolve(consumer, name), await readFile(`${owned}/${name}`));
  await mkdir(resolve(consumer, 'node_modules'));
  await symlink(snapshot, resolve(consumer, 'node_modules', manifest.name));
  report.packageLink = resolve(consumer, 'node_modules', manifest.name);
  for (const fixture of [...nativeCases, ...hostCases]) {
    const before = await entries(resolve(snapshot, 'dist'));
    const run = await runChild(process.execPath, ['--unhandled-rejections=strict', resolve(consumer, 'consumer.mjs'), fixture.id], { cwd: consumer, env: { ...environment, CONSUMER_PACKAGE_ROOT: snapshot }, deadline: 8000 });
    let actual;
    try { actual = JSON.parse(Buffer.from(run.stdout, 'base64').toString()); } catch { actual = { protocolError: true }; }
    const after = await entries(resolve(snapshot, 'dist'));
    const mismatches = Object.entries(actual.loaded ?? {}).filter(([path, hash]) => report.emittedBefore[path] !== hash);
    const valid = run.status === 0 && run.stderr === '' && !run.timedOut && !run.overflow && !run.groupAlive && !mismatches.length && sha256(JSON.stringify(before)) === report.emittedDigest && isDeepStrictEqual(before, after) && !!actual.loaded?.['dist/shell/runtime.js'] && !!actual.loaded?.['dist/index.js'];
    const profiles = fixture.kind ? [] : native.profiles.map(profile => ({ role: profile.role, passed: isDeepStrictEqual(actual.observation, profile.rows.find(row => row.id === fixture.id).tuple) }));
    report.product.push({ id: fixture.id, kind: fixture.kind ?? 'native', run, actual, valid, mismatches, profiles });
  }
  const finalArchive = await entries(snapshot, ['dist']);
  assert.deepEqual(finalArchive, archived, 'Committed source/config changed during isolated build/consumer execution');
  report.summary = { native: native.profiles.map(profile => ({ role: profile.role, total: nativeCases.length, passed: report.product.filter(row => row.kind === 'native' && row.valid && row.profiles.find(comparison => comparison.role === profile.role).passed).length })), host: { total: hostCases.length, passed: report.product.filter(row => row.kind !== 'native' && row.valid && row.actual.observation?.passed === true).length }, invalid: report.product.filter(row => !row.valid).length };
  report.completed = true;
  if (report.product.some(row => !row.valid || (row.kind === 'native' ? !row.profiles[0].passed : row.actual.observation?.passed !== true))) process.exitCode = 1;
} catch (error) {
  report.failure = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
  report.cleaned = true;
  save(outputName, report);
}
