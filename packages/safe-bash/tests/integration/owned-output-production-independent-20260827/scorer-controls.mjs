import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertObservation } from './assert-observation.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./CASES.json', import.meta.url), 'utf8'));
assert.equal(fixtures.status, 'PRE_CANDIDATE_SEMANTIC_FREEZE_NOT_EXECUTED');
assert.equal(fixtures.cases.length, 36);
assert.equal(new Set(fixtures.cases.map(fixture => fixture.id)).size, 36);
for (const fixture of fixtures.cases) {
  assert.ok(fixture.recipe.length > 40);
  assert.ok(Object.keys(fixture.expected.values).length > 0);
}
const acquisition = fixtures.cases.find(fixture => fixture.id === 'A03');
const acquired = {
  id: 'A03',
  events: ['scope-register', 'start', 'close-enter', 'resource-resolve', 'release-start', 'release-finish', 'close-settle'],
  values: { pendingBeforeResource: true, pendingDuringRelease: true, lateStarts: 0, releases: 1, ownedResourcesAfter: 0 }
};
assertObservation(acquisition, acquired);
const failures = [
  { ...acquired, id: 'A04' },
  { ...acquired, events: ['scope-register', 'start', 'close-enter', 'close-settle', 'resource-resolve', 'release-start', 'release-finish'] },
  { ...acquired, events: acquired.events.filter(event => event !== 'release-finish') },
  { ...acquired, values: { ...acquired.values, pendingBeforeResource: false } },
  { ...acquired, values: { ...acquired.values, pendingDuringRelease: false } },
  { ...acquired, values: { ...acquired.values, lateStarts: 1 } },
  { ...acquired, values: { ...acquired.values, releases: 2 } },
  { ...acquired, values: { ...acquired.values, ownedResourcesAfter: 1 } },
  { ...acquired, values: {} }
];
for (const failure of failures) assert.throws(() => assertObservation(acquisition, failure), { code: 'ERR_ASSERTION' });
const rejected = fixtures.cases.find(fixture => fixture.id === 'E02');
const exact = { id: 'E02', events: [], values: { exactExecutionReasons: [true, true, true, true], cleanupReleases: [1, 1, 1, 1], unhandledRejections: 0 } };
assertObservation(rejected, exact);
assert.throws(() => assertObservation(rejected, { ...exact, values: { ...exact.values, exactExecutionReasons: [true, true, true, false] } }), { code: 'ERR_ASSERTION' });
console.log(JSON.stringify({ semanticCasesFrozen: 36, syntheticPositiveControls: 2, syntheticNegativeControls: 10, candidateCasesExecuted: 0, productImports: 0, privateEngineImports: 0 }));
