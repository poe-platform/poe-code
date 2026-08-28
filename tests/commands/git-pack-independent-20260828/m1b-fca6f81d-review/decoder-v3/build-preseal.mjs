import fs from 'node:fs';
import { createHash } from 'node:crypto';

const base = 'tests/commands/git-pack-independent-20260828/m1b-fca6f81d-review';
const sourceCommit = 'c90ad78b9ed27f83ed5ba8dd0ca1a548e0e1629f';
const sha = value => createHash('sha256').update(value).digest('hex');
const body = name => fs.readFileSync(base + '/' + name);
const json = name => JSON.parse(body(name));
const serialize = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function demand(condition, label) { if (!condition) throw new Error(label); }
function identity(name, bytes = body(name)) { return { path: name, mode: 420, bytes: bytes.length, sha256: sha(bytes) }; }
demand(sha(body('RECIPE-v2.json')) === 'a4c3fab089d7c2a957f4d263298a153b7cdea3d856c9820b5c90f6b0f2d591a6', 'OLD_RECIPE');
demand(sha(body('FINAL-SEAL-v2.json')) === 'd23931c1dcf4127cc075a99e603c6a78e5a509a8feff084cd4599137b6f5d309', 'OLD_SEAL');
const originalRecipe = json('RECIPE-v2.json');
const recipe = structuredClone(originalRecipe);
const assembly = json('ASSEMBLY-v2.json');
const closure = json('EXECUTABLE-CLOSURE-v2.json');
const oldSeal = json('FINAL-SEAL-v2.json');
const decoder = json('decoder-v3/SEAL.json');
const dataResult = json('decoder-v3/DATA-01/492.json');
demand(dataResult.status === 'PASS_DATA_ONLY' && dataResult.results.length === 245 && dataResult.results.every(row => row.passed), 'ALL_DATA_PASS');
for (const row of [...decoder.source, ...decoder.observations]) {
  const bytes = body('decoder-v3/' + row.path);
  demand(bytes.length === row.bytes && sha(bytes) === row.sha256, 'DECODER_SEAL_ENTRY');
}
for (const name of ['outer', 'launch']) {
  let expected = body('runner/v2/' + name + '.mjs').toString('utf8').replaceAll('RECIPE-v2.json', 'RECIPE-v3.json').replaceAll('FINAL-SEAL-v2.json', 'FINAL-SEAL-v3.json').replaceAll('runner/v2/launch.mjs', 'runner/v3/launch.mjs');
  if (name === 'launch') expected = expected.replace('recipe.caps.captureBytes === 268435456', 'recipe.caps.captureBytes === 255852544');
  demand(body('runner/v3/' + name + '.mjs').equals(Buffer.from(expected)), 'ROUTING_AND_COMBINED_CAP_ONLY');
}
const replacements = new Map([
  ['semantic/fixtures.mjs', 'decoder-v3/fixtures.mjs'],
  ['runner/outer.mjs', 'runner/v3/outer.mjs'],
  ['runner/launch.mjs', 'runner/v3/launch.mjs']
]);
const changes = [];
for (const entry of assembly.files) {
  const replacement = replacements.get(entry.path);
  if (!replacement) continue;
  const previous = structuredClone(entry);
  const bytes = body(replacement);
  Object.assign(entry, { sourcePath: base + '/' + replacement, sourceCommit, blob: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'), mode: 420, bytes: bytes.length, sha256: sha(bytes) });
  changes.push({ path: entry.path, before: previous, after: entry });
}
demand(changes.length === 3, 'EXACT_THREE_ASSEMBLY_CHANGES');
assembly.selectionAuthority = 'ROOT_AUTHORIZED_EXPLICIT_DECODER_SUCCESSOR; previous be69c4d8 remains stopped/unrescored';
assembly.sourcePreparation = '245 DATA checks passed; no target outcome inherited. Exact original18 byte bindings; all160 fixture declarations constructed.';
assembly.counts.bytes = assembly.files.reduce((sum, entry) => sum + entry.bytes, 0);
assembly.predecessor = { commit: '64d76feb39275e4fa9d7e820c02eb48aaa68849b', sha256: sha(body('ASSEMBLY-v2.json')) };
const assemblyBytes = serialize(assembly);
const rowIdentity = entry => ({ path: entry.path, mode: entry.mode, bytes: entry.bytes, sha256: entry.sha256 });
for (const entry of recipe.harness.files) if (replacements.has(entry.path)) Object.assign(entry, rowIdentity(assembly.files.find(row => row.path === entry.path)));
recipe.harness.sha256 = sha(JSON.stringify(recipe.harness.files));
recipe.assembly = identity('ASSEMBLY-v3.json', assemblyBytes);
recipe.bootstrapFiles = ['outer', 'launch'].map(name => identity('runner/v3/' + name + '.mjs'));
recipe.caps.captureBytes = 255852544;
recipe.authority = 'ROOT_CONDITIONAL_FRESH_ONE_REVIEW_AFTER_245_DATA_PASS; SAME_PRODUCT_AND274_CALLS';
recipe.components.push({ name: 'neutral-decoder-v3', sourceCommit: '5b7290ff14dec6af96bcdbde25d6c73ec8da8500', evidenceCommit: '9273c71437a36be97bc4eb5db5640131cd9543b4', sealPath: 'decoder-v3/SEAL.json', sealSha256: sha(body('decoder-v3/SEAL.json')) });
recipe.accounting.successorCombined = { runtimeCaptureBytes: 255852544, dataCaptureCeilingBytes: 1048576, sourceBindingCaptureCeilingBytes: 3145728, finalizationMetadataCaptureCeilingBytes: 8388608, combinedCaptureBytes: 268435456, dataProcesses: 1, sourceCheckProcessesIncludingMetadataCeiling: 10, routingProcesses: 1, archiveCleanupProcesses: 1, runtimeProcessesIncludingOuter: 65, combinedDeclaredProcesses: 78, peak: 4, temporaryEvidenceWorkingReservationBytes: 16777216, logicalWorkingCeilingIncludingPreparation: recipe.accounting.working.totalLiveCeilingWithFull256MiBCapture + 16777216, authority: 'No new allowance; runtime capture capped at244MiB, remaining12MiB reserved explicitly. Exact product24limits unchanged.' };
for (const entry of closure.parent) if (replacements.has(entry.path)) Object.assign(entry, rowIdentity(assembly.files.find(row => row.path === entry.path)));
closure.worker = recipe.harness.files;
closure.selectedAssembly = recipe.assembly;
closure.sourceCommit = sourceCommit;
closure.codeClosureSha256 = sha(JSON.stringify(closure.parent));
closure.proofRole = 'SOURCE/DATA_ONLY; explicit decoder plus routing names and stricter combined capture, no target proof';
recipe.requiredReviews = recipe.requiredReviews.map(row => row.component === 'complete-executor-v2' ? { component: 'complete-executor-v3', sourceSeal: closure.codeClosureSha256 } : row);
recipe.requiredReviews.push({ component: 'neutral-decoder-v3', sourceSeal: sha(body('decoder-v3/SEAL.json')) });
recipe.reviewStatus = { predecessor: 'be69c4d85f74ea2f3442f5fe03164dc60efdd8a8', data: '245/245 DATA_ONLY; sameexpectations; ALL160variants constructed', directHarnessReview: 'No additionalCLIagents; newfixture authored/reviewed directly, not externally signed fixtureconformance', runtime: 'UNRUN_NEW_AUTHORIZATION_NOT_OLD_RESCORE' };
demand(JSON.stringify(recipe.batches) === JSON.stringify(originalRecipe.batches) && JSON.stringify(recipe.caseManifests) === JSON.stringify(originalRecipe.caseManifests) && JSON.stringify(recipe.typeFixtures) === JSON.stringify(originalRecipe.typeFixtures) && JSON.stringify(recipe.mutants) === JSON.stringify(originalRecipe.mutants), 'UNCHANGED_CALLS_TYPES_MUTANTS');
const recipeBytes = serialize(recipe);
const closureBytes = serialize(closure);
const receipt = { schema: 'm1b-direct-prelaunch-review-v3', disposition: 'PRELAUNCH_COMPONENT_REVIEW_COMPLETE', role: 'DIRECT_HARNESS_SOURCE_AND_DATA_QUALIFICATION_NOT_PRODUCT_ACCEPTANCE', productSource: recipe.sourceCommit, sourceCommit, recipeSha256: sha(recipeBytes), components: recipe.requiredReviews, unchangedCalls: 274, S01Calls: 21, dataChecks: 245, dataRole: 'DECLARATIONS_AND_CONSTRUCTORS_NOT_TARGET', externalFixtureReviewerClaim: false, priorOutcome: 'be69c4d8 remains FAIL/zero product loads/274unfulfilled', limits: recipe.accounting.successorCombined };
const receiptBytes = serialize(receipt);
const seal = { schema: oldSeal.schema, status: 'COMPLETE_SELECTED_PRESEAL', date: '2026-08-28', sourceCommit, controlCommit: sourceCommit, candidate: oldSeal.candidate, history: ['be69c4d85f74ea2f3442f5fe03164dc60efdd8a8', '64d76feb39275e4fa9d7e820c02eb48aaa68849b'], assembly: recipe.assembly, recipe: identity('RECIPE-v3.json', recipeBytes), executableClosure: identity('EXECUTABLE-CLOSURE-v3.json', closureBytes), parentClosureSha256: closure.codeClosureSha256, workerProjectionSha256: recipe.harness.sha256, files: [], documents: [], scope: oldSeal.scope, projectionGuards: oldSeal.projectionGuards, requiredReviews: recipe.requiredReviews, reviewDisposition: 'DIRECT_SOURCE_DATA_COMPLETE; ACTUAL_UNRUN', bounds: recipe.accounting, preparation: { dataChecks: 245, actorRuns: 0, targetLoads: 0, sourceBindingCheck: 'PRELAUNCH_REQUIRED' }, selfReference: oldSeal.selfReference };
const controlIdentities = [recipe.assembly, seal.recipe, seal.executableClosure, identity('decoder-v3/REVIEW.json', receiptBytes), identity('decoder-v3/SEAL.json'), identity('decoder-v3/INPUTS.json'), identity('decoder-v3/EXPECTED-BYTES.json'), identity('decoder-v3/NEUTRAL-ORIGINAL.json.data'), identity('decoder-v3/DATA-01/492.json')];
seal.files = [...controlIdentities, ...assembly.files.map(row => ({ path: row.sourcePath.slice(base.length + 1), mode: row.mode, bytes: row.bytes, sha256: row.sha256 }))].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
const generated = [['ASSEMBLY-v3.json', assemblyBytes], ['RECIPE-v3.json', recipeBytes], ['EXECUTABLE-CLOSURE-v3.json', closureBytes], ['decoder-v3/REVIEW.json', receiptBytes], ['decoder-v3/EXECUTOR-DELTA.json', serialize({ sourceCommit, changes, unchangedAssemblyEntries: 52, callsUnchanged: true, toolsUnchanged: true, productUnchanged: true, combinedLimits: recipe.accounting.successorCombined })], ['FINAL-SEAL-v3.json', serialize(seal)]];
process.stdout.write('*** Begin Patch\n' + generated.map(([name, bytes]) => '*** Add File: ' + base + '/' + name + '\n' + bytes.toString('utf8').replace(/\n$/, '').split('\n').map(line => '+' + line).join('\n') + '\n').join('') + '*** End Patch\n');
