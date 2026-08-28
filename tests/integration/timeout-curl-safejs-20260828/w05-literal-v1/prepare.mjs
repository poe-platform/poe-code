import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { own as originalOwn, hashFile, read, save, sha, write } from '../common.mjs';
import { guardOriginal } from './verification.mjs';

guardOriginal();
const own = join(originalOwn, 'w05-literal-v1');
const original = read(join(originalOwn, 'CASES.json')), oldRow = original.rows.find(row => row.id === 'W05');
assert.equal(oldRow.expected.stderr, 'curl: Network access denied by host policy\n');
const newRow = structuredClone(oldRow);
newRow.expected.stderr = 'curl: (7) Network access denied by host policy\n';
assert.deepEqual({ ...newRow, expected: { ...newRow.expected, stderr: oldRow.expected.stderr } }, oldRow);
const cases = { ...original, schema: 'timeout-curl-safejs-W05-literal-continuation-v1', distinctWorkflows: 1, positiveChildren: 2, controlChildren: 0, controlPredicates: 4, rows: [newRow], controls: [], predicateControls: ['wrong-status', 'wrong-diagnostic-code', 'missing-prefix', 'extra-request'], qualifications: [...original.qualifications.slice(0, -1), 'Only W05 installed+moved: two measured execs and two separate empty admission execs; no other workflow, old control, or engine-evaluation replay.'] };
save(join(own, 'CASES.json'), cases);
let code = fs.readFileSync(join(originalOwn, 'run.mjs'), 'utf8');
assert.equal(sha(code), '7713c77940fd0ac4feb47e03472867439b175d18c76c9507e637bdd3e832843d');
const deltas = [];
function replace(label, before, after) {
  assert.equal(code.split(before).length, 2, `UNIQUE_ADAPTER:${label}`);
  code = code.replace(before, after); deltas.push({ label, before, after, beforeSHA256: sha(before), afterSHA256: sha(after) });
}
replace('common scope alias', 'import { own, repo, node,', 'import { own as originalOwn, repo, node,');
replace('common import parent', "from './common.mjs';", "from '../common.mjs';");
replace('only new controls', "import { predicateControls } from './predicates.mjs';", "import { predicateControls } from './controls.mjs';\nimport { guardOriginal } from './verification.mjs';");
replace('parser parent relocation', "from '../../commands/timeout-independent-20260828/repaired-f22-v1/recipe/io.mjs';", "from '../../../commands/timeout-independent-20260828/repaired-f22-v1/recipe/io.mjs';");
replace('continuation scope and original binding', "const binding = read(join(own, 'BINDINGS.json')), cases", "const own = join(originalOwn, 'w05-literal-v1');\nconst binding = read(join(originalOwn, 'BINDINGS.json')), cases");
replace('separate result schema', "schema: 'timeout-curl-actual-safejs-workflow-result-v1'", "schema: 'timeout-curl-safejs-W05-literal-continuation-result-v1'");
replace('original guard before every child', 'function guard(label) {', 'function guard(label) {\n  guardOriginal();');
replace('unchanged child loader and predicates', "fs.readFileSync(join(own, name)));", "fs.readFileSync(join(name === 'CASES.json' ? own : originalOwn, name)));");
const start = code.indexOf('  const packageProbe ='), end = code.indexOf('  const files =', start);
assert.ok(start >= 0 && end > start);
replace('omit old control artifact materialization', code.slice(start, end), '');
replace('omit old control bindings', "  files['harness/mutant-package.mjs'] = sha(packageProbe); files['harness/mutant-engine.mjs'] = sha(engineProbe); delete files['harness/unbound.mjs'];\n", '');
replace('precise load binding classification', "countercontrols: 'Intentional separately pinned tampered copies; original product/engine and their bindings remain unchanged.'", "countercontrols: 'Only separately presealed W05 predicate controls; no old load-control replay or mutant artifacts.'");
replace('no prior control child loop', "  for (const control of cases.controls) { const outcome = await child(`control-${control.id}`, undefined, control.id); assert.equal(outcome.classification, 'PASS', 'PREREQUISITE_CONTROL_STOP'); }", "  assert.equal(cases.controls.length, 0, 'NO_OLD_CONTROL_REPLAY');\n  assert.deepEqual(cases.rows.map(row => row.id), ['W05'], 'ONLY_W05');");
replace('two continuation instances only', 'report.rows.length === 24', 'report.rows.length === 2');
replace('continuation unexecuted denominator', 'unexecutedWorkflows: 24 - report.rows.length', 'unexecutedWorkflows: 2 - report.rows.length');
write(join(own, 'run.mjs'), code);
save(join(own, 'AMENDMENT.json'), {
  schema: 'W05-only-literal-amendment-v1', preparedAt: new Date().toISOString(), originalRecipeCommit: '384fcc7a8b1ee0f10452f136c2cbd046b57e3e2d', originalEvidenceCommit: '144e0fca945b40dc8f04cbd9d69fa6e23f770ac8',
  originalEvidenceSHA256: hashFile(join(originalOwn, 'EVIDENCE-MANIFEST.json')),
  originalCasesSHA256: hashFile(join(originalOwn, 'CASES.json')), patchedCasesSHA256: hashFile(join(own, 'CASES.json')),
  oldRow, newRow, semanticDelta: 'Only W05 expected.stderr adds the authenticated (7) prefix. Status/stdout/inputs/environment/mocks/budgets/timer/order/all other assertions unchanged. Selection and counts restrict execution to W05 twice.',
  originalRunnerSHA256: hashFile(join(originalOwn, 'run.mjs')), adaptedRunnerSHA256: sha(code), deltas,
  unchangedActualFunctions: ['child.mjs', 'loader.mjs', 'predicates.mjs', 'common.mjs'].map(path => ({ path, sha256: hashFile(join(originalOwn, path)) })),
  controls: { classes: 3, cases: 4, description: 'Wrong code/status (two variants), missing numeric prefix (original wrong literal), extra request. Exact original runtime predicates, positive helper baseline, no product loads.' },
  chronology: 'Root-authorized post-failure literal correction; not a pre-source freeze. Zero new product executions before this continuation seal.',
  history: 'Original 11/12 each and 116/118 remain immutable verifier failures; no product bug or old rescore. Composition may be 11 retained + 1 newly qualified per layout, never a single original12 pass.',
});
console.log(JSON.stringify({ prepared: true, selected: cases.rows.map(row => row.id), children: 2, deltas: deltas.length, patchedCasesSHA256: hashFile(join(own, 'CASES.json')), runnerSHA256: sha(code), productExecutions: 0 }));
