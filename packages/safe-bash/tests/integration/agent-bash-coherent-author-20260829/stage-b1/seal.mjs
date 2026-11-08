import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root = process.cwd(), scope = import.meta.dirname, base = path.dirname(scope);
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const relative = file => path.relative(root, file);
const descriptor = (file, expected) => {
  const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.ok(stat.size <= 4194304);
  if (expected) assert.equal(stat.size, expected.bytes);
  const body = fs.readFileSync(file); const record = { path: relative(file), bytes: body.length, sha256: sha(body) };
  assert.equal(body.length, stat.size); if (expected) assert.equal(record.sha256, expected.sha256);
  return { record, body };
};
const write = (name, value) => fs.writeFileSync(path.join(scope, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
try {
  const b0Record = descriptor(path.join(base, 'stage-b0-r3/PRESEAL.json'), { bytes: 11952, sha256: '78e6c945ceadfb54d51d806fbe57399ab5a552ad4571791cb916c085736e27a7' });
  const b0 = JSON.parse(b0Record.body);
  const auth = descriptor(path.join(scope, 'AUTHENTICATED-INPUTS.json'));
  const inputs = JSON.parse(auth.body);
  const files = new Map();
  const include = (file, expected) => { const entry = descriptor(file, expected).record; assert.notEqual(path.basename(entry.path), 'AGENTS.md'); files.set(entry.path, entry); return entry; };
  for (const entry of b0.files) include(path.join(root, entry.path), entry);
  include(path.join(root, b0Record.record.path), b0Record.record);
  include(path.join(root, auth.record.path), auth.record);
  for (const entry of inputs.inputs) include(entry.absolute, entry);
  const receiptEntry = inputs.inputs.find(entry => path.basename(entry.path) === 'PUBLIC-ENGINE-RECEIPT.json');
  const receipt = JSON.parse(descriptor(receiptEntry.absolute, receiptEntry).body);
  assert.equal(receipt.engine.length, 96); assert.equal(inputs.engine.length, 96);
  const tuples = entries => entries.map(entry => [entry.stagedRelativePath, entry.bytes, entry.sha256]).sort((left, right) => left[0].localeCompare(right[0], 'en'));
  assert.deepEqual(tuples(receipt.engine), tuples(inputs.engine));
  assert.ok(inputs.engine.some(entry => entry.stagedRelativePath === 'support/errors.js'));
  for (const name of ['bootstrap.mjs','launch.sh','run.mjs','consumer.mjs','controls.mjs','seal.mjs','PROFILE.md']) include(path.join(scope, name));
  const stage = (source, target, expected) => ({ ...include(path.join(root, source), expected), source, target });
  const publicFile = (basename, target = basename) => { const entry = inputs.inputs.find(row => path.basename(row.path) === basename); assert.ok(entry); return stage(entry.path, target, entry); };
  const stageFiles = [
    stage(relative(path.join(scope, 'consumer.mjs')), 'consumer.mjs'),
    stage(relative(path.join(base, 'v4/workflows.mjs')), 'workflows.mjs', { bytes: 15763, sha256: '6d8a19854a6e96986013ed3d94ee15dd774e225259dea922bf4749799c60d89b' }),
    stage(relative(path.join(base, 'stage-b/admission.mjs')), 'admission.mjs'),
    stage(relative(path.join(base, 'v2/NEUTRAL-FIXTURE.json')), 'neutral.json', { bytes: 4160, sha256: 'fcb7bae1505a86b2b676396742d7bf362ad779c77192770ed94085646f8d0074' }),
    publicFile('engine-adapter-v1.mjs'), publicFile('node-policy.mjs'), publicFile('node-load-guard.mjs'),
  ];
  const retainedEntry = inputs.inputs.find(entry => path.basename(entry.path) === 'RETAINED-SOURCES.json');
  const retained = JSON.parse(descriptor(retainedEntry.absolute, retainedEntry).body);
  const roles = [
    ['redirections-v3.mjs', 48, 'redirection-cases.json plus helper controls'],
    ['strict.mjs', 50, 'ALL50 Unit2 once per layout; do not also select an aggregate copy'],
    ['conditional-v4.mjs', 67, 'versioned conditional/H02 controls, not old failures'],
    ['extension-v2.mjs', 35, 'resolved extension version with corrected X10'],
    ['arrays.mjs', 12, 'all12 accepted array cases'],
    ['n14.mjs', 12, 'exact-Promise profile, transformed wrappers not implied'],
  ];
  const roleMap = roles.map(([basename, perLayout, policy]) => {
    const entry = retained.find(row => path.basename(row.path) === basename); assert.ok(entry);
    const labels = [...entry.text.matchAll(/(?:record|test|check|runCase)\(\s*['"]([^'"\n]+)['"]/g)].map(match => match[1]);
    return { fixture: entry.path, bytes: entry.bytes, sha256: entry.sha256, commit: entry.commit, perLayout, layouts: 3, slots: perLayout * 3, policy, literalLabels: [...new Set(labels)], exactExpandedIdMap: 'B2_COMPLETION_REQUIRED_NO_EXECUTION_CREDIT' };
  });
  assert.equal(roleMap.reduce((sum, row) => sum + row.slots, 0), 672);
  write('B2-REMAINING.json', { roles: roleMap, semanticSlots: 672, status: 'UNRUN_NOT_EXECUTABLE', dedup: ['role', 'fixture SHA256', 'versioned exact identity', 'layout'], types: 'Full positive/negative consumer source staging and exact diagnostic maps remain unsealed', mutants: 'Exact loaded offset/hash/reversion/restore recipes remain unsealed', bindings: 'Additional B2 negative bindings/retirement controls remain unsealed', outsideSelectorProposal: ['tests/integration/agent-bash-smoke.test.ts', 'package.json literal script only if separately approved'], noOutsideEdits: true });
  const seal = {
    schema: 'coherent-b1-public15-preseal-v1', created: new Date().toISOString(),
    sourceTree: '3adc676a0ab638c9788ef007e465931d65d2c6fe', sourceInputs: 309,
    package: b0.package, members: 1014, actualStageAEmissions: 1012,
    b0: b0Record.record, authenticatedInputs: auth.record,
    ids: ['C10','C11','C15','C16','C18'], layouts: ['source-built','installed','physically-moved'],
    workRoot: '/private/tmp/safe-bash-coherent-b1-public15-20260829-r1',
    bounds: { wallSeconds: 1800, activeSeconds: 1620, publicationReserveSeconds: 180, knownOSStarts: 32, knownOSPeak: 3, supervisedChildren: 4, installSeconds: 120, layoutSeconds: 300, caseSeconds: 30, cleanupSeconds: 5, captureBytes: 67108864, workingBytes: 805306368, guestWorkersPerLayout: 5, guestWorkersTotal: 15, guestWorkerMaximumActive: 5, guestWorkerExpectedSequentialPeak: 1, regexWorkers: 0, internalLoaderThreads: 0, synchronousHookMainEntries: 3, synchronousHookGuestEntriesMaximum: 15, loadRecordsPerIsolate: 2048, observerRecordsPerLayout: 512 },
    remaining: { B0AuthorObserved: 39, B1Planned: 15, B2Planned: 672, totalPlanned: 726, unit2PerLayout: 50, B2RuntimeStatus: 'UNRUN' },
    engineArchiveBounds: { encoded: 2097152, gzip: 2097152, inflated: 16777216, concurrentArchiveBuffers: 33554432, source98Inflated: 8388608 },
    controls: { entry: relative(path.join(scope, 'controls.mjs')), groups: 15, harmlessNodeControllerStarts: 1, productImports: 0, workers: 0 },
    stageFiles, files: [...files.values()].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))),
    actualAuthorization: 'PENDING_DIFFERENT_PREEXECUTION_REVIEW_AND_FRESH_ROOT_GO',
    inheritedOwner: { path: relative(path.join(base, 'stage-b0-r3/owner.mjs')), qualification: 'Same bytes, finite B0-r3 source/24PURE acceptance; no new actual-owner-fault proof' },
    commands: { launch: 'B1_ROOT_GO=ROOT_B1_PUBLIC15_EXPLICIT_FRESH_AUTHORIZATION /bin/zsh tests/integration/agent-bash-coherent-author-20260829/stage-b1/launch.sh tests/integration/agent-bash-coherent-author-20260829/stage-b1/PRESEAL.json EXPECTED_SHA EXPECTED_BYTES', install: 'Pinned Node + admitted npm-cli.js install --offline --ignore-scripts --no-audit --no-fund --package-lock=false --cache OWNED/cache --prefix OWNED/installed OWNED/input/product.tgz', consumer: 'Pinned Node --experimental-permission --allow-fs-read=PHYSICAL_CONSUMER --allow-fs-read=PINNED_NODE --allow-fs-write=PHYSICAL_CONSUMER --allow-worker --import NODE_POLICY --import SYNC_LOAD_GUARD consumer.mjs --run REQUEST REQUEST_SHA REQUEST_BYTES' },
  };
  assert.equal(fs.existsSync(seal.workRoot), false);
  write('PRESEAL.json', seal);
  const preseal = descriptor(path.join(scope, 'PRESEAL.json')).record;
  write('SEAL-RECEIPT.json', { preseal, status: 'SOURCE_EXECUTABLE_PRESEAL_REVIEW_REQUIRED', productExecution: 0, actualGrant: false, B2: 'UNRUN_BLOCKERS_EXPLICIT' });
  console.log(JSON.stringify({ preseal, files: seal.files.length, stageFiles: stageFiles.length, B1: 15, B2: 672, totalPlan: 726, guestWorkers: '5/layout 15 total; conservative active cap5, expected sequential1', at: seal.created }));
} catch (error) { console.error(error); process.exitCode = 78; }
