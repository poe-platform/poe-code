import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '../../..');
const revision = 'eaed12f88365e69597994c4f2e6324a020202b66';
const executable = '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
const executableHash = '4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0';
const output = resolve(process.argv[2] ?? ''); assert.ok(process.argv[2]); assert.equal(existsSync(output), false); mkdirSync(output, { recursive: true });
const temporary = realpathSync(mkdtempSync('/tmp/shared-stdin-diagnosis-')), candidate = join(temporary, 'candidate'); mkdirSync(candidate);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const environment = { ...process.env, PATH: `${dirname(executable)}:/usr/bin:/bin`, HOME: temporary, TMPDIR: temporary, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', TSX_DISABLE_CACHE: '1', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
delete environment.NODE_OPTIONS; delete environment.NODE_PATH; delete environment.NODE_TEST_CONTEXT; delete environment.SAFEJS_LOCAL_ROOT;
const git = args => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repository, env: environment, timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
const report = { revision, startedAt: new Date().toISOString(), executable, executableHash, source: {}, tools: {}, commands: [], privateAccess: false, productEdits: false, wholeGate: false, pendingLiveColumnChangesExcluded: true, harness: {} };
for (const file of ['run.mjs', 'probe.mjs']) report.harness[file] = hash(readFileSync(join(here, file)));
function inventory(directory) {
  const entries = {};
  function visit(current) { for (const name of readdirSync(current).sort()) { const path = join(current, name), key = relative(directory, path), stat = lstatSync(path); assert.equal(stat.isSymbolicLink(), false, path); if (stat.isDirectory()) { entries[key + '/'] = { type: 'directory' }; visit(path); } else { assert.ok(stat.isFile(), path); entries[key] = { sha256: hash(readFileSync(path)), mode: stat.mode & 0o777 }; } } }
  visit(directory); return entries;
}
function child(label, args, timeout = 60000, extra = {}) {
  const result = spawnSync(executable, args, { cwd: candidate, env: environment, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, ...extra });
  const receipt = { label, executable, args, status: result.status, signal: result.signal, error: result.error?.message ?? null };
  write(join(output, `${label}.stdout.txt`), result.stdout ?? ''); write(join(output, `${label}.stderr.txt`), result.stderr ?? ''); report.commands.push(receipt);
  assert.equal(result.signal, null, label); assert.equal(result.error, undefined, label); return result;
}
try {
  assert.equal(hash(readFileSync(executable)), executableHash);
  const files = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'AGENTS.md', 'docs/OUTPUT_LIFECYCLE_REVIEW.md', 'tests/shell/helpers.ts', 'tests/shell/lifecycle.test.ts', 'tests/shell/lifecycle-probe.ts', 'tests/shell/invocation-cleanup.test.ts', 'tests/shell/invocation-cleanup-pipeline.test.ts', 'tests/contracts/io.test.ts', 'tests/contracts/io.stress.test.ts', 'tests/commands/grep-aliases-stress/verification/ROOT-BLOCKER.md', 'tests/commands/column-stress/handoff-20260827/root-hidden-return-repro.mjs', 'tests/commands/column-stress/handoff-20260827/REPORT.md'];
  const tar = join(temporary, 'source.tar'); git(['archive', '-o', tar, revision, ...files]); execFileSync('/usr/bin/tar', ['-xf', tar, '-C', candidate]);
  report.source = inventory(candidate); write(join(output, 'SOURCE.json'), JSON.stringify(report.source, null, 2) + '\n');
  const old = JSON.parse(git(['show', '0579a239:tests/integration/full-gate-20260827/loader-null-source-review-node24-bodies/attempt-1/RESULT.json']));
  for (const [path, pin] of Object.entries(old.tools)) { const bytes = readFileSync(join(repository, 'node_modules', path)); assert.equal(hash(bytes), pin.sha256, path); const destination = join(candidate, 'node_modules', path); write(destination, bytes); chmodSync(destination, pin.mode); report.tools[path] = pin; }
  const build = child('build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']); assert.equal(build.status, 0, build.stderr + build.stdout);
  const built = inventory(candidate); write(join(output, 'BUILT.json'), JSON.stringify(built, null, 2) + '\n');
  const probe = join(temporary, 'probe.mjs'); write(probe, readFileSync(join(here, 'probe.mjs')));
  const guard = join(temporary, 'guard.mjs'), imports = join(output, 'IMPORTS.ndjson');
  write(guard, `import{registerHooks}from'node:module';import{appendFileSync,readFileSync,realpathSync}from'node:fs';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';const root=${JSON.stringify(candidate + '/dist/')},entry=${JSON.stringify(probe)},log=${JSON.stringify(imports)};registerHooks({load(url,context,next){if(url.startsWith('file:')){const path=realpathSync(fileURLToPath(url));if(path!==entry&&!path.startsWith(root))throw new Error('REVIEW_SOURCE_FALLBACK:'+path);appendFileSync(log,JSON.stringify({pid:process.pid,execPath:process.execPath,path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})+'\\n');}return next(url,context);}});\n`);
  const diagnosis = child('diagnosis', ['--unhandled-rejections=strict', '--import', guard, probe, candidate, join(output, 'CASES.json')]); report.diagnosisStatus = diagnosis.status;
  if (existsSync(join(output, 'CASES.json'))) report.caseCounts = JSON.parse(readFileSync(join(output, 'CASES.json'))).counts;
  const originalColumn = child('original-column-repro', ['tests/commands/column-stress/handoff-20260827/root-hidden-return-repro.mjs', candidate, join(output, 'ORIGINAL-COLUMN.json')]);
  report.originalColumn = { status: originalColumn.status, result: JSON.parse(readFileSync(join(output, 'ORIGINAL-COLUMN.json'))) };
  assert.equal(originalColumn.status, 1); assert.equal(report.originalColumn.result.acceptance, 'HOLD');
  const unchanged = child('unchanged-contract-tests', ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', 'tests/contracts/io.test.ts', 'tests/contracts/io.stress.test.ts', 'tests/shell/invocation-cleanup.test.ts', 'tests/shell/invocation-cleanup-pipeline.test.ts', 'tests/shell/lifecycle.test.ts']);
  report.unchangedStatus = unchanged.status;
  report.unchangedCounts = Object.fromEntries([...unchanged.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  assert.deepEqual(report.unchangedCounts, { tests: 63, pass: 63, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  const after = inventory(candidate); assert.deepEqual(after, built); report.candidateInventoryUnchangedIncludingNewEntries = true;
  write(join(output, 'AFTER.json'), JSON.stringify(after, null, 2) + '\n');
  const receipts = readFileSync(imports, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  for (const receipt of receipts) { assert.equal(receipt.execPath, executable); if (receipt.path === probe) assert.equal(receipt.sha256, report.harness['probe.mjs']); else { assert.ok(receipt.path.startsWith(candidate + '/dist/')); assert.equal(receipt.sha256, built[relative(candidate, receipt.path)].sha256); } }
  report.loadedModuleReceipts = receipts.length;
  assert.equal(diagnosis.status, 0, 'Unexpected diagnostic assertion/error; inspect preserved output');
  assert.equal(unchanged.status, 0, 'Unchanged scope failed; preserve result, do not rebaseline');
} catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary); report.finishedAt = new Date().toISOString(); write(join(output, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ counts: report.caseCounts, unchanged: report.unchangedCounts, error: report.error, cleaned: report.cleaned }));
