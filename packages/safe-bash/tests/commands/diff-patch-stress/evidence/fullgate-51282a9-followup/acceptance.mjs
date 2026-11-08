import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { command, directory, hash, save, sourceState } from './capture.mjs';

const startedAt = new Date().toISOString();
const archive = '/private/tmp/safe-bash-diff-revised-full-T6lPmg';
const frozen = `${archive}/snapshot-1`;
const snapshot = resolve(directory, '.acceptance');
const originalArchive = '/tmp/safe-bash-diff-rmdir-final-PRIFIp';
const manifest = JSON.parse(readFileSync('tests/commands/diff-patch-stress/gnu-revised-full/manifest.json', 'utf8'));
const inventory = JSON.parse(readFileSync(`${archive}/inputs-revised.json`, 'utf8'));
const before = sourceState();
const files = {};
const tests = Object.keys(inventory).filter(path => /^tests\/commands\/(?:diff-patch|diff-patch-stress)\//u.test(path));
const benchmarkFiles = Object.keys(inventory).filter(path => path.startsWith('benchmarks/'));
for (const path of [...tests, ...benchmarkFiles]) {
  const bytes = readFileSync(`${frozen}/${path}`);
  assert.equal(hash(bytes), inventory[path].sha256, `frozen revised input: ${path}`);
  files[path] = bytes;
}
assert.deepEqual(tests.filter(path => path.endsWith('.test.ts')).sort(), Object.keys(manifest.original70).sort());
function collect(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) collect(child);
    else { assert(entry.isFile()); files[child] = readFileSync(child); }
  }
}
collect('src');
for (const path of ['package.json', 'tsconfig.json']) files[path] = readFileSync(path);
files['acceptance-guard.mjs'] = readFileSync(`${directory}/acceptance-guard.mjs`);
for (const [path, bytes] of Object.entries(files)) {
  const text = bytes.toString();
  assert(Buffer.from(text).equals(bytes), `UTF-8 snapshot input: ${path}`);
  assert(text === '' || text.endsWith('\n'), `newline-preserving patch copy: ${path}`);
  const body = text === '' ? '' : text.slice(0, -1).split('\n').map(line => '+' + line).join('\n') + '\n';
  const patch = `*** Begin Patch\n*** Add File: ${snapshot}/${path}\n${body}*** End Patch\n`;
  const applied = spawnSync('apply_patch', [], { input: patch, encoding: 'utf8' });
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(hash(readFileSync(`${snapshot}/${path}`)), hash(bytes), path);
}
const copied = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, hash(bytes)]));
const historical = JSON.parse(readFileSync('tests/commands/diff-patch-stress/gnu-revised-full/result.json', 'utf8'));
const env = { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', TMPDIR: snapshot, FOLLOWUP_TOOLING: resolve('node_modules') };
for (const key of Object.keys(env)) if (/^(?:NODE_OPTIONS|NODE_PATH|TSX_|TS_NODE_|DIFF_PATCH_|PARSER_EVIDENCE$|CANDIDATE_EVIDENCE$|CHECKPOINT_|ESBUILD_BINARY_PATH$)/u.test(key)) delete env[key];
save(`${directory}/acceptance-qualified-inputs.json`, { startedAt, before, archive, snapshot, copied, groups: manifest.groups,
  original3758: manifest.original3758, historicalRevised3758: historical.revised3758,
  qualification: 'Unchanged revised-3758 test/helper bytes from historical frozen snapshot; current source copied once. No delta reapplied and no current canonical corrections substituted. Existing tooling shared read-only; import guard permits only snapshot and tooling. Not a replay of historical full runner/build/probes or original eight conflicts.' });
const results = [];
const census = events => events.filter(event => event.type === 'test:pass' || event.type === 'test:fail').map(event => ({ name: event.data.name, nesting: event.data.nesting, type: event.data.details.type })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
for (const [name, paths] of Object.entries(manifest.groups)) {
  const result = command(process.execPath, ['--unhandled-rejections=strict', '--import', './acceptance-guard.mjs', '--import', 'tsx', '--test', '--test-concurrency=1',
    '--test-reporter=tap', '--test-reporter-destination=stderr',
    '--test-reporter=./tests/commands/diff-patch-stress/gnu-followup-checkpoint/reporter.mjs', '--test-reporter-destination=stdout', ...paths], { cwd: snapshot, env, timeout: 300_000 });
  const events = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const counts = events.findLast(event => event.type === 'test:summary' && event.data.file === undefined)?.data.counts;
  const originalEvents = readFileSync(`${originalArchive}/${name}.events.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const censusMatches = JSON.stringify(census(events)) === JSON.stringify(census(originalEvents));
  save(`${directory}/acceptance-qualified-${name}.json`, { name, paths, result, counts, censusMatches, failures: events.filter(event => event.type === 'test:fail') });
  results.push({ name, status: result.status, signal: result.signal, counts, censusMatches });
  console.log(name, result.status, counts);
}
for (const [path, sha256] of Object.entries(copied)) assert.equal(hash(readFileSync(`${snapshot}/${path}`)), sha256, `snapshot changed: ${path}`);
const totals = Object.fromEntries(['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo'].map(key => [key, results.reduce((sum, result) => sum + (result.counts?.[key] ?? 0), 0)]));
save(`${directory}/acceptance-result.json`, { startedAt, finishedAt: new Date().toISOString(), before, after: sourceState(), results, totals, snapshotInputsUnchanged: true,
  original3758: manifest.original3758, literalOriginalRerun: false, currentCanonical124Separate: true });
console.log('TOTAL', totals);
if (totals.tests !== 3758 || results.some(result => result.status !== 0 || !result.censusMatches)) process.exitCode = 1;
