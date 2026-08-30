import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const own = dirname(import.meta.filename), repo = resolve(own, '../../..');
const [commit, destination] = process.argv.slice(2);
assert.match(commit ?? '', /^[a-f0-9]{40}$/u); assert.ok(destination);
const output = resolve(destination); mkdirSync(output);
const work = realpathSync(mkdtempSync(join(tmpdir(), 'safe-bash-time-env-independent-')));
const sha = value => createHash('sha256').update(value).digest('hex');
const report = { commit, started: new Date().toISOString(), versions: process.versions, steps: [], files: [], status: 'failed' };
const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: work, TMPDIR: work, LC_ALL: 'C', TZ: 'UTC', NPM_CONFIG_CACHE: join(work, 'cache'), NPM_CONFIG_USERCONFIG: join(work, 'npmrc') };
function run(name, binary, args, cwd = work, required = true) {
  const result = spawnSync(binary, args, { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16000000 });
  report.steps.push({ name, binary, args, cwd, status: result.status, signal: result.signal, error: result.error?.message });
  writeFileSync(join(output, `${name}.json`), JSON.stringify({ ...report.steps.at(-1), stdout: result.stdout, stderr: result.stderr }, null, 2));
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  if (required) assert.equal(result.status, 0, `${name}: ${result.stdout}\n${result.stderr}`);
  return result;
}
function manifest(root, path = '') {
  return readdirSync(join(root, path), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).flatMap(entry => {
    const relative = join(path, entry.name); assert.equal(entry.isSymbolicLink(), false);
    return entry.isDirectory() ? manifest(root, relative) : [{ path: relative, sha256: sha(readFileSync(join(root, relative))) }];
  });
}
try {
  const source = join(work, 'source'); mkdirSync(source);
  run('archive', 'git', ['archive', '--format=tar', `--output=${join(work, 'source.tar')}`, commit, 'src', 'package.json', 'package-lock.json', 'README.md', 'tsconfig.json', 'tsconfig.build.json'], repo);
  run('extract', '/usr/bin/tar', ['-xf', join(work, 'source.tar'), '-C', source]);
  report.archiveSha256 = sha(readFileSync(join(work, 'source.tar'))); report.files = manifest(source);
  cpSync(join(repo, 'node_modules'), join(source, 'node_modules'), { recursive: true, dereference: true });
  const compiler = join(source, 'node_modules/typescript/bin/tsc');
  report.toolHashes = [process.execPath, compiler].map(path => ({ path, sha256: sha(readFileSync(path)) }));
  run('build', process.execPath, [compiler, '-p', 'tsconfig.build.json'], source);
  const pack = JSON.parse(run('pack', 'npm', ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', work], source).stdout)[0];
  report.packageSha256 = sha(readFileSync(join(work, pack.filename))); report.packageFiles = pack.files;
  const staged = join(work, 'staged'); const installed = join(staged, 'node_modules/virtual-bash'); mkdirSync(installed, { recursive: true });
  run('unpack', '/usr/bin/tar', ['-xf', join(work, pack.filename), '--strip-components=1', '-C', installed]);
  assert.deepEqual(manifest(join(source, 'dist')), manifest(join(installed, 'dist')));
  assert.deepEqual(JSON.parse(readFileSync(join(installed, 'package.json'))).dependencies ?? {}, {});
  cpSync(join(source, 'node_modules/@types'), join(staged, 'node_modules/@types'), { recursive: true, dereference: true });
  cpSync(join(source, 'node_modules/undici-types'), join(staged, 'node_modules/undici-types'), { recursive: true });
  for (const name of ['consumer', 'negative']) cpSync(join(own, `${name}.ts.fixture`), join(staged, `${name}.mts`));
  writeFileSync(join(staged, 'package.json'), '{"name":"independent-time-env-public","type":"module"}');
  const moved = join(work, 'moved'); renameSync(staged, moved);
  const options = { target: 'ES2023', lib: ['ES2023'], module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, skipLibCheck: false, types: ['node'], outDir: 'emitted' };
  for (const name of ['consumer', 'negative']) writeFileSync(join(moved, `${name}.json`), JSON.stringify({ compilerOptions: options, files: [`${name}.mts`] }));
  run('types', process.execPath, [compiler, '-p', join(moved, 'consumer.json')], moved);
  const listing = run('type-resolution', process.execPath, [compiler, '-p', join(moved, 'consumer.json'), '--listFilesOnly'], moved).stdout;
  assert.ok(listing.includes(join(moved, 'node_modules/virtual-bash/dist/index.d.ts')));
  assert.ok(!listing.includes(join(source, 'src/')) && !listing.includes(join(source, 'dist/')));
  const invalid = run('negative-types', process.execPath, [compiler, '-p', join(moved, 'negative.json'), '--noEmit'], moved, false);
  assert.equal(invalid.status, 2); assert.deepEqual([...invalid.stdout.matchAll(/error TS(\d+):/gu)].map(match => Number(match[1])), [2353, 2322, 2741, 2322]);
  renameSync(source, join(work, 'withdrawn'));
  const flags = ['--experimental-permission', `--allow-fs-read=${moved}`, '--unhandled-rejections=strict'];
  const result = run('runtime', process.execPath, [...flags, join(moved, 'emitted/consumer.mjs')], moved);
  report.counts = Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo'].map(key => [key, Number(result.stdout.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1])]));
  assert.equal(report.counts.tests, 10); assert.equal(report.counts.pass, 10);
  for (const key of ['fail', 'skipped', 'cancelled', 'todo']) assert.equal(report.counts[key], 0);
  const denial = run('source-denied', process.execPath, [...flags, '--input-type=module', '-e', `import{readFileSync}from'node:fs';readFileSync(${JSON.stringify(join(work, 'withdrawn/src/index.ts'))})`], moved, false);
  assert.equal(denial.status, 1); assert.match(denial.stderr, /ERR_ACCESS_DENIED/u);
  renameSync(join(moved, 'node_modules/virtual-bash/dist/commands/time-env'), join(work, 'withdrawn-time-env'));
  for (const [name, specifier] of [['root', 'virtual-bash'], ['leaf', 'virtual-bash/commands/time-env']]) {
    const denied = run(`${name}-missing-module`, process.execPath, [...flags, '--input-type=module', '-e', `await import(${JSON.stringify(specifier)})`], moved, false);
    assert.equal(denied.status, 1); assert.match(denied.stderr, /ERR_MODULE_NOT_FOUND/u);
  }
  report.status = 'passed-independent-public-integration-only';
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally { rmSync(work, { recursive: true, force: true }); report.cleaned = true; report.finished = new Date().toISOString(); writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, status: report.status, counts: report.counts, error: report.error })); }
