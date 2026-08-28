import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { digest, regular } from '../../candidate-v1/boundary-app.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), own = path.resolve(here, '../..');
const read = name => regular(path.join(own, name));
const scopeBytes = read('s06-successor-v1/SCOPE-BINDING-v2.json'), scope = JSON.parse(scopeBytes);
assert.equal(digest(scopeBytes), 'ed7d15f4026bb81df52362956939236c7c5f04fb7285f6acc5f9e5ba803d84f3');
const policyBytes = regular(path.join(here, 'POLICY.json')), policy = JSON.parse(policyBytes);
const vectors = JSON.parse(read('review-v3/VECTORS.json')), holdouts = JSON.parse(read('executor-v1/HOLDOUTS.json')), mechanisms = JSON.parse(read('review-v3/CONTROLS.json'));
const mutations = JSON.parse(regular(path.join(here, 'MUTANTS.json'))).declarations;
const cohorts = { semantic: [...vectors.splice, ...vectors.zeroView].map(row => row.id), holdouts: holdouts.semantic.filter(row => !row.status).map(row => row.id), mechanical: mechanisms.controls.map(row => row.id), operations: holdouts.operations.map(row => row.id), ast: ['AST01','AST02','AST03','AST04'], guard: ['G-FALLBACK'] };
assert.deepEqual(Object.values(cohorts).map(ids => ids.length), [33,15,22,10,4,1]); assert.equal(mutations.length, 13);
const jobs = [];
for (const layout of ['source-build','installed','moved']) for (const [cohort, ids] of Object.entries(cohorts)) jobs.push({ label: `${layout}-${cohort}`, layout, cohort, ids });
for (const stage of ['positive-before','positive-after']) for (const cohort of ['mechanical','semantic','holdouts','operations']) {
  const ids = [...new Set(mutations.filter(row => row.cohort === cohort).flatMap(row => [...row.requiredFailed, ...row.requiredPassed]))];
  assert.ok(ids.every(id => cohorts[cohort].includes(id))); jobs.push({ label: `${stage}-${cohort}`, stage, cohort, ids });
}
const mapped = {
  'boundary.mjs': 'candidate-v1/boundary-app.mjs', 'semantic.mjs': 's06-successor-v1/semantic-registration-v2.mjs',
  'observer-v2.mjs': 'candidate-v1/observer-v2.mjs', 'VECTORS.json': 'review-v3/VECTORS.json', 'CONTROLS.json': 'review-v3/CONTROLS.json',
  'HOLDOUTS.json': 'executor-v1/HOLDOUTS.json', 'BASELINE.json': 'executor-v1/BASELINE.json', 'AST-COMPAT.json': 's06-successor-v1/AST-COMPAT-v1.json'
};
for (const name of ['worker.mjs','guard-worker.mjs','ast-worker.mjs','ast-core.mjs','instrumentation.mjs','complete-adapter.mjs','mechanism-adapter-v1.mjs','terminal-adapter-v2.mjs','SOURCE-PROOFS.json']) mapped[name] = `s06-successor-v1/preparation-v3/${name}`;
const paths = new Set([...scope.roles.map(role => role.path), 'candidate-v1/ADMISSION-02.json.gz.base64', 'candidate-v1/NPM-TOOL-INVENTORY.json.gz.base64', 's06-successor-v1/SCOPE-BINDING-v2.json']);
for (const name of fs.readdirSync(here).sort()) {
  if (['fixtures','synthetic-stubs'].includes(name)) for (const file of fs.readdirSync(path.join(here, name)).sort()) paths.add(`s06-successor-v1/preparation-v3/${name}/${file}`);
  else if (/\.(mjs|md|json)$/u.test(name) && !['SEAL.json','DATA-CAPTURE.json','SYNTHETIC-CAPTURE.json'].includes(name)) paths.add(`s06-successor-v1/preparation-v3/${name}`);
}
const roles = [...paths].sort().map(name => { const bytes = read(name); return { path: name, bytes: bytes.length, mode: fs.lstatSync(path.join(own, name)).mode & 0o777, sha256: digest(bytes) }; });
const appRoles = Object.entries(mapped).map(([destination, name]) => ({ destination, ...roles.find(role => role.path === name) }));
assert.ok(appRoles.every(role => typeof role.path === 'string'));
const gitPath = '/Library/Developer/CommandLineTools/usr/bin/git';
const seal = { kind: 'complete-array-successor-preparation-v3', status: 'preseal only; NO actual root GO', candidate: scope.product, composition: scope.selectedComposition, packageSha256: scope.package.sha256, projectionSha256: scope.selectedProjectionSha256, scopeSha256: digest(scopeBytes), policySha256: digest(policyBytes), roles, appRoles, cohorts, jobs,
  mutations: mutations.map(row => ({ id: row.id, member: row.member, cohort: row.cohort, ids: row.ids, requiredFailed: row.requiredFailed, requiredPassed: row.requiredPassed, changedSha256: row.changedSha256 })),
  git: { path: gitPath, sha256: digest(regular(gitPath)), bytes: fs.statSync(gitPath).size, role: 'actual CLT git executable, not /usr/bin xcrun selector; built-in show/rev-parse only' },
  storage: [
    { name: 'immutable-source', directory: 'source', maxBytes: policy.maxSourceBytes },
    { name: 'single-build', directory: 'build', maxBytes: 33554432 },
    { name: 'regular-type-tools', directory: 'tools', maxBytes: policy.maxToolCopyBytes },
    { name: 'apps-one-mutant-at-a-time', directory: 'apps', maxBytes: 67108864 },
    { name: 'whole-tars-and-variants', directory: 'artifacts', maxBytes: policy.maxPackageAndVariantBytes },
    { name: 'isolated-npm-state', directory: 'scratch', maxBytes: policy.maxNpmScratchBytes },
    { name: 'all-child-and-integrity-records', directory: 'records', maxBytes: 134217728 }
  ],
  counts: { semanticPerLayout: 33, mechanicalPerLayout: 22, holdoutsPerLayout: 15, extraH12Held: 1, operationsPerLayout: 10, astPerLayout: 4, typePerLayout: 10, negativeTypesPerLayout: 5, runtimeLayoutChildren: 18, mutantChildren: 13, positiveCompanionChildren: 8, oldAstChild: 1, runtimeChildren: 40, typeChildren: 30, toolChildren: 3, directPrimaryChildren: 73, expectedGitChildren: 272, maxGitChildren: 300, expectedTotalDirectChildren: 345, maxTotalDirectChildren: 373, originalNestedGitPotentialRetained: 4842 },
  limitations: [
    'No execution by this DATA sealer; actual successor and mutant pass/kill counts remain zero.',
    'M21 source-only acyclic owning-edge argument; M03/M07/M14/M15/M20 combine specified dynamics with bound source premises, not universal engine allocation/RSS proof.',
    'M01/M02 private near-ticket-end constructor hook is not a configured public boundary. M14 widened slots: literal F4 ledger plus reachable F128 watch, not pretend F4 full store.',
    'G4A input and registered command formatting after argv transfer are E outside private cap; no combined memory/RSS or hard primitive preemption claim.',
    'H12 assignment-context IFS joining remains a precise proposed policy, outside the15 frozen executable holdouts; cannot claim16/16 without root decision.',
    'Old31/33 layouts,14 unregistered printf failures, zero old mutant loads, all original admission/observer failures remain unchanged.',
    'No native/private/YQ/XAN/fullgate. Accepted STACK136/C06partial/S13unsupported;77 defaults unchanged.',
    '269 authenticated Git source reads cached once, not4842 per-coordinator reads; every actual worker still gets complete append-aware source/app census plus actual loaded-byte witnesses.',
    'Node children deny process/worker creation; trusted git builtin metadata role has no configured hooks/external filters. Group reap mandatory; no hostile-host-executable sandbox or kernel scheduling guarantee.'
  ] };
assert.equal(jobs.length, 26); assert.equal(seal.counts.directPrimaryChildren, policy.maxPrimaryJobs); assert.equal(seal.counts.runtimeChildren, policy.maxProductWorkers);
const text = JSON.stringify(seal, null, 2) + '\n';
assert.ok(!fs.existsSync(path.join(here, 'SEAL.json')), 'additive seal only, no silent reseal');
execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${path.join(here, 'SEAL.json')}\n${text.slice(0,-1).split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, timeout: 10000, maxBuffer: 1048576 });
console.log(JSON.stringify({ sha256: digest(Buffer.from(text)), roles: roles.length, appRoles: appRoles.length, jobs: jobs.length, counts: seal.counts, status: 'DATA preseal; no product execution' }));
