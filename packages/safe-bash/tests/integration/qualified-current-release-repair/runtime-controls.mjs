import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const [qualifiedDirectory, destination] = process.argv.slice(2); assert.ok(qualifiedDirectory && destination);
const input = realpathSync(qualifiedDirectory), output = resolve(destination); mkdirSync(output);
const original = JSON.parse(readFileSync(join(input, 'result.json'))); assert.equal(original.exitCode, 0);
const work = realpathSync(mkdtempSync(join(tmpdir(), 'safe-bash-release-runtime-controls-')));
const sha = value => createHash('sha256').update(value).digest('hex');
const report = { source: original.sourceCommit, originalHarnessSha256: original.harnessSha256, startedAt: new Date().toISOString(), cases: [], status: 'failed' };
function patch(path, before, after) {
  const original = readFileSync(path, 'utf8'); assert.equal(original.split(before).length, 2);
  const result = spawnSync('apply_patch', [], { encoding: 'utf8', input: `*** Begin Patch\n*** Update File: ${path}\n@@\n${before.split('\n').map(line => '-' + line).join('\n')}\n${after.split('\n').filter(Boolean).map(line => '+' + line).join('\n')}\n*** End Patch\n`, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
}
try {
  for (const mode of ['declared-sentinel', 'omitted-sentinel', 'missing-result', 'remove-before-guard', 'remove-after-guard']) {
    const directory = join(work, mode), root = join(directory, 'snapshot'); mkdirSync(directory);
    cpSync(original.root, root, { recursive: true, dereference: true, filter: path => path !== join(original.root, 'dist') && !path.includes('/.oracle/') });
    const fixture = join(root, 'tests/fs/webdav/release-timestamp-independent/independent.test.mts');
    const runner = join(root, 'scripts/verify-current-consumers.mjs');
    const originalFixture = sha(readFileSync(fixture)), originalRunner = sha(readFileSync(runner));
    const sentinel = 'RELEASE_RUNTIME_REQUIRED_SENTINEL';
    if (mode.includes('sentinel')) patch(fixture, 'import assert from "node:assert/strict";', `throw new Error("${sentinel}");\nimport assert from "node:assert/strict";`);
    if (['missing-result', 'remove-after-guard'].includes(mode)) patch(runner, '        result.runtimeResults.push({ runtime, status: execution.status, counts, scope: usesNodeTest ? "unchanged node:test assertions" : group.qualification });', '        void counts;');
    if (mode === 'remove-before-guard') patch(runner, '  validateRuntimeCoverage(consumerGroups);', '');
    if (mode === 'remove-after-guard') patch(runner, '  validateRuntimeResults(consumerGroups, report.currentConsumers.groups);', '');
    const { consumerGroups, negativeGroups } = await import(pathToFileURL(join(root, 'tests/plugins/qualified-current-release/consumers.mjs')).href);
    const selected = consumerGroups.find(group => group.name === 'webdav-timestamp-independent'); assert.ok(selected);
    consumerGroups.splice(0, consumerGroups.length, selected); negativeGroups.splice(0);
    if (['omitted-sentinel', 'remove-before-guard'].includes(mode)) selected.runtime = [];
    const { currentConsumers } = await import(pathToFileURL(runner).href);
    const { manifest } = await import(pathToFileURL(join(root, 'tests/plugins/stream-five-public/harness.mjs')).href);
    const state = { sourceCommit: original.sourceCommit, directory, root, tests: manifest(root, 'tests'), steps: [] };
    let error;
    try { currentConsumers(state); } catch (failure) { error = failure.stack; }
    const group = state.currentConsumers?.groups[0];
    const record = { mode, rejected: error !== undefined, error, beforeWork: state.steps.length === 0, source: original.sourceCommit,
      originalFixture, fixtureSha256: sha(readFileSync(fixture)), originalRunner, runnerSha256: sha(readFileSync(runner)),
      selected: group, steps: state.steps, scope: 'actual frozen runner bounded to one group; intentional test/harness mutations only in regular-file copy; other18 groups and negative types exercised unchanged separately' };
    writeFileSync(join(output, `${mode}.json`), JSON.stringify(record, null, 2));
    if (mode === 'declared-sentinel') { assert.ok(record.rejected); assert.equal(group.compile, 'pass'); assert.match(group.error, new RegExp(sentinel)); }
    if (mode === 'omitted-sentinel') { assert.ok(record.rejected); assert.equal(record.beforeWork, true); assert.match(error, /mandatory canonical runtime missing/); }
    if (mode === 'missing-result') { assert.ok(record.rejected); assert.equal(group.compile, 'pass'); assert.equal(group.error, undefined); assert.deepEqual(group.runtimeResults, []); assert.match(error, /declared runtime not executed/); }
    if (mode === 'remove-before-guard') { assert.ok(record.rejected); assert.equal(record.beforeWork, false); assert.equal(group.compile, 'pass'); }
    if (mode === 'remove-after-guard') { assert.equal(record.rejected, false); assert.equal(group.compile, 'pass'); assert.deepEqual(group.runtimeResults, []); }
    report.cases.push({ mode, rejected: record.rejected, beforeWork: record.beforeWork, guardMutationDetected: mode.startsWith('remove-'), scope: mode.startsWith('remove-') ? 'known bad harness mutation detected by missing prework/record enforcement, not consumer acceptance' : 'positive coverage guard' });
    rmSync(directory, { recursive: true });
  }
  report.status = 'passed-three-runtime-guards-and-two-guard-mutations';
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally { rmSync(work, { recursive: true, force: true }); report.cleaned = !existsSync(work); report.finishedAt = new Date().toISOString(); writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); }
