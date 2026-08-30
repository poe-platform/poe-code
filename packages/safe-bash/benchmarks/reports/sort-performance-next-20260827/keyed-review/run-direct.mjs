import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { holdoutsV2 } from './holdouts-v2.mjs';
import { runPublic } from './run-public.mjs';
import { runInstrumented } from './run-audit.mjs';
import { replaceOne } from './instrument.mjs';
import { directory, git, json } from './harness.mjs';
const rows = holdoutsV2().filter(row => row.borrowedWidth);
const baseline = JSON.parse(readFileSync(join(directory, 'baseline-attempt1/prepared.json')));
const candidate = JSON.parse(readFileSync(join(directory, 'candidate-preparation/prepared.json')));
const controls = [];
for (const [label, prepared] of [['baseline', baseline], ['candidate', candidate]]) {
  const result = await runPublic(prepared, label + '-direct-ownership', rows, 'direct-worker.mjs');
  controls.push(result);
  assert.equal(result.passed, 2); assert.equal(result.failed, 0);
}
const original = git(candidate.commit, 'src/commands/text.ts').toString();
const mutants = [];
for (const [name, before, after] of [
  ['complete', 'else accept(new Uint8Array(part));', 'else accept(part);'],
  ['pending', 'pending.push(new Uint8Array(chunk.subarray(start)));', 'pending.push(chunk.subarray(start));'],
]) {
  const result = await runInstrumented(candidate, 'mutant-direct-' + name, original, source => replaceOne(source, before, after), rows, 'direct-worker.mjs');
  mutants.push({ name, child: result.metadata.child, counterFailures: result.metadata.counterFailures });
}
json(join(directory, 'direct-ownership-summary.json'), { controls, mutants, originalMutationOutcomePreserved: '12/14 killed; two Shell-wrapper ownership mutants survived', supplement: 'same two frozen cases, direct boundary only' });
assert.ok(mutants.every(row => row.child.failed > 0 && row.child.killed === null));
console.log(JSON.stringify({ controls: controls.map(row => ({ passed: row.passed, failed: row.failed })), mutants }));
