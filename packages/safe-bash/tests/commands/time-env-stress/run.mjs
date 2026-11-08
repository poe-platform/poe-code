import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { supervise } from '../../integration/full-gate-20260827/supervise.mjs';

const own = dirname(import.meta.filename), repo = resolve(own, '../../..');
const source = 'd904ca986fa945df8aef6e11b4165e2c2a63f814';
const output = process.argv[2];
assert.ok(output?.startsWith('/tmp/'));
await mkdir(output);
const scratch = await mkdtemp('/tmp/safe-bash-time-env-independent-');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
const save = (path, value) => writeFile(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
async function hashes(directory, prefix = '') {
  const values = {};
  for (const entry of (await readdir(join(directory, prefix), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(values, await hashes(directory, path));
    else { assert.ok(entry.isFile(), path); values[path] = hash(await readFile(join(directory, path))); }
  }
  return values;
}
const report = { source, startedAt: new Date().toISOString(), scratch, node: process.version, versions: process.versions, platform: process.platform,
  movingHead: git(['rev-parse', 'HEAD']).toString().trim(), movingStatus: git(['status', '--short']).toString(), commands: {} };
const environment = { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: join(scratch, 'tmp'), TZ: 'Pacific/Honolulu', LC_ALL: 'C', LANG: 'C', TSX_DISABLE_CACHE: '1', REVIEW_OUTPUT: output,
  GNU_DIR: join(scratch, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src') };
async function execute(label, args) {
  const result = await supervise(process.execPath, args, { cwd: scratch, env: environment, stdout: join(output, `${label}.stdout`), stderr: join(output, `${label}.stderr`), timeoutMs: 90000, maxOutputBytes: 16 * 1024 * 1024 });
  const text = await readFile(join(output, `${label}.stdout`), 'utf8');
  result.counts = Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  report.commands[label] = result;
  await save(join(output, `${label}.json`), result);
  console.log(label, result.status, result.counts);
  assert.equal(result.timedOut, false); assert.equal(result.outputExceeded, false); assert.deepEqual(result.survivors, []);
  return result.status;
}
try {
  const paths = git(['ls-tree', '-r', '--name-only', source]).toString().trim().split('\n').filter(path => path.startsWith('src/')
    || path.startsWith('tests/commands/time-env/') && !path.includes('/evidence/') || ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].includes(path));
  const archive = git(['archive', source, '--', ...paths]);
  execFileSync('/usr/bin/tar', ['-xf', '-', '-C', scratch], { input: archive });
  report.archiveSha256 = hash(archive); report.inputs = await hashes(scratch);
  assert.equal(report.inputs['package-lock.json'], hash(await readFile(join(repo, 'package-lock.json'))));
  await cp(join(repo, 'node_modules'), join(scratch, 'node_modules'), { recursive: true, dereference: true });
  report.dependencies = await hashes(join(scratch, 'node_modules'));
  report.native = {};
  const oracle = 'tests/commands/metadata-stress/.oracle/coreutils-9.7';
  for (const name of ['date', 'sleep', 'printenv']) {
    const target = join(scratch, oracle, 'src', name);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(repo, oracle, 'src', name), target, { dereference: true });
    report.native[name] = { sha256: hash(await readFile(target)), version: execFileSync(target, ['--version'], { env: { LC_ALL: 'C' } }).toString() };
  }
  for (const path of ['/bin/date', '/bin/sleep', '/usr/bin/printenv']) report.native[path] = { sha256: hash(await readFile(path)) };
  report.primary = JSON.parse(await readFile(join(repo, 'tests/commands/metadata-stress/oracle-evidence.json')));
  const primaryArchive = join(repo, 'tests/commands/metadata-stress/.oracle/coreutils-9.7.tar.xz');
  assert.equal(hash(await readFile(primaryArchive)), report.primary.archiveSha256);
  report.primarySourceHashes = {};
  for (const path of ['src/date.c', 'src/sleep.c', 'src/printenv.c', 'doc/coreutils.texi']) {
    report.primarySourceHashes[path] = hash(execFileSync('/usr/bin/tar', ['-xOf', primaryArchive, `coreutils-9.7/${path}`], { maxBuffer: 4 * 1024 * 1024 }));
  }
  await mkdir(join(scratch, 'tmp'));
  report.reviewerInputs = {};
  for (const name of ['consumer.mts', 'guard.mjs']) {
    const bytes = await readFile(join(own, name)); report.reviewerInputs[name] = hash(bytes);
    await writeFile(join(scratch, name), bytes);
    await save(join(output, `${name}.txt`), bytes.toString());
  }
  await save(join(output, 'manifest-before.json'), report);
  const tests = paths.filter(path => path.startsWith('tests/commands/time-env/') && path.endsWith('.test.ts'));
  await execute('unchanged-author', ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-timeout=30000', ...tests]);
  await execute('author-types', ['node_modules/typescript/bin/tsc', '-p', 'tests/commands/time-env/tsconfig.json', '--noEmit']);
  assert.equal(await execute('build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']), 0);
  const typeArgs = ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--types', 'node'];
  await execute('consumer-types', [...typeArgs, 'consumer.mts']);
  await execute('independent', ['--unhandled-rejections=strict', '--import', 'tsx', '--import', './guard.mjs', 'consumer.mts']);
  await save(join(scratch, 'negative.mts'), `import {createTimeEnvCommands} from './dist/commands/time-env/index.js';\ncreateTimeEnvCommands({clock:()=>''});\ncreateTimeEnvCommands({scheduler:{now:()=>0,setTimeout:()=>0}});\ncreateTimeEnvCommands({limits:{maxOutputBytes:'1'}});\n`);
  assert.equal(await execute('negative-types', [...typeArgs, 'negative.mts']), 2);
  const diagnostic = await readFile(join(output, 'negative-types.stdout'), 'utf8');
  assert.equal((diagnostic.match(/error TS2322/g) ?? []).length, 2); assert.equal((diagnostic.match(/error TS2741/g) ?? []).length, 1);
  assert.equal((diagnostic.match(/error TS\d+/g) ?? []).length, 3);
  for (const [path, expected] of Object.entries(report.inputs)) assert.equal(hash(await readFile(join(scratch, path))), expected, path);
  assert.deepEqual(await hashes(join(scratch, 'node_modules')), report.dependencies);
  report.inputsUnchanged = true; report.buildHashes = await hashes(join(scratch, 'dist'));
} finally {
  await rm(scratch, { recursive: true, force: true });
  report.cleaned = true; report.finishedAt = new Date().toISOString();
  await save(join(output, 'manifest-after.json'), report);
}
