import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { digest, fixture, git, json, npmCli, owned, policy } from './common.mjs';

const directory = process.argv[2];
assert.ok(directory?.startsWith('/private/tmp/native-data-tap-independent-'), 'explicit original independent capture directory');
const prepared = JSON.parse(readFileSync(join(owned, 'preexecution.json')));
const reportBytes = readFileSync(join(directory, 'REPORT.json')), originalReport = JSON.parse(reportBytes);
const audit = { candidate: policy.candidate, auditedAt: new Date().toISOString(), originalReportSha256: digest(reportBytes), originalHarnessStatus: originalReport.status,
  correction: 'Original harness wrongly required the coordinator reporter flag in startup execArgv; Node test workers do not retain that flag. No execution repeated, no canonical assertion changed. Audit actual forwarded spawn argv, captured npm script bytes/output and every startup identity from the original immutable receipts instead.',
  executionRepeated: false, canonicalAssertionsChanged: false, checks: [], rows: [] };
const check = (name, callback) => { callback(); audit.checks.push(name); };
assert.equal(originalReport.candidate, policy.candidate);
assert.equal(originalReport.status, 'fail');
const falseChecks = originalReport.checks.filter(entry => !entry.pass);
assert.equal(falseChecks.length, 5);
for (const entry of falseChecks) assert.ok(entry.error.includes("assert.ok(starts.some(event => event.execArgv.includes('--test-reporter=tap')))"));
assert.equal(originalReport.errors.length, falseChecks.length);
assert.equal(originalReport.rows.length, 5);
const snapshotsAcrossRows = [];
const originalFixture = git('show', `${policy.candidate}:${fixture}`).toString();
for (const summary of originalReport.rows) {
  const bytes = readFileSync(join(directory, `${summary.name}.json.gz`)), receipt = JSON.parse(gunzipSync(bytes)), result = receipt.result;
  const starts = result.events.filter(event => event.event === 'start');
  const npmStarts = starts.filter(event => event.argv.includes(npmCli));
  const forwarded = result.events.filter(event => event.event === 'spawn-before' && event.command === summary.executable && event.args.includes('--test'));
  const npmBefore = result.events.filter(event => event.event === 'spawn-before' && event.command === 'npm');
  const npmAfter = result.events.filter(event => event.event === 'spawn-after' && event.command === 'npm').map(event => ({ ...event, stdout: Buffer.from(event.stdoutBase64, 'base64').toString(), stderr: Buffer.from(event.stderrBase64, 'base64').toString() }));
  const stdout = Buffer.from(result.stdoutBase64, 'base64').toString();
  const stderr = Buffer.from(result.stderrBase64, 'base64').toString();
  const removal = summary.name === 'remove-current-tap-node24', canonical = summary.name.startsWith('candidate-');
  const tool = prepared.runtimeVersions.find(entry => entry.path === summary.executable);
  check(`${summary.name}: original realpath/version and every startup authenticated`, () => {
    assert.equal(result.realpath, tool.realpath); assert.ok(starts.length > 5);
    for (const start of starts) { assert.equal(start.executable, tool.realpath); assert.equal(start.version, tool.version); assert.equal(start.nodeOptions, result.env.NODE_OPTIONS); }
    assert.equal(npmStarts.length, removal ? 1 : 2);
    assert.ok(starts.some(event => event.argv.includes(join(result.cwd, fixture))));
    if (canonical) assert.ok(starts.some(event => event.argv.includes(join(result.cwd, 'node_modules/typescript/bin/tsc'))));
    assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0].args.includes('--test-reporter=tap'), !removal);
    if (!removal) assert.ok(forwarded[0].args.indexOf('--test-reporter=tap') < forwarded[0].args.findIndex(arg => arg.endsWith('.test.ts')));
    assert.doesNotMatch(result.env.NODE_OPTIONS, /reporter/u);
    assert.equal(result.env.npm_config_userconfig === result.env.npm_config_globalconfig, false);
  });
  check(`${summary.name}: actual argv and exact synthetic input bytes retained`, () => {
    assert.equal(npmBefore.length, removal ? 1 : 2); assert.equal(npmAfter.length, npmBefore.length);
    assert.deepEqual(npmBefore[0].args, removal ? ['test'] : ['test', '--', '--test-reporter=tap']);
    for (const entry of npmBefore) {
      const fixtures = entry.fixtureInputs.filter(input => input.path.endsWith('.ts'));
      assert.equal(fixtures.length, 8);
      for (const input of fixtures) { const raw = Buffer.from(input.base64, 'base64'); assert.equal(digest(raw), input.sha256); assert.equal(raw.length, input.bytes); }
      snapshotsAcrossRows.push(fixtures);
    }
    const currentPackage = JSON.parse(Buffer.from(npmBefore[0].fixtureInputs.find(entry => entry.path === 'package.json').base64, 'base64'));
    assert.deepEqual(currentPackage, JSON.parse(git('show', `${policy.candidate}:package.json`)));
    if (!removal) {
      const historicalPackage = JSON.parse(Buffer.from(npmBefore[1].fixtureInputs.find(entry => entry.path === 'package.json').base64, 'base64'));
      let script = prepared.scripts.historicalTest.replace('--test ', '--test --test-reporter=tap ');
      if (summary.name === 'historical-tap-after-glob-node24') script = prepared.scripts.historicalTest + ' --test-reporter=tap';
      if (summary.name === 'historical-forced-spec-node24') script = prepared.scripts.historicalTest.replace('--test ', '--test --test-reporter=spec ');
      assert.deepEqual(historicalPackage, { ...currentPackage, scripts: { ...currentPackage.scripts, test: script } });
      assert.ok(npmAfter[1].stdout.includes(`> ${script}\n`));
    }
    const expectedFixture = summary.from ? originalFixture.replace(summary.from, summary.to) : originalFixture;
    assert.equal(receipt.actualFixtureHash, digest(Buffer.from(expectedFixture)));
    assert.deepEqual(receipt.inputHashes, prepared.inputs);
  });
  check(`${summary.name}: original natural cleanup and source guards`, () => {
    assert.equal(result.error, null); assert.equal(result.signal, null); assert.equal(result.killReason, null);
    assert.deepEqual(result.remaining, []); assert.deepEqual(result.finalGroup, []); assert.deepEqual(result.observedSurvivors, []);
    assert.deepEqual(receipt.before, receipt.after); assert.deepEqual(receipt.binBefore, receipt.binAfter);
    assert.equal(receipt.before.filter(entry => entry.kind === 'file').length, 14);
    for (const event of result.events.filter(entry => entry.event === 'spawn-after')) { assert.equal(event.error, null); assert.equal(event.signal, null); }
  });
  check(`${summary.name}: unchanged canonical assertions or meaningful negative`, () => {
    if (canonical) {
      assert.deepEqual(receipt.names, prepared.fixture.names);
      assert.deepEqual(receipt.counts, { tests: 8, pass: 8, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
      assert.equal(result.status, 0); assert.equal(npmAfter[0].status, 0); assert.equal(npmAfter[1].status, 1);
      assert.match(npmAfter[0].stdout, /^# tests 5$/mu); assert.match(npmAfter[0].stdout, /^# pass 5$/mu);
      assert.doesNotMatch(npmAfter[0].stdout + npmAfter[0].stderr, /NATIVE_DATA_MUST_NOT_EXECUTE/u);
      assert.match(npmAfter[1].stdout, /^# tests 7$/mu); assert.match(npmAfter[1].stdout, /^# fail 2$/mu);
      for (const nested of npmAfter) for (const counter of ['skipped', 'todo', 'cancelled']) assert.match(nested.stdout, new RegExp(`^# ${counter} 0$`, 'mu'));
    } else {
      assert.equal(result.status, 1);
      assert.deepEqual(receipt.names, [prepared.fixture.names[7]]);
      assert.deepEqual(receipt.counts, { tests: 1, pass: 0, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
      assert.match(stdout, /input did not match the regular expression/u);
      assert.doesNotMatch(stdout + stderr, /double-loading config|ERR_MODULE_NOT_FOUND|SyntaxError/u);
      const nested = npmAfter.at(-1), expected = removal ? 5 : 7;
      assert.equal(nested.status, removal ? 0 : 1);
      assert.match(nested.stdout, new RegExp(`^ℹ tests ${expected}$`, 'mu'));
      assert.match(nested.stdout, /^ℹ pass 5$/mu);
      assert.match(nested.stdout, new RegExp(`^ℹ fail ${removal ? 0 : 2}$`, 'mu'));
      assert.doesNotMatch(nested.stdout, /^# tests /mu);
      assert.ok(stdout.includes(`# tests ${expected}`));
      if (!removal) assert.match(nested.stdout, /NATIVE_DATA_MUST_NOT_EXECUTE/u);
      for (const counter of ['skipped', 'todo', 'cancelled']) assert.match(nested.stdout, new RegExp(`^ℹ ${counter} 0$`, 'mu'));
    }
  });
  const observedReads = [...new Set(result.events.filter(event => event.event === 'read').map(event => event.path))].sort();
  const fixedReads = observedReads.filter(path => !path.includes('/.scratch-'));
  check(`${summary.name}: selected fixture read bindings`, () => {
    for (const path of fixedReads) assert.ok(prepared.inputs.some(input => path === join(result.cwd, input.path)), path);
    for (const event of result.events.filter(event => event.event === 'read' && fixedReads.includes(event.path))) {
      const input = prepared.inputs.find(input => event.path === join(result.cwd, input.path));
      assert.equal(event.sha256, input.path === fixture ? receipt.actualFixtureHash : input.sha256);
    }
  });
  audit.rows.push({ name: summary.name, receiptSha256: digest(bytes), counts: receipt.counts, status: result.status, startupObservations: starts.length, distinctNodePids: new Set(starts.map(entry => entry.pid)).size,
    runtime: tool, actualForwardedArgv: forwarded[0].args, fixedReadBindings: fixedReads.map(path => path.slice(result.cwd.length + 1)),
    nested: npmAfter.map(entry => ({ args: entry.args, status: entry.status, stdoutSha256: digest(Buffer.from(entry.stdout)), stderrSha256: digest(Buffer.from(entry.stderr)), reporter: /^# tests /mu.test(entry.stdout) ? 'TAP' : /^ℹ tests /mu.test(entry.stdout) ? 'SPEC' : 'unknown' })),
    observation: summary.name === 'historical-tap-after-glob-node24' ? 'After-glob flag did not select TAP: tests still execute, local default SPEC emits 7 tests/5 pass/2 intentional failures; canonical TAP7 assertion detects mismatch. No option-parser rejection fabricated.' : undefined,
    resources: { group: result.processGroup, remaining: result.remaining, observedSurvivors: result.observedSurvivors, killed: result.killReason } });
}
check('all eight synthesized TS fixture bytes identical across all nested captures', () => { for (const snapshot of snapshotsAcrossRows) assert.deepEqual(snapshot, snapshotsAcrossRows[0]); });
const toolGuard = JSON.parse(gunzipSync(readFileSync(join(directory, 'tool-guards.json.gz'))));
check('full tooling byte/entry membership and Node identity before/after', () => {
  assert.deepEqual(toolGuard.originalBefore, toolGuard.originalAfter); assert.deepEqual(toolGuard.copiedBefore, toolGuard.copiedAfter);
  assert.deepEqual(originalReport.toolsBefore, originalReport.toolsAfter); assert.deepEqual(originalReport.toolsBefore, prepared.tools);
  assert.deepEqual(originalReport.versionsBefore, originalReport.versionsAfter);
});
const guards = JSON.parse(gunzipSync(readFileSync(join(directory, 'guard-controls.json.gz'))));
check('source guard detects both added entries and changed config bytes', () => { assert.notDeepEqual(guards.added, guards.guardBefore); assert.notDeepEqual(guards.mutated, guards.guardBefore); assert.deepEqual(guards.restored, guards.guardBefore); });
audit.status = 'qualified-pass';
audit.limitations = [policy.limitations, 'Initial supervisor remains failed (23/28 checks). The 28-check independent offline audit validates original raw evidence; it does not replace or rewrite that failed report.',
  'Startup observations include repeated PID contexts, not unique process counts. Reporter options are proven by actual parent spawn capture and actual npm script/output, not by demanding them in worker execArgv.',
  'Read observer covers synchronous fixture reads; static import review plus complete selected input/tool trees provides binding. This is not a kernel-level all-syscall/module-load attestation.',
  'Node24 default SPEC is observed only for this local non-TTY installed profile. No new Node22-default probe or general Node policy claim.',
  'Historical original independent Node24 7/8 and author 8/8 receipts remain separate immutable commits; no DU workflow/full gate rerun.'];
json(join(directory, 'AUDIT.json'), audit);
console.log(JSON.stringify({ status: audit.status, checks: audit.checks.length, originalHarness: originalReport.status, testsRerun: false, rows: audit.rows.map(({ name, counts, status }) => ({ name, counts, status })) }));
