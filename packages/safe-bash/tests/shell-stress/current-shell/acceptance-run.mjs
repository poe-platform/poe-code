import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { owned, root, environment, sourceGuard, runChild, patchJson, sha256 } from './support.mjs';

const readyPath = '/tmp/safe-bash-source-dot-eval-diagnostics-ready.txt';
const ready = await readFile(readyPath, 'utf8');
assert.match(ready, /^READY/u);
assert.match(ready, /lease relinquished/iu);
const revision = /atomic commit\s*([a-f0-9]{40})/u.exec(ready)?.[1];
const runtimeHash = /Final runtime SHA256\s+([a-f0-9]{64})/u.exec(ready)?.[1];
assert.ok(revision && runtimeHash);
const short = revision.slice(0, 7);
const temporary = await mkdtemp(resolve(owned, '.acceptance-'));
const records = [];
const start = new Date().toISOString();
const attempt = process.argv[2] ?? '';
const patchExecutable = execFileSync('/usr/bin/which', ['apply_patch'], { encoding: 'utf8' }).trim();
const frozenPaths = ['cases.mjs', 'native-frozen.json', 'product-child.mjs', 'run-product.mjs', 'current-shell.test.ts', 'pre-ready-red.json', 'pre-ready-witness-red.json', 'pre-ready-validation.json'];
const frozen = {};
for (const file of frozenPaths) {
  const path = relative(root, resolve(owned, file));
  const expected = sha256(execFileSync('git', ['show', `42baad3:${path}`], { maxBuffer: 8 * 1024 * 1024 }));
  assert.equal(sha256(await readFile(path)), expected, `Immutable ${path}`);
  frozen[path] = expected;
}

async function shellReady() {
  assert.equal(sha256(execFileSync('git', ['show', `${revision}:src/shell/runtime.ts`])), runtimeHash);
  assert.equal(sha256(await readFile('src/shell/runtime.ts')), runtimeHash);
  execFileSync('git', ['diff', '--quiet', revision, '--', 'src/shell']);
}

async function snapshot() {
  const paths = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(?:ts|mjs)$/u.test(path)) paths.push(path);
    }
  }
  await walk('src');
  await walk('tests');
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'benchmarks/tsconfig.json', ...Object.keys(frozen)]) paths.push(resolve(path));
  return Object.fromEntries(await Promise.all([...new Set(paths)].sort().map(async path => [path, sha256(await readFile(path))])));
}

function findings(text) {
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: /tmp/safe-bash-current-shell-acceptance-findings.txt\n${text.split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n` });
}

async function phase(label, args, compiler = false) {
  await shellReady();
  const hashTrace = resolve(temporary, `${label}-hash.jsonl`);
  const pathTrace = resolve(temporary, `${label}-paths.log`);
  const env = { ...environment, PATH: '/usr/bin:/bin', CURRENT_SHELL_IMPORT_TRACE: hashTrace, INVOCATION_TRACE: pathTrace, CURRENT_SHELL_APPLY_PATCH: patchExecutable };
  let listed;
  let compilerPaths = [];
  if (compiler) {
    listed = await runChild(process.execPath, [...args, '--listFilesOnly'], { env, deadline: 60000 });
    assert.equal(listed.status, 0);
    compilerPaths = Buffer.from(listed.stdout, 'base64').toString().split('\n').filter(path => path.startsWith('/') && /\.(?:ts|mts|cts|tsx)$/u.test(path));
    assert.ok(compilerPaths.length);
  }
  const before = await snapshot();
  for (const path of compilerPaths) before[path] = sha256(await readFile(path));
  const run = await runChild(process.execPath, [...args, ...(compiler ? ['--listFiles'] : [])], { env, deadline: 100000 });
  const after = await snapshot();
  for (const path of compilerPaths) after[path] = await readFile(path).then(sha256).catch(() => null);
  const imports = (await readFile(hashTrace, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const legacyPaths = (await readFile(pathTrace, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const stdout = Buffer.from(run.stdout, 'base64').toString();
  const actualCompilerPaths = compiler ? stdout.split('\n').filter(path => path.startsWith('/') && /\.(?:ts|mts|cts|tsx)$/u.test(path)) : [];
  const actual = [...new Set(compiler ? actualCompilerPaths : [...imports.map(entry => entry.path), ...legacyPaths])].sort();
  const mismatches = imports.filter(entry => entry.hash !== before[entry.path] || entry.hash !== after[entry.path]);
  const changed = actual.filter(path => !before[path] || before[path] !== after[path]);
  const inputDrift = Object.keys(before).filter(path => before[path] !== after[path]);
  const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  const record = { label, executable: process.execPath, args, env, before, after, listed, compilerPaths, actualCompilerPaths, imports, legacyPaths, actual, mismatches, changed, inputDrift, guarded: changed.length === 0 && mismatches.length === 0 && (compiler || label.startsWith('native') || label === 'raw57' || actual.includes(resolve('src/shell/runtime.ts'))), counts, run };
  records.push(record);
  patchJson(`acceptance-${label}-${short}.json`, record);
  console.log(JSON.stringify({ label, status: run.status, counts, guarded: record.guarded, actual: actual.length, changed, mismatches: mismatches.length, inputDrift }));
  if (run.status !== 0 || !record.guarded) findings(`Acceptance finding during ${label}; READY ${revision}; runtime ${runtimeHash}\nstatus ${run.status}; guard ${record.guarded}; imported drift ${JSON.stringify(changed)}; load mismatches ${JSON.stringify(mismatches)}\nPrecise stdout/stderr and hashes: tests/shell-stress/current-shell/acceptance-${label}-${short}.json\nNo source/expectation fixes attempted. Historical raw losses are not automatically new bugs.\n${stdout.slice(-18000)}`);
  assert.equal(run.timedOut || run.overflow || run.groupAlive, false, label);
  await shellReady();
  return record;
}

try {
  await shellReady();
  patchJson(`acceptance-start${attempt ? `-${attempt}` : ''}-${short}.json`, { start, readyPath, ready, revision, runtimeHash, node: process.version, frozen, sourceGuard: await sourceGuard(), attempt });
  const independent = await phase(`independent43${attempt ? `-${attempt}` : ''}`, [resolve(owned, 'run-product.mjs'), `ready-diagnostics-${short}.json`]);
  const product = JSON.parse(await readFile(resolve(owned, `ready-diagnostics-${short}.json`)));
  const perRowActualImports = product.rows.map(row => {
    const imports = independent.imports.filter(entry => entry.pid === row.process.pid);
    const mismatches = imports.filter(entry => {
      const path = relative(root, entry.path);
      return row.sourceGuard.before.files[path] !== entry.hash || row.sourceGuard.after.files[path] !== entry.hash;
    });
    return { id: row.id, pid: row.process.pid, imports, mismatches, guarded: imports.some(entry => entry.path === resolve('src/shell/runtime.ts')) && mismatches.length === 0 };
  });
  patchJson(`acceptance-per-row-imports-${short}.json`, perRowActualImports);
  if (product.rows.some(row => !row.passed) || perRowActualImports.some(row => !row.guarded)) findings(JSON.stringify({ revision, runtimeHash, summary: product.summary, failures: product.rows.filter(row => !row.passed), invalidImports: perRowActualImports.filter(row => !row.guarded) }, null, 2));
  await phase('native64', [resolve(owned, 'capture-native.mjs'), `native-ready-diagnostics-${short}.json`]);
  const original = JSON.parse(await readFile(resolve(owned, 'native-frozen.json')));
  const fresh = JSON.parse(await readFile(resolve(owned, `native-ready-diagnostics-${short}.json`)));
  const nativeComparison = fresh.profiles.map(profile => {
    const previous = original.profiles.find(item => item.role === profile.role);
    const rows = profile.results.map(row => ({ id: row.id, equal: isDeepStrictEqual(row.comparable, previous.results.find(item => item.id === row.id).comparable) }));
    return { role: profile.role, hash: profile.executableSha256, sameBinary: profile.executableSha256 === previous.executableSha256, total: rows.length, equal: rows.filter(row => row.equal).length, rows };
  });
  patchJson(`acceptance-native-comparison-${short}.json`, nativeComparison);
  const hook = ['--unhandled-rejections=strict', '--import', 'tsx', '--import', './tests/shell-stress/invocation-modes/trace.mjs', '--test', '--test-concurrency=1'];
  const legacy = await phase('legacy72', [...hook, 'tests/shell-stress/invocation-modes/holdout.test.ts']);
  patchJson(`acceptance-legacy57-input-${short}.json`, { records: [{ run: { stdout: Buffer.from(legacy.run.stdout, 'base64').toString() } }] });
  await phase('legacy132', [...hook, 'tests/shell/invocation-modes.test.ts']);
  await phase('source-eval86', [...hook, ...['source', 'source-host', 'eval', 'eval-host'].map(name => `tests/shell/source-dot-eval-${name}.test.ts`)]);
  await phase('diagnostics48', [...hook, 'tests/shell/source-dot-eval-diagnostics.test.ts']);
  await phase('prior211', [...hook, ...['discovery', 'read', 'sh'].map(name => `tests/shell/invocation-closure-${name}.test.ts`)]);
  await phase('raw57', [resolve(owned, 'acceptance-compare.mjs'), 'legacy', `acceptance-legacy57-input-${short}.json`, '../invocation-closure/post-ready-legacy-native.json', `acceptance-legacy57-comparison-${short}.json`, short]);
  for (const [name, args] of [['global', []], ['build', ['-p', 'tsconfig.build.json']], ['benchmark', ['-p', 'benchmarks/tsconfig.json']]]) await phase(name, ['node_modules/typescript/bin/tsc', ...args, '--noEmit'], true);
  for (const [path, hash] of Object.entries(frozen)) assert.equal(sha256(await readFile(path)), hash, path);
  const legacyComparison = JSON.parse(await readFile(resolve(owned, `acceptance-legacy57-comparison-${short}.json`)));
  patchJson(`acceptance-summary-${short}.json`, { start, end: new Date().toISOString(), revision, runtimeHash, ready, frozen, sourceGuard: await sourceGuard(), independent: product.summary, primaryExact: product.rows.filter(row => row.cohort === 'native-parity' && row.passed).length, historicalExact: product.rows.filter(row => row.cohort === 'native-parity' && row.historicalMatch).length, actualPerRowGuards: { total: perRowActualImports.length, valid: perRowActualImports.filter(row => row.guarded).length }, nativeComparison, legacyComparison: legacyComparison.comparisons.map(profile => ({ profile: profile.profile, passed: profile.passed, total: profile.total, losses: profile.rows.filter(row => !row.pass) })), records: records.map(({ label, counts, guarded, actual, changed, mismatches, inputDrift, run }) => ({ label, counts, guarded, actualInputs: actual.length, changed, mismatches, inputDrift, status: run.status, pid: run.pid, timedOut: run.timedOut, groupAlive: run.groupAlive })) });
} finally { await rm(temporary, { recursive: true, force: true }); }
