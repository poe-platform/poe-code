import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../..');
const candidate = 'ea409a6b49d5c1523e3238f0384048218b559c4c';
const name = 'guarded-ea409a6b-20260827-review1';
const output = resolve(owned, `${name}-audit`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['-C', root, ...args], { maxBuffer: 64 * 1024 * 1024 });
const read = path => readFileSync(resolve(owned, path));
const json = path => JSON.parse(read(path));
const committed = path => git(['show', `${candidate}:${path}`]);
const counts = result => {
  const tap = Buffer.from(result.stdout, 'base64').toString();
  return Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(label => [label, Number(new RegExp(`^# ${label} (\\d+)$`, 'mu').exec(tap)?.[1])]));
};
const absent = (pid, group = true) => {
  try { process.kill(group ? -pid : pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
};
assert.equal(existsSync(output), false, 'new audit evidence only');
const report = { schema: 'guarded-review-audit-v1', candidate, auditedAt: new Date().toISOString() };
report.markers = {};
for (const path of ['/tmp/safe-bash-env-shebang-guarded-authorization.txt', '/tmp/safe-bash-env-shebang-gap-design-result.txt', '/tmp/safe-bash-env-shebang-guarded-candidate.txt']) {
  const bytes = readFileSync(path);
  report.markers[path] = { sha256: hash(bytes), content: bytes.toString() };
}
assert.equal(report.markers['/tmp/safe-bash-env-shebang-guarded-candidate.txt'].content.match(/Source\/regressions commit: ([a-f0-9]{40})/u)?.[1], candidate);
assert.equal(git(['rev-parse', candidate + '^{commit}']).toString().trim(), candidate);
report.parent = git(['rev-parse', candidate + '^']).toString().trim();
report.changedPaths = git(['diff', '--name-only', report.parent, candidate]).toString().trim().split('\n');
assert.deepEqual(report.changedPaths, ['src/shell/runtime.ts', 'tests/shell/env-shebang-host.test.ts', 'tests/shell/env-shebang.test.ts']);
report.runtime = { sha256: hash(committed('src/shell/runtime.ts')), blob: git(['rev-parse', `${candidate}:src/shell/runtime.ts`]).toString().trim() };
assert.equal(report.runtime.sha256, '4e937b71df3135d1262a616924b4173e982f236dd86415e0e75895eac9c85e06');
const before = ts.createSourceFile('runtime.ts', git(['show', `${report.parent}:src/shell/runtime.ts`]).toString(), ts.ScriptTarget.Latest, true);
const after = ts.createSourceFile('runtime.ts', committed('src/shell/runtime.ts').toString(), ts.ScriptTarget.Latest, true);
const runtimeClass = source => source.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === 'Runtime');
const members = source => Object.fromEntries(runtimeClass(source).members.map(member => [member.name?.getText(source) ?? 'constructor', member.getText(source)]));
const oldMembers = members(before), newMembers = members(after);
report.changedRuntimeMembers = Object.keys(newMembers).filter(member => oldMembers[member] !== newMembers[member]);
assert.deepEqual(report.changedRuntimeMembers.sort(), ['envShebang', 'shebangStage', 'shebangState', 'shebangTarget']);
assert.deepEqual(Object.keys(oldMembers).filter(member => !(member in newMembers)), []);
report.unchangedRuntimeMembers = Object.keys(oldMembers).filter(member => oldMembers[member] === newMembers[member]);
const top = source => source.statements.filter(statement => statement !== runtimeClass(source)).map(statement => statement.getText(source));
assert.deepEqual(top(after), top(before).map(text => text.replace('ByteSink, ByteSource, CommandContext, CommandRegistry, FileSystem, Middleware,', 'ByteSink, ByteSource, CommandContext, CommandInvoker, CommandRegistry, CommandResult, FileSystem, Middleware,')));
report.memberLines = Object.fromEntries(runtimeClass(after).members.filter(member => ['envShebang', 'shebangStage', 'shebangState', 'shebangTarget', 'interpreter', 'scriptFile', 'invoke', 'invokeScoped'].includes(member.name?.getText(after))).map(member => [member.name.getText(after), after.getLineAndCharacterOfPosition(member.getStart(after)).line + 1]));
report.acceptedCore = {};
for (const path of ['src/commands/execution.ts', 'src/commands/env-split.ts']) {
  const bytes = committed(path);
  assert.deepEqual(bytes, git(['show', `6fce94f8716f1b7a8e26af78ef8cb33594ec83cc:${path}`]));
  report.acceptedCore[path] = hash(bytes);
}
report.interveningSourcePathsSinceDc262a99 = git(['diff', '--name-only', 'dc262a99da8910d082ce7051e811952639588209', candidate, '--', 'src']).toString().trim().split('\n');
report.originalReviewFiles = {};
for (const path of git(['ls-tree', '-r', '--name-only', candidate, relative(root, owned)]).toString().trim().split('\n')) {
  const bytes = committed(path);
  assert.deepEqual(readFileSync(resolve(root, path)), bytes, path);
  report.originalReviewFiles[path] = hash(bytes);
}
report.baselineAudit = JSON.parse(execFileSync(process.execPath, [resolve(owned, 'audit.mjs')]).toString());
report.originalCandidateAudit = JSON.parse(execFileSync(process.execPath, [resolve(owned, 'run-v2.mjs'), 'verify', 'candidate-dc262a99']).toString());
report.frozenAudit = JSON.parse(execFileSync(process.execPath, [resolve(owned, 'run-v2.mjs'), 'verify', name]).toString());
const capture = json(`${name}/report.json`);
assert.equal(capture.sourceCommit, candidate);
assert.equal(capture.source['src/shell/runtime.ts'].sha256, report.runtime.sha256);
assert.equal(capture.counts.passed, 30);
assert.equal(capture.counts.strictNative, 17);
assert.equal(capture.counts.nativeAvailable, 23);
const nested = capture.records.find(row => row.id === 'h06').product.parsed;
assert.deepEqual(nested.observations.map(row => row.command), ['./script', 'env', 'bash', './inner', 'env', 'bash', 'printf']);
assert.equal(nested.error.limit, 'maxOutputBytes');
report.qualification = { raw: 30, qualified: 30, nestedWitness: nested.observations.map(row => row.command), strictLosses: capture.records.filter(row => !row.oracle.unavailable && !row.strictNative).map(row => ({ id: row.id, fields: row.nativeFields })), sourceInputs: Object.keys(capture.source).length, productModuleLoads: capture.records.reduce((count, row) => count + row.product.parsed.loads.length, 0), deniedHostAttempts: capture.records.flatMap(row => row.product.parsed.attempts).length, kernelAttempts: capture.records.filter(row => row.kernel && !row.kernel.unavailable).length };
report.controls = {};
const controlReports = [];
for (const [suffix, runner] of [['-controls', 'guarded-controls-ea409a6b-v1.mjs'], ['-public-controls', 'guarded-public-controls-ea409a6b-v1.mjs']]) {
  const control = json(`${name}${suffix}/report.json`);
  const manifest = json(`${name}${suffix}/manifest.json`);
  for (const [path, digest] of Object.entries(manifest.files)) assert.equal(hash(read(`${name}${suffix}/${path}`)), digest, path);
  assert.equal(hash(read(runner)), manifest.runnerSha256);
  assert.equal(hash(read('guarded-observe-ea409a6b-v1.mjs')), manifest.probeSha256);
  assert.equal(control.failure, undefined);
  assert.equal(control.candidate, candidate);
  assert.equal(control.inputs['src/shell/runtime.ts'].sha256, report.runtime.sha256);
  assert.equal(Object.values(control.guards).every(Boolean), true);
  for (const [label, result] of Object.entries(control.controls)) {
    report.controls[label] = counts(result);
    assert.equal(result.timeout || result.overflow, false);
    assert.equal(report.controls[label].cancelled + report.controls[label].skipped + report.controls[label].todo, 0);
  }
  controlReports.push(control);
}
assert.deepEqual(Object.values(report.controls).map(count => [count.tests, count.pass, count.fail]), [[48, 47, 1], [126, 125, 1], [210, 203, 7], [115, 115, 0], [10, 10, 0]]);
const authorTap = Buffer.from(controlReports[0].controls.author.stdout, 'base64').toString();
report.guardedAuthorPasses = [...authorTap.matchAll(/^ok \d+ - guarded completion[: ]/gmu)].length;
assert.equal(report.guardedAuthorPasses, 19);
report.originalAssertionInputs = {};
for (const path of ['tests/shell-stress/env-split-author/resume-host.ts', 'tests/shell/errexit-host.test.ts', 'tests/shell/expanded-gaps-env-host.test.ts']) {
  assert.deepEqual(committed(path), git(['show', `dc262a99da8910d082ce7051e811952639588209:${path}`]));
  report.originalAssertionInputs[path] = hash(committed(path));
}
const originals = json(`${name}-controls/original-assertion-observations.json`).originals;
const oldOriginals = json('candidate-dc262a99-controls/original-assertion-observations.json').originals;
for (const [index, variant] of originals.entries()) {
  const input = ({ observed, disposed, ...rest }) => rest;
  assert.deepEqual(input(variant), input(oldOriginals[index]));
  assert.equal(variant.disposed && variant.observed.scriptUnchanged, true);
  assert.deepEqual(variant.observed.entries, ['script']);
}
assert.equal(originals.find(variant => variant.optional === null).observed.error.limit, 'maxSubstitutionDepth');
const publicTap = Buffer.from(controlReports[1].controls.publicLifecycle.stdout, 'base64').toString();
const publicProofs = publicTap.split('\n').filter(line => line.startsWith('# {"scenario"')).map(line => JSON.parse(line.slice(2).replaceAll('\\\\', '\\')));
assert.equal(publicProofs.length, 10);
report.publicChildren = publicProofs.map(proof => {
  const result = JSON.parse(proof.stdout);
  assert.equal(result.runtimeCommit, candidate);
  assert.equal(result.passed && result.sourcePinned, true);
  assert.equal(result.liveWorkers, 0);
  assert.deepEqual(result.unhandled, []);
  return { pid: proof.pid, absent: absent(proof.pid, false), scenario: proof.scenario, workers: result.workers.length, liveWorkers: result.liveWorkers };
});
assert.equal(report.publicChildren.every(child => child.absent), true);
report.cleanup = [capture, ...controlReports].map(record => {
  const scratch = record.cleanup.scratch ?? record.scratch;
  const groups = record.cleanup.groups.map(group => ({ pid: group.pid, absent: absent(group.pid) }));
  assert.equal(record.cleanup.allGroupsAbsent && record.cleanup.scratchRemoved, true);
  assert.equal(existsSync(scratch), false);
  assert.equal(groups.every(group => group.absent), true);
  return { scratch, scratchAbsent: true, groups };
});
report.nestedSnapshotCleanup = controlReports[1].nestedSnapshotCleanup;
for (const record of report.nestedSnapshotCleanup) assert.equal(existsSync(record.snapshot), false);
report.supplementaryNativeTimeouts = controlReports[0].native.filter(row => row.timeout).map(row => row.id);
assert.deepEqual(report.supplementaryNativeTimeouts, ['expanded-4']);
report.integrityLimits = { frozenSourcePostcheck: 'original regular paths only; no appended source/empty-directory/symlink census', controlsPostcheck: 'regular-file paths and hashes including new regular files; not new empty directories or symlinks', publicSnapshotPostcheck: 'source/dist recursive census rejects symlinks; does not census empty directories' };
const diff = git(['diff', report.parent, candidate, '--', 'src/shell/runtime.ts']);
report.diffSha256 = hash(diff);
await mkdir(output);
await writeFile(resolve(output, 'source-scope.patch'), diff, { flag: 'wx' });
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), files: { 'source-scope.patch': hash(diff), 'report.json': hash(readFileSync(resolve(output, 'report.json'))) } }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidate, qualified: report.qualification, controls: report.controls, guarded: report.guardedAuthorPasses, ownedGroupsAbsent: report.cleanup.map(record => record.groups.length), publicChildrenAbsent: report.publicChildren.length }));
