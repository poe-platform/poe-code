import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha, fingerprint, toolIdentity, writeNew } from '../core.mjs';
import { gitBytes } from '../supervisor.mjs';
import { normalize } from './cases.mjs';
import { planCohort } from './cohort.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const repo = path.resolve(root, '../../../..');
const parent = path.dirname(root.slice(0, -1));
const v1 = JSON.parse(await readFile(path.join(parent, 'BINDING.json'), 'utf8'));
const prefix = 'tests/commands/xan-independent-20260828/';
const names = ['FINAL-CONTRACT-V4.md', 'FINAL-BINDING-V4.json', 'SELECTOR-FREEZE-V4.json', 'B01-RATIFICATION-7.json', 'final-freeze-v3/CASES.json', 'final-freeze-v3/CONTROLS.json', 'final-freeze-v3/LIMITS.json'];
const inputs = names.map(name => v1.inputs.find(entry => entry.path === prefix + name));
assert.ok(inputs.every(Boolean));
const documents = {};
for (const entry of inputs) {
  const data = await gitBytes(['show', `${entry.commit}:${entry.path}`], entry.bytes, repo);
  assert.equal(data.length, entry.bytes); assert.equal(sha(data), entry.sha256);
  if (entry.path.endsWith('.json')) documents[entry.path.slice(prefix.length)] = JSON.parse(data.toString('utf8'));
}
const rows = normalize(documents);
const sourceInputs = [
  ['prior-case', 'final-freeze-v3/CASES.json', 'cases', 'assertCase'],
  ['family', 'final-freeze-v3/CONTROLS.json', 'families', 'assertScenario'],
  ['cap', 'final-freeze-v3/LIMITS.json', 'rows', 'generator+assertResourceTrace'],
  ['ratification', 'B01-RATIFICATION-7.json', 'rules', 'assertCase+matcher'],
  ['selector', 'SELECTOR-FREEZE-V4.json', 'cases', 'assertCase+assertPhase+matcher'],
];
const obligations = sourceInputs.flatMap(([kind, name, key, engine]) => documents[name][key].map((value, index) => ({
  kind, id: value.id ?? value.name, input: prefix + name, pointer: `/${key}/${index}`, subtreeSha256: sha(JSON.stringify(value)), engine,
  scenario: kind === 'prior-case' || kind === 'selector' ? `${value.id}/P0` : value.id ?? value.name,
  candidateState: 'PREPARED_UNEXECUTED',
})));
assert.equal(obligations.length, 161);
await writeNew(path.join(root, 'CASE-MAP.json'), { classification: 'EXECUTABLE_PREPARATION_NOT_PRODUCT_COVERAGE', obligations,
  normalizedRows: rows.map(row => ({ id: row.id, sha256: sha(JSON.stringify(row)) })), executionDocumentsSha256: sha(JSON.stringify(documents)),
  prior88: rows.filter(row => row.group === 'prior88').map(row => ({ id: row.id, assertion: 'cases.mjs:assertCase', scenario: `${row.id}/P0`, expectedSha256: sha(JSON.stringify(row.expected)), families: row.families })),
  selectors: { valid: 21, S: 5, N: 2, R: 8 }, contextualMatchers: rows.filter(row => row.expected.stderr.precision).map(row => row.id),
  actualProductCasesExecuted: 0 });
await writeNew(path.join(root, 'COHORT.json'), planCohort(rows, documents));
const helpers = [];
for (const name of ['core.mjs', 'mocks.mjs', 'supervisor.mjs', 'guard.mjs']) {
  const file = path.join(parent, name); const actual = await fingerprint(file);
  const committed = await gitBytes(['show', `9c8855b806bd963ccc1f1209e454ffc582b16e1b:tests/commands/xan-module-review-20260828/${name}`], actual.bytes, repo);
  assert.equal(sha(committed), actual.sha256);
  helpers.push({ path: `../${name}`, ...actual, commit: '9c8855b806bd963ccc1f1209e454ffc582b16e1b' });
}
const files = [];
for (const name of (await readdir(root)).sort()) {
  assert.ok(name.endsWith('.mjs') || ['PREPARATION.md', 'CASE-MAP.json', 'COHORT.json'].includes(name), `unexpected preseal file ${name}`);
  files.push({ path: name, ...await fingerprint(path.join(root, name)) });
}
await writeNew(path.join(root, 'RECIPE-SEAL.json'), { schema: 'xan-preparation-v2-seal', timing: 'POST_AUTHOR_RELEASE_PRE_INDEPENDENT_SOURCE_INSPECTION_EXECUTION',
  frozenCommit: '55810d4aea70fadf151c2fbf746a17f96bfeb599', created: new Date().toISOString(), files, helpers, inputs,
  policyBindingsMetadataOnly: documents['FINAL-BINDING-V4.json'].authority,
  tools: [await toolIdentity(process.execPath), await toolIdentity('/usr/bin/git')],
  retention: { json: 'each artifact exact declared byte size; no RSS/constant-memory assertion', transportChunkBytes: 65536 },
  exclusions: ['No src/commands/xan content read', 'No product/build/typecompile/native oracle execution', 'No mutable author input', 'No installed dependencies'],
  historicalQualification: { commit: '4c106d2bbd33e81e4dc12ffdd18f5e3731b9fd39', count: 74, rescore: false } });
console.log(JSON.stringify({ staticSealOnly: true, cases: 138, obligations: 161, recipeManifest: await fingerprint(path.join(root, 'RECIPE-SEAL.json')) }));
