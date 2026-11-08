import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cases } from './cases.mjs';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const records = cases.map(item => read(`./evidence/${item.id}.json`));
const summary = read('./evidence/summary.json');
const before = read('./frozen.json');
const after = read('./evidence/after.json');
assert.equal(cases.length, 12);
assert.equal(cases.filter(item => item.kind === 'nested').length, 8);
assert.equal(Math.max(...cases.map(item => item.subjectBytes)), 29);
assert.deepEqual(cases.filter(item => item.kind === 'nested').map(item => item.repeatedA), [16, 20, 24, 28, 16, 20, 24, 28]);
assert.equal(records.filter(item => item.pid !== null).length, summary.ownedChildrenLaunched);
assert.equal(records.filter(item => item.outcome === 'completed').length, summary.executedCases);
assert.equal(records.filter(item => item.outcome === 'skipped').length, summary.explicitSkippedCases);
assert.equal(records.filter(item => item.outcome === 'not-started-source-drift').length, summary.prelaunchSourceDriftStops);
assert.equal(records.filter(item => item.kind === 'nested' && item.pid !== null).length, summary.executedRisky);
assert.ok(records.every(item => item.activechildren === 0));
const completed = records.find(item => item.outcome === 'completed');
assert.ok(completed.cleanup.every(Boolean));
assert.equal(completed.sourceStable, true);
const child = JSON.parse(completed.stdout);
assert.equal(child.calls, summary.selectedNativeExec);
assert.equal(child.commandExit, cases[0].expected.exitCode);
assert.equal(child.stdout, cases[0].expected.stdout);
assert.equal(child.stderr, cases[0].expected.stderr);
assert.equal(Buffer.byteLength(completed.stdout), completed.bytes[0]);
assert.ok(child.commandEnd < child.timerDue && child.timerDue < child.timerActual);
assert.equal(Object.keys(before.hashes).length, summary.frozenFiles);
assert.deepEqual(Object.keys(before.hashes).filter(name => before.hashes[name] !== after.hashes[name]), summary.drift);
process.stdout.write(JSON.stringify({ evidenceConsistent: true, executed: summary.executedCases,
  risky: summary.executedRisky, unexecuted: summary.notExecutedCases,
  driftFiles: summary.drift, activeOwnedChildren: 0 }) + '\n');
