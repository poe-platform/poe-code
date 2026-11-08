import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, prepared } from '../binding.mjs';

const owned = fileURLToPath(new URL('.', import.meta.url));
const read = async name => JSON.parse(await readFile(resolve(owned, name)));
const failure = await read('result.json');
const result = await read('setup-recovery-result.json');
assert.equal(hash(await readFile(resolve(owned, 'result.json'))), 'db3a8c49ea2c44460638a9e45453b0b62de44c9fb6a87046dd70258d8599eded');
assert.equal(hash(await readFile(resolve(owned, 'setup-failure-run.mjs.txt'))), failure.identities.runner.find(entry => entry.path === 'run.mjs').sha256);
assert.equal(failure.run.readyMs, undefined);
assert.equal(failure.run.ipcBytes, 0);
assert.equal(result.pass, true);
assert.equal(result.postRunIdentityRecheck, true);
for (const record of [failure, result]) {
  assert.equal(record.activeChildren, 0);
  assert.equal(record.run.closeAwaited, true);
  assert.equal(record.run.killed, false);
  for (const event of ['disconnect', 'stdout-close', 'stderr-close']) assert.ok(record.run.events.includes(event));
}
for (const entry of result.identities.runner) assert.equal(hash(await readFile(resolve(owned, entry.path))), entry.sha256);
const preparation = await prepared();
for (const name of ['benchmark.mjs', 'observe.mjs']) {
  assert.equal(hash(await readFile(resolve(owned, '.temporary/compiled', name))), preparation.emitted.find(entry => entry.path === `.temporary/compiled/${name}`).sha256);
}
const expected = Array.from({ length: 32 }, (unused, index) => index)
  .filter(index => index < 10 || index === 12 || index >= 30)
  .map(index => `./file${String(index).padStart(2, '0')}.txt:hit ${String(index).padStart(2, '0')}\n`).join('');
const commands = result.run.result.pairs.flatMap(pair => pair.order.map(variant => ({ variant, record: pair[variant] })));
assert.equal(commands.length, 6);
for (const { record } of commands) {
  assert.equal(record.output.exitCode, 0);
  assert.equal(Buffer.from(record.output.stdout, 'base64').toString(), expected);
  assert.equal(record.output.stderr, '');
  assert.equal(record.afterDispose.length, 1);
  for (const boundary of [record.publicSettlement, record.afterDispose]) for (const worker of boundary) {
    assert.equal(worker.exited, true);
    assert.equal(worker.terminationCalls, 1);
    assert.equal(worker.terminationAwaited, true);
    assert.ok(Object.values(worker.listeners).every(count => count === 0));
  }
}
for (const interval of result.run.result.intervals) {
  assert.equal(interval.publicSettlement.length, 1);
  assert.equal(interval.publicSettlement[0].exited, true);
  assert.equal(interval.publicSettlement[0].terminationAwaited, true);
  assert.ok(Object.values(interval.publicSettlement[0].listeners).every(count => count === 0));
}
const pids = [failure.run.pid, result.run.pid];
const check = spawnSync('/bin/ps', ['-p', pids.join(','), '-o', 'pid=,ppid=,command='], { encoding: 'utf8' });
assert.equal(check.status, 1);
assert.equal(check.stdout, '');
assert.equal(check.stderr, '');
const files = ['claim.json', 'identities.json', 'result.json', 'setup-failure-run.mjs.txt', 'setup-recovery-claim.json', 'setup-recovery-identities.json', 'setup-recovery-result.json', 'run.mjs', 'intervals.mjs', 'package.json', 'audit.mjs'];
const audit = {
  authority: 'BENIGN_BENCHMARK_ONLY_NOT_DEFAULT_ACCEPTANCE', time: new Date().toISOString(),
  pass: true, benchmarkRerun: false, setupOnlyFailuresPreserved: 1,
  commands: 6, alternatingPairs: 3, filesPerCommand: 32, outputLinesPerCommand: 13,
  outputBytesPerCommand: Buffer.byteLength(expected), stdoutSha256: hash(expected), exitCode: 0, stderrBytes: 0,
  candidatePublicSettlement: '3/3 native workers exited, terminated exactly once and awaited; zero observed worker listeners at the actual public promise settlement',
  baselinePublicSettlement: 'Observed clean in this fixture; not retroactively required by the benchmark gate',
  postDispose: '6/6 native workers exited, terminated exactly once and awaited; zero observed worker listeners',
  listenerScope: 'Native Worker message/messageerror/error/exit listeners only; no claim of independent caller/context abort-listener instrumentation in this cohort',
  exactChildren: { pids, status: check.status, stdout: check.stdout, stderr: check.stderr, closeAwaited: true, active: 0 },
  originalPrepared: '7/8 unrebaselined; original ordinary-Error oracle failure remains preserved',
  riskyJobs: 'four LOCKED; six additional UNUSED', riskConsumed: 0, defaultAcceptance: false,
  files: await Promise.all(files.map(async path => ({ path, sha256: hash(await readFile(resolve(owned, path))) }))),
};
await writeFile(resolve(owned, 'audit.json'), JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ pass: true, commands: commands.length, activeChildren: 0, outputBytes: audit.outputBytesPerCommand, riskConsumed: 0 }));
