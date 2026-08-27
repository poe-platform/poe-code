import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const auth = JSON.parse(readFileSync(process.argv[2]));
const controlsBytes = readFileSync(path.join(auth.review, 'CONTROLS.json'));
const matricesBytes = readFileSync(path.join(auth.review, 'independent-oracle-precode-01.json'));
const controls = JSON.parse(controlsBytes);
const frozen = JSON.parse(matricesBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { HistoryModel } = await import(pathToFileURL(path.join(auth.sealed, 'model.mjs')).href);
const profiles = { NODE: 'HNODE-AGG-v5', TREE: 'HTREE-AGG-v5' };
assert.equal(frozen.rows.length, 20);
const rows = [];
for (const row of frozen.rows) {
  const entry = controls.cases.find(item => item.id === row.case);
  const eligibility = entry.tail === false ? 'FINITE-PERMISSIVE' : 'LOCAL-TAIL-HYPOTHESIS';
  const model = new HistoryModel(controls.asts[entry.ast], entry.subject);
  const histories = entry.plans.map(plan => model.build(plan, eligibility));
  const actual = histories.map(first => histories.map(second => Math.sign(model.compare(first, second, profiles[row.profile])) || 0));
  assert.deepEqual(actual, row.matrix);
  const winner = histories.indexOf(model.rank(histories, profiles[row.profile]));
  assert.equal(winner, row.winner);
  rows.push({ case: row.case, profile: row.profile, eligibility, matrix: actual, winner, work: model.meter.work, allocation: model.meter.allocation });
}
console.log(JSON.stringify({
  candidate: auth.candidate, controlsSha256: hash(controlsBytes), frozenMatricesSha256: hash(matricesBytes),
  modelSha256: hash(readFileSync(path.join(auth.sealed, 'model.mjs'))),
  counts: { frozenMatrices: 20, passedMatrices: rows.length, pairCells: rows.reduce((total, row) => total + row.matrix.length ** 2, 0), newCases: 0, newPlans: 0, derivedOrChangedExpectations: 0 },
  rows, scope: 'Actual replay of twenty ALREADY PREPARED independent matrices, not a new cohort or oracle derivation. Eligibility preserves each frozen case binding.',
}, null, 2));
