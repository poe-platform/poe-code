import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { recipe, scope, repository, history, frozen, candidate, freeze, packSha, node, sha, read, fileHash, fileMap, git, bindReference, authenticateTools, authenticateSelected } from './common.mjs';

const prefix = relative(repository, recipe), historyPrefix = relative(repository, history), frozenPrefix = relative(repository, frozen);
const references = [], closedInventories = {};
function bind(commit, path, expected) { const row = bindReference(commit, path, expected); if (!references.some(old => old.path === path)) references.push(row); return row; }
function sealData(name, data) {
  const target = `${prefix}/${name}`; assert.equal(fs.existsSync(join(repository, target)), false);
  const content = `${JSON.stringify(data, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${target}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  execFileSync('apply_patch', [patch], { cwd: repository });
}
const authorCommit = 'f397901033d47537a5671bfc202cd8111902b526';
const handoffPath = 'tests/plugins/du-public-author/evidence-v1/REVIEW-HANDOFF.json';
bind(authorCommit, handoffPath, '1ff91fcf815f57a895bf46d4aeca8e5da488971d918009dbb1d24b356e7f5b8a');
const handoff = read(join(repository, handoffPath));
assert.equal(handoff.candidateCommit, candidate); assert.equal(handoff.package.tarballSha256, packSha);
bind(freeze, `${frozenPrefix}/MANIFEST.json`, 'b180b9a384bdc3d257b243d315027a59ae792865a572b877dbe547f99149f6ff');
const frozenManifest = read(join(frozen, 'MANIFEST.json'));
for (const row of frozenManifest.files) bind(freeze, `${frozenPrefix}/${row.path}`, row.sha256);
closedInventories[frozenPrefix] = fileMap(frozen);
assert.equal(Object.keys(closedInventories[frozenPrefix]).length, 15);
for (const field of ['sourcePathsAndPolicy', 'aggregateDuOptions', 'diagnostics', 'outputOperationIntegration']) bind(authorCommit, handoff[field].path, handoff[field].sha256);
const duFixture = 'tests/plugins/du-public-author/consumer.ts.fixture';
bind(candidate, duFixture);
for (const path of ['src/plugins/index.ts', 'src/commands/html-to-markdown/options.ts', 'src/commands/du/options.ts']) {
  const entry = handoff.sourceInventory.find(row => row.path === path);
  assert.ok(entry, path); assert.equal(sha(git('cat-file', 'blob', entry.gitBlob)), entry.sha256);
}
const htmlCommit = '9d84903356a4c33402814bdc367e3bbe9894d1c2';
const htmlPrefix = 'tests/integration/html-public-independent-20260827/actual34-v1';
bind(htmlCommit, `${htmlPrefix}/EVIDENCE-MANIFEST.json`);
const htmlManifest = read(join(repository, htmlPrefix, 'EVIDENCE-MANIFEST.json'));
for (const [path, digest] of Object.entries(htmlManifest.files)) bind(htmlCommit, `${htmlPrefix}/${path}`, digest);
const htmlSummary = read(join(repository, htmlPrefix, 'SUMMARY.json'));
assert.equal(htmlSummary.candidate, 'aff899aa94ed0c57a936b08fd36d185688f5c0bb');
assert.equal(htmlSummary.counts.runtimePassed, 68); assert.equal(htmlSummary.counts.runtimeFailed, 0);
assert.equal(htmlSummary.counts.typesExpected, 10);
assert.equal(htmlSummary.status, 'FROZEN_ASSERTIONS_PASSED_WITH_ORIGINAL_UNSCORED_LIMITS');
const htmlOriginalPrefix = 'tests/integration/html-public-independent-20260827';
for (const path of ['public.mjs', 'contract.mjs']) bind('54f1e4d819e0d3cde422c1f305a84474932e3bac', `${htmlOriginalPrefix}/${path}`);
const htmlSource = git('show', 'aff899aa94ed0c57a936b08fd36d185688f5c0bb:src/commands/html-to-markdown/options.ts');
assert.match(htmlSource.toString(), /maxInputBytes/u);
const admissionCommit = '5508a2a236763754be97baf7347a36ce27e5ef92';
bind(admissionCommit, `${historyPrefix}/admission-v3-evidence-manifest.json`, 'd369aa59e1e92c4dde6140bd22f230239e93a24b1d81f69f8ba6627511463489');
const admissionManifest = read(join(history, 'admission-v3-evidence-manifest.json'));
for (const row of admissionManifest.files) bind(admissionCommit, `${historyPrefix}/${row.path}`, row.sha256);
for (const path of ['preparation.v1.json', 'admission-v2/closure.json', 'admission-v2/tool-observer.cjs']) bind(admissionCommit, `${historyPrefix}/${path}`);
const oldHoldPrefix = `${historyPrefix}/public29-binding-review-01`;
for (const name of ['REPORT.json', 'HANDOFF.md', 'MANIFEST.json']) bind('3e02038d41c5b2307a8d7c8bb36557fd309d4dc1', `${oldHoldPrefix}/${name}`);
closedInventories[oldHoldPrefix] = fileMap(join(repository, oldHoldPrefix));
for (const row of read(join(recipe, 'ADAPTERS.json')).mappings) {
  let original = fs.readFileSync(join(repository, row.source), 'utf8'); assert.equal(sha(original), row.originalSha256);
  for (const [before, after] of row.replacements) { assert.ok(original.includes(before)); original = original.replace(before, after); }
  assert.equal(sha(original), row.adaptedSha256); assert.equal(fileHash(join(recipe, row.destination)), row.adaptedSha256);
}
const closure = read(join(history, 'admission-v2/closure.json'));
const binaries = [...closure.binaries, { path: '/usr/bin/git', realpath: fs.realpathSync('/usr/bin/git'), sha256: fileHash('/usr/bin/git'), version: 'pinned Apple Git dispatch binary' }];
const preparation = read(join(history, 'preparation.v1.json'));
const bindings = {
  schema: 'du-public29-execution-binding/1', preparedAt: new Date().toISOString(), chronology: 'postcandidate-preexecution', candidate, candidateTree: handoff.candidateTree,
  freeze, freezeManifestSha256: handoff.freezeManifest.sha256, sourceInventory: handoff.sourceInventory, selectors: preparation.selectors,
  packageFiles: handoff.packageFiles, pack: { path: handoff.package.authorArtifactPath, sha256: packSha, bytes: 726693 },
  protectedFiles: references, closedInventories, closure, binaries,
  acceptedHtml: { commit: htmlCommit, recipe: '7885ce6a043653eeacbf4dd885f1c59ee570b5a7', candidate: htmlSummary.candidate, summaryPath: `${htmlPrefix}/SUMMARY.json`, summarySha256: fileHash(join(repository, htmlPrefix, 'SUMMARY.json')), manifestSha256: fileHash(join(repository, htmlPrefix, 'EVIDENCE-MANIFEST.json')), installed: 34, moved: 34, sameCases: true, priorQualificationsRetained: true },
  acceptedAdmission: { commit: admissionCommit, recipe: '436173fcec6787f17f167e03a3b789bf6485e9e5', manifestSha256: 'd369aa59e1e92c4dde6140bd22f230239e93a24b1d81f69f8ba6627511463489', fullPackReproduced: packSha, selectedInputs: 771, members: 834, profile: 'scoped-committed-archive-not-full-history' },
  missingExportType: { exitCode: 2, diagnostics: [{ line: 9, code: 2307, mentions: 'virtual-bash/commands/du' }] },
  r07: { path: `${prefix}/R07.json`, sha256: fileHash(join(recipe, 'R07.json')), htmlSourceOptionsSha256: sha(htmlSource), htmlFixture: references.find(row => row.path === `${htmlOriginalPrefix}/public.mjs`), duFixture: references.find(row => row.path === duFixture) },
};
authenticateTools(bindings); authenticateSelected(bindings);
assert.equal(fileHash(bindings.pack.path), packSha);
const identity = name => ({ path: `${prefix}/${name}`, sha256: fileHash(join(recipe, name)) });
const document = {
  schemaVersion: 1, state: 'root-authorized-public-replay', fixedScope: preparation.fixedScope,
  required: {
    candidateCommit: candidate, freezeCommit: freeze, freezeManifestSha256: bindings.freezeManifestSha256, sourceInventory: bindings.sourceInventory,
    html74Checkpoint: { ...handoff.html74Checkpoint, evidence: { path: `${htmlPrefix}/EVIDENCE-MANIFEST.json`, sha256: bindings.acceptedHtml.manifestSha256 }, acceptedActualEvidenceCommit: htmlCommit },
    approved75Inventory: { names: handoff.declared75Inventory.names, approval: identity('ROOT-AUTHORIZATION.md') },
    sourcePathsAndPolicy: handoff.sourcePathsAndPolicy, aggregateDuOptions: handoff.aggregateDuOptions, diagnostics: handoff.diagnostics,
    outputOperationIntegration: handoff.outputOperationIntegration, supervisorIdentity: identity('executor.mjs'),
    toolIdentities: binaries,
    admissionPolicy: { ...identity('RECIPE.md'), mode: 'scoped-committed-archive', postRunDetectsNewEntries: true },
    replayAuthorization: { ...identity('ROOT-AUTHORIZATION.md'), candidateCommit: candidate, freezeCommit: freeze },
  },
};
const { assertReplayBindings } = await import('./binding-contract.mjs'); assertReplayBindings(document);
sealData('BINDINGS.json', bindings); sealData('replay-bindings.json', document);
console.log(JSON.stringify({ preparedAt: bindings.preparedAt, actualCasesExecuted: 0, protectedFiles: references.length, originalFiles: 15, sourceInventory: 771, packageMembers: Object.keys(bindings.packageFiles).length, r07: bindings.r07, tools: authenticateTools(bindings) }));
