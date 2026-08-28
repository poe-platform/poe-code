import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { ROOT, PREFIX, git, gitReceipts, identity, assemble, tree, verifyTree } from './artifacts.mjs';
import { durable, digest } from './a01.mjs';
import { verifyCommitted, frozenDocuments } from '../preparation-v2/integrity.mjs';
import { normalize, caseJobs } from '../preparation-v2/cases.mjs';
import { scenarios, flagVariants, guards } from '../preparation-v2/scenarios.mjs';

const recipe = process.argv[2]; assert.match(recipe, /^[a-f0-9]{40}$/);
const configuration = JSON.parse(await readFile(path.join(ROOT, 'ADMISSION-RECIPE.json'), 'utf8'));
const recipeFiles = ['.gitignore', 'ADMISSION-RECIPE.json', 'SOURCE-INSPECTION.md', 'admission.mjs', 'artifacts.mjs', 'loader.mjs', 'worker.mjs', 'extra.mjs', 'bundle.mjs', 'A01-EVIDENCE-SEAL.json'];
const recipeIdentities = [];
async function verifyRecipe() {
  for (const name of recipeFiles) {
    const current = await readFile(path.join(ROOT, name));
    assert.deepEqual(current, await git(['show', `${recipe}:${PREFIX}${name}`], current.length));
  }
  return verifyCommitted('0a02e846b3f4985cad4394187717ceabd0188f25');
}
const preparation = await verifyRecipe();
for (const name of recipeFiles) recipeIdentities.push({ path: name, ...await identity(path.join(ROOT, name)) });
const a01Seal = JSON.parse(await readFile(path.join(ROOT, 'A01-EVIDENCE-SEAL.json'), 'utf8'));
await verifyTree(path.join(ROOT, 'a01-evidence'), a01Seal.entries);
const a01Summary = JSON.parse(await readFile(path.join(ROOT, 'a01-evidence/SUMMARY.json'), 'utf8'));
assert.equal(a01Summary.recipe, configuration.a01Recipe); assert.equal(a01Summary.qualified, 25); assert.equal(a01Summary.failed, 0); assert.equal(a01Summary.reaped, 25);
const documents = await frozenDocuments(preparation); const rows = normalize(documents);
const mapping = JSON.parse(await readFile(path.join(ROOT, '../preparation-v2/CASE-MAP.json'), 'utf8'));
assert.equal(mapping.obligations.length, 161);
const plans = { direct: caseJobs(rows, documents['final-freeze-v3/CONTROLS.json']), flags: flagVariants(rows).map(row => row.id),
  scenarios: scenarios().map(spec => spec.id), limits: documents['final-freeze-v3/LIMITS.json'].rows.flatMap(row => [row.defaultValue - 1, row.defaultValue, row.defaultValue + 1].map(target => ({ name: row.name, target }))),
  guards: guards(documents['final-freeze-v3/LIMITS.json'].rows).map(spec => spec.id) };
const directory = path.join(ROOT, 'evidence'); await mkdir(directory);
await durable(path.join(directory, 'PRE-RUN.json'), { recipe, configuration, recipeIdentities, started: new Date().toISOString(), a01Evidence: await identity(path.join(ROOT, 'A01-EVIDENCE-SEAL.json')), productExecutions: 0 });
await durable(path.join(directory, 'REQUIRED-JOBS.json'), { classification: 'PRESERVED_REQUIRED_JOBS_ALL_UNEXECUTED_NOT_COVERAGE_PROOF', layouts: ['SOURCE', 'INSTALLED_MOVED'], plans });
let artifactAdmission = false; let binding; let failure;
try {
  const admitted = await assemble(path.join(ROOT, 'work'), directory); binding = admitted.binding;
  await verifyTree(path.join(ROOT, 'work/source'), binding.source);
  await verifyTree(path.join(ROOT, 'work/tools'), binding.tools);
  await verifyTree(path.join(ROOT, 'work/installed-moved'), binding.installed);
  await verifyRecipe();
  artifactAdmission = true;
  const missing = Object.entries(configuration.actualReadiness).filter(([, ready]) => !ready).map(([name]) => name);
  assert.equal(missing.length, 0, `ACTUAL_EXECUTION_HOLD: missing independently completed prerequisites: ${missing.join(', ')}`);
  throw new Error('No product execution is authorized by this admission-only recipe');
} catch (error) { failure = { name: error.name, message: error.message, stack: error.stack }; }
await durable(path.join(directory, 'GIT-CHILD-RECEIPTS.json'), gitReceipts);
const perLayoutJobs = Object.values(plans).reduce((count, jobs) => count + jobs.length, 0);
const matrix = mapping.obligations.map(obligation => ({ ...obligation,
  candidateState: 'BLOCKED_ADMISSION_ACTUAL_BRIDGES_INCOMPLETE', productPass: false,
  ownedEvidence: 'evidence/RESULT.json', ownedAdmission: 'ADMISSION-RECIPE.json', ownedInspection: 'SOURCE-INSPECTION.md',
  actualJobs: [], requiredPreparedEngine: obligation.engine, reason: artifactAdmission ? 'Actual adapter/build/types/loader and source ledger prerequisites not completed' : 'Artifact admission failed; dependent product execution not started' }));
await durable(path.join(directory, 'COVERAGE.json'), { classification: 'COMPLETE_OBLIGATION_STATUS_MAP_NOT_EXECUTED_COVERAGE', counts: { priorReferences: 88, families: 12, capRecipes: 18, ratifications: 7, selectors: 36 }, matrix });
const result = { classification: 'ADMISSION_HOLD_NOT_PRODUCT_ACCEPTANCE', recipe, ended: new Date().toISOString(), exitCode: 2, artifactAdmission,
  failure, a01: { qualified: 25, failed: 0, children: 25, reaped: 25, syntheticOnly: true },
  candidate: { admissionAttempts: 1, actualCohortInvocations: 0, actualModuleLoads: 0, runtimePass: 0, runtimeFail: 0,
    perLayout: { SOURCE: { pass: 0, fail: 0, unrun: perLayoutJobs, blocked: perLayoutJobs }, INSTALLED_MOVED: { pass: 0, fail: 0, unrun: perLayoutJobs, blocked: perLayoutJobs } },
    obligationsBlocked: 161, build: 0, typecompile: 0, native: 0 },
  children: { git: gitReceipts.length, reaped: gitReceipts.filter(receipt => receipt.reaped).length },
  integrity: { artifactCheck: artifactAdmission ? 'PASS append-aware, selected source/tools/moved artifacts; not actual loads' : 'NOT_ESTABLISHED', foreignIndexUntouched: true },
  retainedArtifact: artifactAdmission ? { ...binding.packed, authenticationOnly: true, independentBuild: false, independentNpmSerialization: false } : null,
  durationClaim: 'Only recorded timestamps; no 72-hour or full completion claim', historicalEvidenceUnchanged: true };
await durable(path.join(directory, 'RESULT.json'), result);
console.log(JSON.stringify({ classification: result.classification, artifactAdmission, exitCode: 2, perLayoutJobs, product: 0, failure: failure.message.slice(0, 700) }));
process.exitCode = 2;
