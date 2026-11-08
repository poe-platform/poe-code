import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { blob, control, counts, directory, foreignStaging, frozenCases, git, gitHash, inherited, inventory, json, own, pins, repo, save, sha256 } from './common.mjs';
import { coverage } from './mapping.mjs';

const identify = (commit, path, exposure) => {
  const bytes = blob(commit, path);
  return { commit, path, blob: gitHash('blob', bytes), sha256: sha256(bytes), bytes: bytes.length, exposure };
};
const pathsAt = (commit, path) => git(['ls-tree', '-r', '--name-only', commit, '--', path]).toString().trim().split('\n').filter(Boolean);
const providerRoot = 'tests/fs/webdav/directory-access-independent-20260828';
const authorRoot = 'tests/shell/cd-prerequisite-20260828';
const providerReview = `${providerRoot}/review-ca1d3342`;

if (process.argv[2] === '--inputs') {
  const originals = inherited();
  const oldPaths = pathsAt(pins.binding, control);
  const inputs = oldPaths.map(path => identify(pins.binding, path, 'inherited immutable data/code; no old executor or old auditor execution'));
  inputs.push(identify(pins.baseline, 'src/shell/types.ts', 'accepted public declarations read; no implementation body or product import'));
  for (const name of ['common.mjs', 'prepare.mjs', 'run-v3.mjs', 'boot.mjs', 'REPRO.md']) inputs.push(identify(pins.providerReview, `${providerReview}/${name}`, name === 'boot.mjs' || name === 'REPRO.md' ? 'pinned old utility read, never executed' : 'pinned old utility excerpts read, whole-file hash only'));
  const ratification = json(resolve(directory, '../ratification-v3/BINDING.json'));
  for (const entry of [ratification.policy, ...ratification.profiles]) {
    const identified = identify(entry.commit, entry.path, 'inherited normative policy binding; committed hash authentication');
    assert.equal(identified.blob, entry.blob); assert.equal(identified.sha256, entry.sha256);
    inputs.push(identified);
  }
  const native = pathsAt(pins.nativeEvidence, authorRoot).map(path => identify(pins.nativeEvidence, path, 'historical native record hash only; not extracted or executed'));
  for (const path of pathsAt(pins.nativeFreeze, authorRoot)) assert.deepEqual(blob(pins.nativeFreeze, path), blob(pins.nativeEvidence, path), `native preseal changed at evidence commit: ${path}`);
  const provider = pathsAt(pins.providerReview, providerRoot).map(path => identify(pins.providerReview, path, 'historical provider record hash only; not executed'));
  const protectedFiles = [...native, ...provider, ...inputs.filter(entry => entry.path.startsWith(`${authorRoot}/`))];
  for (const entry of protectedFiles) assert.equal(sha256(readFileSync(resolve(repo, entry.path))), entry.sha256, `historical record changed: ${entry.path}`);
  const old18 = pathsAt(pins.freeze, control);
  assert.equal(old18.length, 18);
  for (const path of old18) assert.deepEqual(blob(pins.freeze, path), blob(pins.binding, path));
  const commits = [...new Set([...Object.entries(pins).filter(([key]) => key !== 'composition').map(([, value]) => value), ...inputs.map(entry => entry.commit)])].map(commit => {
    const bytes = git(['cat-file', 'commit', commit]); assert.equal(gitHash('commit', bytes), commit);
    return { commit, sha256: sha256(bytes), bytes: bytes.length, metadata: bytes.toString() };
  });
  save(resolve(directory, 'INPUTS.json'), { schema: 1, capturedAt: new Date().toISOString(), classification: 'post-author-release preparation; no candidate inspection', pins, counts, inputs, commits, inheritedInventory: originals, original18: old18, ratification4: oldPaths.filter(path => !old18.includes(path)), protectedFiles, providerRoot, providerInventoryBefore: inventory(resolve(repo, providerRoot)), foreignStagingBefore: foreignStaging(), inheritedExposure: `${control}/EXPOSURES-v1.json`, currentTurnSourceExposure: 'accepted5137 src/shell/types.ts declarations only; no current or unrouted implementation bodies', noClaimAboutUnseenScratch: true });
  const data = await frozenCases();
  const invariantMappings = [
    ['exact VFS ordinal guard; delegated X_OK; final cwd', 'native chdir, ACL synthesis and directory-stack nonmutation need source review'],
    ['readonly partial/final state and final output bytes', 'checked OLD/cwd/PWD/export/await ordering and pre-output publication need source review'],
    ['same runtime signal; exact caller reason; owned cleanup settlement', 'shared-budget signal provenance remains source review'],
    ['typed/untyped scripted misses, ordered calls, duplicate fallback and first success', 'supported profile only; no new native EPERM/ELOOP proof'],
    ['public zero-I/O admission and exact boundary inputs', 'raw allocation and defensive normalized limit require source review'],
    ['unchanged maxCommands/maxOutputBytes outcomes and frozen public limit type', 'shared object identity, monotonic counters/no reset require source review'],
    ['none: defensive unreachable cases are not fake public passes', 'probe4098 and normalization proof require source review'],
    ['L18-L21 exact admitted public call counts and cap diagnostics', 'reservation arithmetic implementation, yield positions and no refunds require source review'],
    ['D01-D04 exact scalar/byte outputs; O05 non-cd diagnostic control', 'incremental bounded construction requires source review; not RSS'],
    ['prefix/function/clone/middleware final public observations and cleanup', 'child/post-rejection state and preserved baseline ordering require source review'],
    ['full fixed-composition authentication and owned WebDAV mock transport', 'no actual service, ACL or provider atomicity claim'],
    ['provenance/membership metadata only', 'future obligations remain NOT RUN now; no full-gate claim'],
  ];
  const futureMappings = ['common:authorize/authenticateCandidate + workspace:compose', 'entry source loader + fixtures86', 'run build/pack/install + package/type identities', 'run physical rename/absence/exact inventory + same86/types', 'entry admission negatives: outside/missing/runtime/provider', 'types exact10+10 with independent in-memory neutralizations', 'PENDING: separately authenticated ROOT scoped-regression route; no automatic regression execution'];
  save(resolve(directory, 'COVERAGE.json'), { schema: 1, classification: 'unchanged frozen expectations mapped to future executor; no measured product result', counts, rows: coverage(data), invariants: data.invariants.map((text, index) => ({ id: text.slice(0, 3), frozen: text, futurePublicMeasurements: invariantMappings[index][0], pending: invariantMappings[index][1], status: 'NOT RUN; source review pending where stated' })), futureControls: data.integrationControls.map((entry, index) => ({ ...entry, executor: futureMappings[index], status: 'NOT RUN' })), types: { positive: 10, negative: 10, fixtures: inputs.filter(entry => entry.path.endsWith('.mts.fixture')), modes: ['source', 'installed', 'moved'], status: 'NOT RUN; current checks are fixture membership only' } });
} else if (process.argv[2] === '--manifest') {
  const inputs = json(resolve(directory, 'INPUTS.json'));
  assert.deepEqual(inherited(), inputs.inheritedInventory);
  assert.deepEqual(foreignStaging(), inputs.foreignStagingBefore);
  assert.deepEqual(inventory(resolve(repo, inputs.providerRoot)), inputs.providerInventoryBefore);
  const entries = inventory(directory);
  assert(!entries['MANIFEST.json']);
  save(resolve(directory, 'MANIFEST.json'), { schema: 1, classification: 'preparation-only addition-aware seal', own, membership: [...Object.keys(entries).filter(path => entries[path].kind === 'file'), 'MANIFEST.json'].sort(), entries, soleSelfHashExclusion: 'MANIFEST.json; explicit preparation Git commit binds its bytes', inheritedSoleSubtreeExclusion: 'executor-preparation-v1', foreignStagingAfter: foreignStaging() });
} else throw new Error('Choose --inputs or --manifest; exclusive creation, no overwritten evidence');
