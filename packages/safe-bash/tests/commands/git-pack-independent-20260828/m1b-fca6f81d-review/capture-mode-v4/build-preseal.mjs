import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { captureIdentity } from './mode-authority.mjs';

const base = 'tests/commands/git-pack-independent-20260828/m1b-fca6f81d-review';
const sourceCommit = 'dcdaa7c12d5b3924d3f605014dd701fc60e7be84';
const sha = value => createHash('sha256').update(value).digest('hex');
const body = name => fs.readFileSync(base + '/' + name);
const json = name => JSON.parse(body(name));
const serialize = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function demand(condition, label) { if (!condition) throw new Error(label); }
function sourceIdentity(name, bytes = body(name)) {
  return { path: name, mode: 0o644, bytes: bytes.length, sha256: sha(bytes) };
}
demand(sha(body('RECIPE-v3.json')) === '98cbfd6cfea24483a2b32ffd0f696971e59b8e588aa6ba82f81214afc50f5a72', 'V3_RECIPE');
demand(sha(body('FINAL-SEAL-v3.json')) === '753dec0aa57020e60017c5652fd78c27de8478d26d91625227be4288b6e8579f', 'V3_SEAL');
const oldRecipe = json('RECIPE-v3.json');
const recipe = structuredClone(oldRecipe);
const assembly = json('ASSEMBLY-v3.json');
const closure = json('EXECUTABLE-CLOSURE-v3.json');
const oldSeal = json('FINAL-SEAL-v3.json');
const modeResult = json('capture-mode-v4/DATA-01/RESULT.json');
demand(modeResult.status === 'PASS_DATA_ONLY' && modeResult.controls.length === 12 && modeResult.controls.every(row => row.passed) && modeResult.captureRowsVerified === 492 && modeResult.allMetadataChildrenKnownRetired, 'MODE_PROOF_COMPLETE');
const modeProof = json('capture-mode-v4/DATA-01/CAPTURE-MODES.json');
const archived = json('decoder-v3/SEAL.json');
demand(sha(body('decoder-v3/SEAL.json')) === modeProof.authority.archiveSha256 && sha(body('decoder-v3/check-data.mjs')) === modeProof.authority.creationSourceSha256, 'MODE_BOUND_PROVENANCE');
const captureRows = archived.observations.map(row => {
  const filename = 'decoder-v3/' + row.path;
  const stat = fs.lstatSync(base + '/' + filename);
  demand(stat.isFile() && !stat.isSymbolicLink(), 'CAPTURE_REGULAR');
  const bytes = body(filename);
  const observed = { path: row.path, mode: stat.mode & 0o777, bytes: bytes.length, sha256: sha(bytes) };
  const bound = captureIdentity(row, observed, modeProof.authority);
  return { ...bound, path: filename };
});
demand(captureRows.length === 492, 'ALL_CAPTURE_MODES');
const changes = [];
for (const name of ['outer', 'launch']) {
  const oldName = 'runner/v3/' + name + '.mjs';
  const newName = 'runner/v4/' + name + '.mjs';
  const bytes = body(newName);
  const expected = body(oldName).toString('utf8').replaceAll('RECIPE-v3.json', 'RECIPE-v4.json').replaceAll('FINAL-SEAL-v3.json', 'FINAL-SEAL-v4.json').replaceAll('runner/v3/launch.mjs', 'runner/v4/launch.mjs');
  demand(bytes.equals(Buffer.from(expected)), 'ONLY_VERSION_ROUTING');
  const entry = assembly.files.find(row => row.path === 'runner/' + name + '.mjs');
  const before = structuredClone(entry);
  Object.assign(entry, { sourcePath: base + '/' + newName, sourceCommit, blob: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'), mode: 0o644, bytes: bytes.length, sha256: sha(bytes) });
  changes.push({ path: entry.path, before, after: entry });
}
assembly.selectionAuthority = 'ROOT_CAPTURE_MODE_SUCCESSOR; original9321a668 remains stopped/unrescored';
assembly.predecessor = { commit: 'f2d4a49950063d8e3315775805ebc60fe2ac0dd5', sha256: sha(body('ASSEMBLY-v3.json')) };
assembly.counts.bytes = assembly.files.reduce((sum, row) => sum + row.bytes, 0);
const assemblyBytes = serialize(assembly);
const rowIdentity = row => ({ path: row.path, mode: row.mode, bytes: row.bytes, sha256: row.sha256 });
for (const row of closure.parent) {
  const change = changes.find(item => item.path === row.path);
  if (change) Object.assign(row, rowIdentity(change.after));
}
recipe.assembly = sourceIdentity('ASSEMBLY-v4.json', assemblyBytes);
recipe.bootstrapFiles = ['outer', 'launch'].map(name => sourceIdentity('runner/v4/' + name + '.mjs'));
closure.selectedAssembly = recipe.assembly;
closure.sourceCommit = sourceCommit;
closure.codeClosureSha256 = sha(JSON.stringify(closure.parent));
closure.proofRole = 'SOURCE/DATA_ONLY; capture-mode authority and routing version only';
recipe.requiredReviews = recipe.requiredReviews.map(row => row.component === 'complete-executor-v3' ? { component: 'complete-executor-v4', sourceSeal: closure.codeClosureSha256 } : row);
recipe.requiredReviews.push({ component: 'capture-mode-v4', sourceSeal: sha(body('capture-mode-v4/DATA-SEAL.json')) });
recipe.authority = 'ROOT_FRESH_ONE_REVIEW_AFTER_CAPTURE_MODE_DATA_PASS; SAME_PRODUCT_AND274_CALLS';
recipe.accounting.successorCombined.dataProcesses = 4;
recipe.accounting.successorCombined.sourceCheckProcessesIncludingMetadataCeiling = 11;
recipe.accounting.successorCombined.combinedDeclaredProcesses = 82;
recipe.accounting.successorCombined.authoringMetadataAndSealHelperCeiling = 40;
recipe.accounting.successorCombined.combinedIncludingAuthoringCeiling = 122;
recipe.reviewStatus = { predecessor: '9321a668418ae532341dd3882a2982471d592eda', priorData: '245 passed historically; not rescored', modeData: '12/12 controls and492 authenticated original capture roles', runtime: 'UNRUN_NEW_AUTHORITY' };
demand(JSON.stringify(recipe.harness) === JSON.stringify(oldRecipe.harness), 'UNCHANGED_WORKER_CLOSURE');
for (const key of ['batches', 'caseManifests', 'typeFixtures', 'mutants', 'data', 'caps', 'phaseEndsMs', 'reservations']) demand(JSON.stringify(recipe[key]) === JSON.stringify(oldRecipe[key]), 'UNCHANGED_' + key);
const recipeBytes = serialize(recipe);
const closureBytes = serialize(closure);
const review = { schema: 'm1b-direct-prelaunch-review-v4', disposition: 'PRELAUNCH_COMPONENT_REVIEW_COMPLETE', role: 'DIRECT_SOURCE_DATA_NOT_PRODUCT_ACCEPTANCE', productSource: recipe.sourceCommit, sourceCommit, recipeSha256: sha(recipeBytes), components: recipe.requiredReviews, unchangedCalls: 274, S01Calls: 21, modeControls: 12, originalCaptureRows: 492, old245Rescored: false, externalFixtureReviewerClaim: false, limits: recipe.accounting.successorCombined };
const reviewBytes = serialize(review);
const seal = { ...oldSeal, sourceCommit, controlCommit: sourceCommit, history: [...oldSeal.history, '9321a668418ae532341dd3882a2982471d592eda'], assembly: recipe.assembly, recipe: sourceIdentity('RECIPE-v4.json', recipeBytes), executableClosure: sourceIdentity('EXECUTABLE-CLOSURE-v4.json', closureBytes), parentClosureSha256: closure.codeClosureSha256, workerProjectionSha256: recipe.harness.sha256, requiredReviews: recipe.requiredReviews, bounds: recipe.accounting, preparation: { modeControls: 12, originalCaptureRows: 492, old245Rescored: false, targetLoads: 0, fullPreflight: 'REQUIRED_BEFORE_LAUNCH' } };
const controls = [recipe.assembly, seal.recipe, seal.executableClosure, sourceIdentity('capture-mode-v4/REVIEW.json', reviewBytes), sourceIdentity('capture-mode-v4/DATA-SEAL.json'), sourceIdentity('decoder-v3/SEAL.json'), sourceIdentity('decoder-v3/INPUTS.json'), sourceIdentity('decoder-v3/EXPECTED-BYTES.json'), sourceIdentity('decoder-v3/NEUTRAL-ORIGINAL.json.data')];
seal.files = [...controls, captureRows.find(row => row.path === 'decoder-v3/DATA-01/492.json'), ...assembly.files.map(row => ({ path: row.sourcePath.slice(base.length + 1), mode: row.mode, bytes: row.bytes, sha256: row.sha256 }))].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
seal.modeRoles = { sourceAndGeneratedControl: 'POSIX0644; active stored members separately authenticate Git100644', capture: [{ path: 'decoder-v3/DATA-01/492.json', authority: modeProof.authority, archive: 'decoder-v3/SEAL.json' }], nestedCaptureArchives: ['decoder-v3/SEAL.json', 'capture-mode-v4/DATA-SEAL.json'], noPermissionMutation: true };
const generated = [['ASSEMBLY-v4.json', assemblyBytes], ['RECIPE-v4.json', recipeBytes], ['EXECUTABLE-CLOSURE-v4.json', closureBytes], ['capture-mode-v4/REVIEW.json', reviewBytes], ['capture-mode-v4/EXECUTOR-DELTA.json', serialize({ sourceCommit, changes, unchangedAssemblyEntries: 53, productUnchanged: true, fixturesUnchanged: true, callsUnchanged: true, modeAuthority: modeProof.authority })], ['FINAL-SEAL-v4.json', serialize(seal)]];
process.stdout.write('*** Begin Patch\n' + generated.map(([name, bytes]) => '*** Add File: ' + base + '/' + name + '\n' + bytes.toString('utf8').replace(/\n$/, '').split('\n').map(line => '+' + line).join('\n') + '\n').join('') + '*** End Patch\n');
