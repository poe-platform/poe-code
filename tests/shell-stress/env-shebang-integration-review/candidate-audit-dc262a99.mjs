import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../..');
const candidate = 'dc262a99da8910d082ce7051e811952639588209';
const output = resolve(owned, 'candidate-dc262a99-audit');
assert.equal(existsSync(output), false);
await mkdir(output);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['-C', root, ...args], { maxBuffer: 16 * 1024 * 1024 });
const json = name => JSON.parse(readFileSync(resolve(owned, name)));
const report = { candidate, auditedAt: new Date().toISOString() };
report.baselineAudit = JSON.parse(execFileSync(process.execPath, [resolve(owned, 'audit.mjs')]).toString());
report.replayAudit = JSON.parse(execFileSync(process.execPath, [resolve(owned, 'run-v2.mjs'), 'verify', 'candidate-dc262a99']).toString());
report.originalImmutableFiles = {};
const originalCommit = 'd5716c46';
for (const name of git(['ls-tree', '-r', '--name-only', originalCommit, relative(root, owned)]).toString().trim().split('\n')) {
  const before = git(['show', `${originalCommit}:${name}`]);
  assert.deepEqual(readFileSync(resolve(root, name)), before, name);
  report.originalImmutableFiles[name] = hash(before);
}
const changed = git(['diff', '--name-only', `${candidate}^`, candidate]).toString().trim().split('\n');
assert.deepEqual(changed, ['src/shell/runtime.ts', 'tests/shell/env-shebang-host.test.ts', 'tests/shell/env-shebang.test.ts']);
report.changedPaths = changed;
report.parent = git(['rev-parse', `${candidate}^`]).toString().trim();
report.baselineSourceDelta = git(['diff', '--name-only', '6fce94f8716f1b7a8e26af78ef8cb33594ec83cc', candidate, 'src']).toString().trim().split('\n');
report.acceptedCore = {};
for (const name of ['src/commands/execution.ts', 'src/commands/env-split.ts']) {
  const bytes = git(['show', `${candidate}:${name}`]);
  assert.deepEqual(bytes, git(['show', `6fce94f8716f1b7a8e26af78ef8cb33594ec83cc:${name}`]));
  report.acceptedCore[name] = { sha256: hash(bytes), blob: git(['rev-parse', `${candidate}:${name}`]).toString().trim(), unchangedFromBaseline: true };
}
report.runtime = { sha256: hash(git(['show', `${candidate}:src/shell/runtime.ts`])), blob: git(['rev-parse', `${candidate}:src/shell/runtime.ts`]).toString().trim() };
report.unchangedOriginalFailures = {};
for (const name of ['tests/shell-stress/env-split-author/resume-host.ts', 'tests/shell/errexit-host.test.ts', 'tests/shell/expanded-gaps-env-host.test.ts']) {
  const bytes = git(['show', `${candidate}:${name}`]);
  assert.deepEqual(bytes, git(['show', `${candidate}^:${name}`]));
  report.unchangedOriginalFailures[name] = hash(bytes);
}
const capture = json('candidate-dc262a99/report.json');
const controls = json('candidate-dc262a99-controls/report.json');
const manifest = json('candidate-dc262a99-controls/manifest.json');
for (const [name, digest] of Object.entries(manifest.files)) assert.equal(hash(readFileSync(resolve(owned, 'candidate-dc262a99-controls', name))), digest);
assert.equal(hash(readFileSync(resolve(owned, 'candidate-controls-dc262a99.mjs'))), manifest.runnerSha256);
assert.equal(hash(readFileSync(resolve(owned, 'candidate-observe-dc262a99.mjs'))), manifest.probeSha256);
assert.equal(controls.failure, undefined);
assert.equal(controls.candidate, candidate);
assert.equal(controls.cleanup.allGroupsAbsent && controls.cleanup.scratchRemoved, true);
assert.equal(existsSync(controls.scratch), false);
assert.equal(existsSync(capture.cleanup.scratch), false);
const nested = capture.records.find(row => row.id === 'h06');
assert.equal(nested.passed, true);
assert.deepEqual(nested.product.parsed.observations.map(row => row.command), ['./script', './inner', 'printf']);
assert.equal(nested.product.parsed.error.limit, 'maxOutputBytes');
report.qualified = { raw: capture.counts, nestedOutputWitness: nested.product.parsed.observations, qualifiedPasses: 27, failedIds: capture.records.filter(row => !row.passed).map(row => row.id), strictLosses: capture.records.filter(row => !row.oracle.unavailable && !row.strictNative).map(row => ({ id: row.id, fields: row.nativeFields })), productModuleLoads: capture.records.reduce((count, row) => count + row.product.parsed.loads.length, 0), deniedHostAttempts: capture.records.flatMap(row => row.product.parsed.attempts).length };
assert.deepEqual(report.qualified.failedIds, ['s20', 'h04', 'h05']);
report.controlCounts = {};
for (const [name, result] of Object.entries(controls.controls)) {
  const tap = Buffer.from(result.stdout, 'base64').toString();
  report.controlCounts[name] = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(label => [label, Number(new RegExp(`^# ${label} (\\d+)$`, 'mu').exec(tap)?.[1])]));
}
assert.deepEqual(Object.values(report.controlCounts).map(count => [count.tests, count.pass, count.fail]), [[29, 29, 0], [126, 125, 1], [210, 203, 7]]);
report.cleanup = { frozenGroups: capture.cleanup.groups.length, scopedGroups: controls.cleanup.groups.length, allAbsentAtSettlement: true, scratchRootsRemoved: [capture.cleanup.scratch, controls.scratch], additionalNativeRecursiveTimeout: controls.native.filter(row => row.timeout).map(row => row.id) };
report.markers = {};
for (const name of ['/tmp/safe-bash-env-shebang-author-candidate.txt', '/tmp/safe-bash-env-shebang-author-write-approved.txt', '/tmp/safe-bash-env-shebang-inspection-result.txt']) {
  const bytes = readFileSync(name);
  report.markers[name] = { sha256: hash(bytes), content: bytes.toString() };
}
const diff = git(['diff', `${candidate}^`, candidate, '--', 'src/shell/runtime.ts']);
await writeFile(resolve(output, 'source-scope.patch'), diff, { flag: 'wx' });
report.diffSha256 = hash(diff);
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), files: { 'source-scope.patch': hash(diff), 'report.json': hash(readFileSync(resolve(output, 'report.json'))) } }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ raw: report.qualified.raw.passed, qualified: report.qualified.qualifiedPasses, controls: report.controlCounts, runtimeSha256: report.runtime.sha256, cleanup: report.cleanup }));
