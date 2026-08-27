import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { supervise } from '../../../integration/full-gate-20260827/supervise.mjs';

const own = dirname(import.meta.filename), repo = resolve(own, '../../../..');
const source = process.argv[3] ?? '94bb4c974b17cd01477eff1c92e41619e0ebf465';
assert.ok(['94bb4c974b17cd01477eff1c92e41619e0ebf465', 'd904ca986fa945df8aef6e11b4165e2c2a63f814'].includes(source));
const output = process.argv[2]; assert.ok(output?.startsWith('/tmp/')); await mkdir(output);
const scratch = await mkdtemp('/tmp/safe-bash-time-env-packed-review-');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
async function hashes(directory, prefix = '') {
  const result = {};
  for (const entry of (await readdir(join(directory, prefix), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(directory, path));
    else { assert.ok(entry.isFile(), path); result[path] = hash(await readFile(join(directory, path))); }
  }
  return result;
}
const report = { source, startedAt: new Date().toISOString(), scratch, movingHead: git(['rev-parse', 'HEAD']).toString().trim(), commands: {}, versions: process.versions };
const environment = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: scratch, TMPDIR: join(scratch, 'tmp'), TZ: 'Pacific/Honolulu', LC_ALL: 'C', LANG: 'C', TSX_DISABLE_CACHE: '1', REVIEW_OUTPUT: output,
  GNU_DIR: join(scratch, 'oracle'), PACKED_ROOT: join(scratch, 'consumer/node_modules/virtual-bash') };
async function execute(label, args, cwd = scratch) {
  const result = await supervise(process.execPath, args, { cwd, env: environment, stdout: join(output, `${label}.stdout`), stderr: join(output, `${label}.stderr`), timeoutMs: 90000, maxOutputBytes: 16 * 1024 * 1024 });
  report.commands[label] = result;
  await writeFile(join(output, `${label}.json`), JSON.stringify(result));
  console.log(label, result.status); assert.equal(result.timedOut, false); assert.equal(result.outputExceeded, false); assert.deepEqual(result.survivors, []);
  return result.status;
}
try {
  const archive = git(['archive', source, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']);
  execFileSync('/usr/bin/tar', ['-xf', '-', '-C', scratch], { input: archive });
  report.archiveSha256 = hash(archive); report.inputs = await hashes(scratch);
  assert.equal(report.inputs['package-lock.json'], hash(await readFile(join(repo, 'package-lock.json'))));
  await cp(join(repo, 'node_modules'), join(scratch, 'node_modules'), { recursive: true, dereference: true });
  report.dependencies = await hashes(join(scratch, 'node_modules'));
  await mkdir(join(scratch, 'tmp')); await mkdir(join(scratch, 'oracle'));
  const native = join(repo, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/date');
  await cp(native, join(scratch, 'oracle/date')); report.nativeDateSha256 = hash(await readFile(native));
  assert.equal(report.nativeDateSha256, '14c1c04f8a1e859e9421993856ba1d29f49dc750d91be5dd299841f970f31f44');
  assert.equal(await execute('build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']), 0);
  report.buildHashes = await hashes(join(scratch, 'dist'));
  const npm = await realpath(join(dirname(process.execPath), 'npm'));
  report.npm = { path: npm, sha256: hash(await readFile(npm)) };
  assert.equal(await execute('pack', [npm, 'pack', '--ignore-scripts', '--offline', '--json', '--cache', join(scratch, 'cache'), '--pack-destination', scratch]), 0);
  const details = JSON.parse(await readFile(join(output, 'pack.stdout'), 'utf8'))[0];
  const tarball = join(scratch, details.filename); report.package = details; report.tarballSha256 = hash(await readFile(tarball));
  const installed = environment.PACKED_ROOT, consumer = join(scratch, 'consumer');
  await mkdir(installed, { recursive: true }); execFileSync('/usr/bin/tar', ['-xf', tarball, '-C', installed, '--strip-components=1']);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'time-env-independent-consumer', private: true, type: 'module' }));
  report.installedHashes = await hashes(installed); report.manifest = JSON.parse(await readFile(join(installed, 'package.json')));
  assert.deepEqual(report.manifest.dependencies ?? {}, {}); assert.equal(hash(await readFile(join(installed, 'package.json'))), report.inputs['package.json']);
  for (const [path, expected] of Object.entries(report.buildHashes)) assert.equal(report.installedHashes[`dist/${path}`], expected, path);
  report.reviewerInputs = {};
  for (const name of ['holdout.mts', 'guard.mjs']) { const bytes = await readFile(join(own, name)); report.reviewerInputs[name] = hash(bytes); await writeFile(join(consumer, name), bytes); await writeFile(join(output, `${name}.txt`), bytes); }
  const typeArgs = [join(scratch, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--types', 'node'];
  await execute('consumer-types', [...typeArgs, 'holdout.mts'], consumer);
  assert.equal(await execute('consumer-build', [...typeArgs.filter(argument => argument !== '--noEmit'), 'holdout.mts'], consumer), 0);
  report.emittedConsumerSha256 = hash(await readFile(join(consumer, 'holdout.mjs')));
  await execute('hidden', ['--unhandled-rejections=strict', '--import', './guard.mjs', 'holdout.mjs'], consumer);
  await writeFile(join(consumer, 'negative.mts'), `import {createTimeEnvCommands} from './node_modules/virtual-bash/dist/commands/time-env/index.js';\ncreateTimeEnvCommands({clock:()=>''});\ncreateTimeEnvCommands({scheduler:{now:()=>0,setTimeout:()=>0}});\ncreateTimeEnvCommands({limits:{maxOutputBytes:'1'}});\n`);
  assert.equal(await execute('negative-types', [...typeArgs, 'negative.mts'], consumer), 2);
  const diagnostic = await readFile(join(output, 'negative-types.stdout'), 'utf8');
  assert.equal((diagnostic.match(/error TS2322/g) ?? []).length, 2); assert.equal((diagnostic.match(/error TS2741/g) ?? []).length, 1); assert.equal((diagnostic.match(/error TS\d+/g) ?? []).length, 3);
  for (const [path, expected] of Object.entries(report.inputs)) assert.equal(hash(await readFile(join(scratch, path))), expected, path);
  assert.deepEqual(await hashes(installed), report.installedHashes); assert.deepEqual(await hashes(join(scratch, 'node_modules')), report.dependencies);
  report.inputsUnchanged = true;
} finally {
  await rm(scratch, { recursive: true, force: true }); report.cleaned = true; report.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'manifest.json'), JSON.stringify(report, null, 2));
}
