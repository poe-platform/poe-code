import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { author, freeze, manifestSha, raw, read, save, probe, errorRecord } from './common.mjs';

const { runSyntheticControls } = await import(pathToFileURL(join(author, 'recipe/synthetic-controls.mjs')));
const { runForwardingControls } = await import(pathToFileURL(join(author, 'recipe/forwarding-controls.mjs')));
const { intactBindings } = await import(pathToFileURL(join(author, 'recipe/bindings.mjs')));
const { pin } = await import(pathToFileURL(join(author, 'recipe/authenticate.mjs')));
const output = join(raw, 'controls');
fs.mkdirSync(output);
const summary = { invocation: 1, retries: 0, realResourceCasesExecuted: 0, declared: 75, synthetic: null, forwarding: null, readonly: null, errors: [] };
try {
  save(join(raw, 'CONTROL-PRE.json'), intactBindings(freeze, manifestSha));
  summary.synthetic = runSyntheticControls(output, pin.policy);
  summary.forwarding = await runForwardingControls(output, pin.policy, () => intactBindings(freeze, manifestSha));
  const subjects = summary.forwarding.actual.flatMap(cohort => cohort.cohort.rows.map(row => {
    const receipt = read(join(output, 'forwarding-controls', cohort.name, `${cohort.cohort.rows.indexOf(row) + 1}-${row.mode}`, 'RAW-RECEIPT.json'));
    return { ...row, pid: receipt.pid, exit: receipt.exit, close: receipt.close, closeObserved: receipt.closeObserved, pidState: receipt.pidState, groupMembers: receipt.groupMembers };
  }));
  summary.subjects = subjects;
  summary.probe = probe(subjects.map(row => row.pid), subjects.map(row => row.pid));
  save(join(raw, 'FORWARDING-SETTLEMENT.json'), { subjects, probe: summary.probe });
  assert.equal(summary.forwarding.safe, true);
  assert.ok(subjects.every(row => row.physicalSafety && row.closeObserved && row.pidState === 'absent' && row.groupMembers.length === 0));
  assert.ok(summary.probe.pids.every(row => row.state === 'absent'));
  assert.ok(summary.probe.groups.every(row => row.members.length === 0));
  const stdout = fs.openSync(join(raw, 'readonly.stdout.json'), 'wx'), stderr = fs.openSync(join(raw, 'readonly.stderr.data'), 'wx');
  const child = spawn(pin.tools.node.path, [join(author, 'read-only-verifier.mjs')], { cwd: author, env: { PATH: '/usr/bin:/bin', HOME: join(raw, 'tmp'), TMPDIR: join(raw, 'tmp'), LC_ALL: 'C' }, stdio: ['ignore', stdout, stderr] });
  let exit, spawnError;
  child.once('exit', (code, signal) => { exit = { code, signal }; });
  child.once('error', error => { spawnError = errorRecord(error); });
  const terminal = await new Promise(resolveClose => child.once('close', (code, signal) => resolveClose({ code, signal })));
  fs.fsyncSync(stdout); fs.fsyncSync(stderr); fs.closeSync(stdout); fs.closeSync(stderr);
  const report = read(join(raw, 'readonly.stdout.json'));
  summary.readonly = { pid: child.pid, exit, close: terminal, spawnError, checks: report.checks, passed: report.passed, failed: report.failed, savedArtifacts: author, fiveCasesReplayed: false };
  save(join(raw, 'READONLY-SETTLEMENT.json'), summary.readonly);
  assert.equal(terminal.code, 0); assert.equal(terminal.signal, null); assert.equal(spawnError, undefined);
  assert.equal(report.checks.length, 33); assert.equal(report.failed, 0);
  assert.equal(summary.synthetic.declared, 28); assert.equal(summary.synthetic.executed, 28); assert.equal(summary.synthetic.allExpected, true);
  assert.equal(summary.forwarding.actual.length, 6); assert.equal(summary.forwarding.predicates.length, 8); assert.equal(summary.forwarding.allExpected, true);
  save(join(raw, 'CONTROL-POST.json'), intactBindings(freeze, manifestSha));
} catch (error) { summary.errors.push(errorRecord(error)); }
summary.outcomes = [
  ...(summary.synthetic?.rows ?? []).map(row => ({ family: 'consumer-predicate', name: row.name, expected: row.expectedOutcome, actual: row.actual })),
  ...(summary.forwarding?.actual ?? []).map(row => ({ family: 'forwarding-cohort', name: row.name, expected: row.expected, injectedAggregateExit: row.cohort.exitCode })),
  ...(summary.forwarding?.predicates ?? []).map(row => ({ family: 'ordered-predicate', name: row.name, expected: row.expected, accepted: row.accepted })),
  ...(summary.readonly?.checks ?? []).map(row => ({ family: 'original-readonly', name: row.name, expected: row.passed, error: row.error })),
];
summary.executed = summary.outcomes.length;
summary.expected = summary.outcomes.filter(row => row.expected).length;
summary.unexpected = summary.outcomes.filter(row => !row.expected).length;
summary.unexecuted = summary.declared - summary.executed;
save(join(raw, 'SUMMARY.json'), summary);
process.exitCode = summary.errors.length || summary.expected !== 75 ? 1 : 0;
console.log(JSON.stringify({ executed: summary.executed, expected: summary.expected, unexpected: summary.unexpected, unexecuted: summary.unexecuted, errors: summary.errors.length, realResourceCasesExecuted: 0 }));
