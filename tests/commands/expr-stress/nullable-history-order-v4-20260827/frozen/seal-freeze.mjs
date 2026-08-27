import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { addJSON, directory, git, hash, inventory, json, root } from './common.mjs';

assert.equal(process.argv[2], '--seal-once');
const inputs = json('INPUTS.json');
const commit = reference => git(['rev-parse', reference]).toString().trim();
const bind = (revision, filename) => {
  const bytes = git(['show', `${revision}:${filename}`]);
  return { commit: revision, path: filename, blob: git(['rev-parse', `${revision}:${filename}`]).toString().trim(), bytes: bytes.length, sha256: hash(bytes) };
};
const tracked = (revision, names) => git(['ls-tree', '-r', '--name-only', revision, '--', ...names]).toString().trim().split('\n').filter(Boolean);
const basenames = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
const baseline = { commit: inputs.baseline, tree: git(['rev-parse', `${inputs.baseline}^{tree}`]).toString().trim(), files: tracked(inputs.baseline, basenames).map(filename => bind(inputs.baseline, filename)) };
const evidenceRoots = [
  ['c433d023', 'tests/commands/expr-stress/repeat-history-author'],
  ['954ddde4', 'tests/commands/expr-stress/repeat-history-independent-20260827'],
  ['8897ece3', 'tests/commands/expr-stress/posix-semantics-independent-20260827'],
  ['b6eaa23a', 'tests/commands/expr-stress/repeat-policy-handoff-20260827'],
];
const historical = evidenceRoots.map(([reference, prefix]) => {
  const revision = commit(reference);
  return { commit: revision, prefix, files: tracked(revision, [prefix]).map(filename => bind(revision, filename)) };
});
for (const cohort of historical) for (const entry of cohort.files) assert.equal(hash(readFileSync(path.join(root, entry.path))), entry.sha256, entry.path);
const independent = historical[1];
const author = historical[0];
const catalogs = [
  { commit: independent.commit, path: `${independent.prefix}/CASES.json`, field: 'cases' },
  { commit: independent.commit, path: `${independent.prefix}/HISTORICAL-REGRESSIONS.json`, field: 'rows' },
  { commit: author.commit, path: `${author.prefix}/candidate-run-04/observations.json`, field: 'rows' },
];
const origins = inputs.cases.map(fixture => {
  const old = catalogs.flatMap(catalog => {
    const rows = JSON.parse(git(['show', `${catalog.commit}:${catalog.path}`]))[catalog.field];
    return rows.flatMap((row, index) => (row.subject ?? row.argv?.[1]) === fixture.subject && (row.pattern ?? row.argv?.[3]) === fixture.pattern ? [{ ...catalog, pointer: `/${catalog.field}/${index}`, id: row.id }] : []);
  });
  return { id: fixture.id, inputIdentitySha256: hash(JSON.stringify([fixture.subject, fixture.pattern])), classification: old.length ? 'exact-old-pair' : 'new-pair-relative-to-listed-old-catalogs', old };
});
const controls = ['regex-protocol', 'regex-lifecycle', 'regex-limits', 'abort-reason-regression'].map((name, index) => ({ name, historicalCount: [5, 11, 10, 111][index], source: bind(inputs.baseline, `tests/commands/expr/${name}.test.ts`), priorTap: independent.files.find(entry => entry.path === `${independent.prefix}/candidate-01/${name}.tap`) }));
assert.ok(controls.every(control => control.priorTap));
addJSON('FREEZE-MANIFEST.json', { schema: 1, sealed: new Date().toISOString(), baseline, historical, origins, counts: { distinctInputs: inputs.cases.length, exactOldPairs: origins.filter(row => row.old.length).length, newPairs: origins.filter(row => !row.old.length).length, nativeSemanticCalls: 128, historicalControlsBoundNotRerun: 137 }, futureVariantObligations: { controls, historicalRegressions: bind(independent.commit, `${independent.prefix}/HISTORICAL-REGRESSIONS.json`), caveat: '137 is prior qualified evidence, not a new run. Preserve original failures and correction receipts. Do not conflate repeated alternation with nonrepeated historical witness.' }, entries: inventory(directory), sealScope: 'Listed freeze files immutable. Follow-on baseline evidence outside this listed set is allowed and separately sealed. Not an append-proof whole repository claim.' });
console.log(JSON.stringify({ inputs: inputs.cases.length, old: origins.filter(row => row.old.length).length, newlySelected: origins.filter(row => !row.old.length).length }));
