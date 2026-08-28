import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonHash, sha256, treeSnapshot } from './recipe/integrity.mjs';

const runtime = dirname(fileURLToPath(import.meta.url));
const repository = realpathSync(resolve(runtime, '../../../../..'));
const root = 'tests/commands/yq-independent-20260828';
const contractCommit = 'bd471ef682d768692a682d40009a874f51e3ad68';
const freezeCommit = 'f074c142411ba839cbd9da45a499cc798965149d';
const bindings = [];
function frozen(revision, path, id) {
  const bytes = execFileSync('git', ['show', `${revision}:${path}`], { cwd: repository, timeout: 5000, maxBuffer: 2097152 });
  assert.deepEqual(readFileSync(join(repository, path)), bytes, `Live data differs from frozen source: ${path}`);
  bindings.push({ id, revision, path, sha256: sha256(bytes), bytes: bytes.length, mode: lstatSync(join(repository, path)).mode & 0o7777 });
  return path.endsWith('.json') ? JSON.parse(bytes) : bytes;
}
const manifest = frozen(contractCommit, `${root}/final-carry-v1/MANIFEST.json`, 'final-manifest');
const sources = frozen(contractCommit, `${root}/final-carry-v1/SOURCES.json`, 'final-sources');
frozen(contractCommit, `${root}/final-carry-v1/CONTRACT.md`, 'final-contract');
frozen(contractCommit, `${root}/final-carry-v1/RESOURCE-TRACES.json`, 'final-traces');
const sourceIds = ['final', 'n-cases', 'reconciliation', 'qb-policy'];
for (const id of sourceIds) {
  const source = sources.sources.find((entry) => entry.id === id);
  assert(source, `Missing source ${id}`);
  frozen(source.revision, source.path, id);
}
frozen(freezeCommit, `${root}/freeze/recipes.mjs`, 'original-recipes-data-reference-only');
const membership = new Map();
const rows = [];
const roleCounts = {};
const semantic = 'command-semantic-runtime';
const admission = 'admission-error-boundary';
const source = 'source-static-counterproof';
const lifecycle = 'lifecycle-cooperative';
const roles = {
  CMD: { default: admission, overrides: { [semantic]: '01 02 03 21 22' } },
  PAR: { default: semantic }, NUM: { default: semantic },
  ENC: { default: semantic, overrides: { [source]: '08 09 10' } },
  QUE: { default: semantic, overrides: { [admission]: '03', [source]: '09 10 11' } },
  ALS: { default: semantic }, UTF: { default: semantic },
  WRK: { default: source, overrides: { [admission]: '01 02 03 04 09 10 14 19 25', [lifecycle]: '22' } },
  LIF: { default: lifecycle },
  FS: { default: admission, overrides: { [semantic]: '01 05', 'materialized-package-infrastructure': '06' } },
  MOV: { default: 'materialized-package-infrastructure' },
  TYP: { default: 'type-consumer', overrides: { [admission]: '05 06', [source]: '08' } },
  NEG: { default: 'negative-control' },
};
for (const group of manifest.coverage.groups) {
  const sourceBinding = sources.sources.find((entry) => entry.id === group.source);
  const packet = frozen(sourceBinding.revision, sourceBinding.path, sourceBinding.id);
  const requested = group.caseIds.split(' ');
  assert.deepEqual(packet.cases.map((entry) => entry.id), requested);
  for (const [index, original] of packet.cases.entries()) {
    const [prefix, number] = original.id.split('-');
    const map = roles[prefix];
    let primaryRole = map.default;
    for (const [role, identifiers] of Object.entries(map.overrides ?? {})) if (identifiers.split(' ').includes(number)) primaryRole = role;
    const overlayIndex = manifest.overlays.findIndex((overlay) => overlay.id === original.id);
    const hasBytes = ['argv', 'stdinUtf8', 'stdinHex', 'stdinChunksHex', 'stdinRecipe'].some((key) => key in original.input);
    const prepared = hasBytes && original.id !== 'WRK-25';
    const gaps = [];
    if (!prepared) gaps.push({ binding: `${sourceBinding.id}#/cases/${index}/input`, need: original.input.scenario ?? original.input.mutation ?? 'Named private counter projection; no approved runtime observer or executable concrete argv fixture.' });
    if (original.expect.assertions && !['UTF-22', 'QUE-07', 'FS-01', 'FS-05'].includes(original.id)) {
      for (const [assertionIndex, text] of original.expect.assertions.entries()) gaps.push({ binding: `${sourceBinding.id}#/cases/${index}/expect/assertions/${assertionIndex}`, need: text, scope: overlayIndex >= 0 ? 'Apply final overlay first; original text retained as lineage, never active override.' : 'Not fully established by byte/status projection; needs designated source/observer adapter.' });
    }
    for (const key of ['compileAttempts', 'queryRuns']) if (key in original.expect) gaps.push({ binding: `${sourceBinding.id}#/cases/${index}/expect/${key}`, need: `${key} needs source identity/count proof; no injected query instrumentation is declared.` });
    if (original.id === 'NUM-15') gaps.push({ binding: 'n-cases:N2-01#/expect/numeric', need: 'Private Decimal coefficient/exponent identity is source proof, not inferred from canonical output.' });
    if (overlayIndex >= 0 && ['NUM-14', 'NUM-15', 'ENC-07', 'UTF-12'].includes(original.id)) {
      for (let gapIndex = gaps.length - 1; gapIndex >= 0; gapIndex -= 1) if (gaps[gapIndex].scope?.startsWith('Apply final overlay')) gaps.splice(gapIndex, 1);
    }
    const secondaryRoles = ['fixture-data'];
    if (gaps.length && prepared) secondaryRoles.push(source);
    if (['QUE-09', 'QUE-10'].includes(original.id)) secondaryRoles.push(lifecycle);
    if (original.id === 'WRK-22') secondaryRoles.push(source);
    if (prefix === 'NEG' && Number(number) <= 3) secondaryRoles.push('fixture-data-integrity');
    const row = {
      id: original.id, category: original.category, primaryRole, secondaryRoles,
      frozen: { source: sourceBinding.id, path: sourceBinding.path, revision: sourceBinding.revision, pointer: `/cases/${index}`, recordSha256: jsonHash(original), inputSha256: jsonHash(original.input), defaultsSha256: jsonHash(packet.defaults ?? {}) },
      currentOverlay: overlayIndex < 0 ? null : `final-manifest#/overlays/${overlayIndex}`,
      preparation: prepared ? 'BYTE_CONTEXT_PROJECTION_PREPARED_NOT_EXECUTED' : 'MISSING_CASE_ADAPTER_BINDING',
      semanticDenominatorEligible: primaryRole === semantic,
      fullRecordEligibleAfterProjection: prepared && gaps.length === 0,
      runtimeProofRole: prepared ? 'direct-compiled-factory-handler-not-public-package' : null,
      missingBindings: gaps,
      result: 'PENDING_AUTHORIZED_CANDIDATE',
    };
    assert(!membership.has(row.id));
    membership.set(row.id, row);
    rows.push(row);
    roleCounts[primaryRole] = (roleCounts[primaryRole] ?? 0) + 1;
  }
}
assert.equal(rows.length, 194);
assert.equal(manifest.overlays.length, 8);
const inventory = {
  schemaVersion: 1, date: '2026-08-28', classification: 'PREPARATION_NOT_EXECUTED',
  contractCommit, independentReview: 'de89e478d8ddce62eac955708f1b87d7be1bd137', freezeCommit,
  baseline: '5137a74ec855a32d8a8860eb66b62eb44d11e290', acceptedLength: '74361026502d76b8c2b696f9c60e410ac9b78d95',
  count: rows.length, overlays: manifest.overlays.map((overlay) => overlay.id), roleCounts,
  denominators: {
    inventory: 194, semanticEligibleIds: rows.filter((row) => row.semanticDenominatorEligible).length,
    preparedRecordProjections: rows.filter((row) => row.runtimeProofRole).length,
    preparedSemanticProjections: rows.filter((row) => row.runtimeProofRole && row.semanticDenominatorEligible).length,
    completeSemanticRecordsEligibleAfterAllVariants: rows.filter((row) => row.fullRecordEligibleAfterProjection && row.semanticDenominatorEligible).length,
    executed: 0, semanticPasses: 0,
    rule: 'Report selected observable projections separately. All variants must pass for one ID projection; missing private assertions prevent full-record credit. Admission/source/type/package/data/controls never enter the semantic denominator. QB64/N32/N36 add zero runtime IDs.',
  },
  rows,
};
const scopes = [...new Set(bindings.filter((binding) => !binding.path.includes('qb-policy')).map((binding) => dirname(binding.path)))].sort().map((path) => ({ path, entries: treeSnapshot(join(repository, path)) }));
const sourceManifest = { schemaVersion: 1, contractCommit, bindings, scopes };
process.stdout.write('*** Begin Patch\n');
for (const [name, value] of [['inventory.json', inventory], ['source-bindings.json', sourceManifest]]) {
  const path = `${root}/executor-preparation-v1/runtime/recipe/${name}`;
  const body = Object.entries(value).map(([key, entry]) => `  ${JSON.stringify(key)}: ${Array.isArray(entry) ? `[\n${entry.map((row) => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]` : JSON.stringify(entry)}`).join(',\n');
  process.stdout.write(`*** Add File: ${path}\n${`{\n${body}\n}\n`.trimEnd().split('\n').map((line) => `+${line}`).join('\n')}\n`);
}
process.stdout.write('*** End Patch\n');
