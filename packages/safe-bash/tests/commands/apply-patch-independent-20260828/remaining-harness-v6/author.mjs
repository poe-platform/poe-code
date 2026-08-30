import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, sha256 } from './primitives.mjs';
import { applyDeltas } from './fixture-data.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, '../../../..');
const base = 'tests/commands/apply-patch-independent-20260828';
const previous = JSON.parse(fs.readFileSync(path.join(own, '../remaining-harness-v4/PRESEAL.json')));
const diagnosis = JSON.parse(fs.readFileSync(path.join(own, '../postrun-diagnosis-v1/BINDINGS.json')));
const outputs = new Map();
function output(name, value) {
  assert.equal(fs.existsSync(path.join(own, name)), false, `output collision ${name}`);
  outputs.set(name, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
}
const supplementPath = `${base}/capture-membership-v3/matrix/SUPPLEMENT-v1.json`;
const originalPath = `${base}/capture-membership-v3/matrix/ORIGINAL32-v1.json`;
const supplementBytes = fs.readFileSync(path.join(repository, supplementPath));
assert.equal(sha256(supplementBytes), diagnosis.fixtures.supplement.sha256);
assert.equal(describe(path.join(repository, originalPath)).sha256, diagnosis.fixtures.original.sha256);
const supplementText = supplementBytes.toString('utf8');
const supplement = JSON.parse(supplementText);
const fixtureIds = ['V6-S62-CANONICAL', 'V6-S64-LITERAL-NOPULL', 'V6-S71-ACCESS-MODE', 'V6-S74-EXACT-BRANCH-SET'];
const cases = ['S62', 'S64', 'S71', 'S74'].map((id, index) => {
  const original = supplement.cases.find(row => row.id === id);
  assert.ok(original);
  const marker = supplementText.indexOf(`    {\n      "id": "${id}"`);
  assert.ok(marker >= 0);
  const end = supplementText.indexOf('\n    },', marker);
  assert.ok(end > marker);
  const excerpt = Buffer.from(supplementText.slice(marker + 4, end + 6));
  assert.deepEqual(JSON.parse(excerpt), original);
  const deltas = [
    { op: 'set', path: '/id', value: fixtureIds[index], reason: 'New denominator; never rescore original ID.' },
    { op: 'set', path: '/independence', value: 'Versioned root-authorized fixture adjudication after frozen diagnosis; not a fresh blind fixture.', reason: 'Disclose informed fixture change.' }
  ];
  if (id === 'S62') deltas.push(
    { op: 'set', path: '/name', value: 'Typed EACCES canonical diagnostic; not truncation evidence', reason: 'Discarded provider message does not prove truncation.' },
    { op: 'set', path: '/expected/stderr', value: { utf8: 'apply_patch: permission denied: /work/a\n' }, reason: 'Root authorizes exact 38-byte canonical diagnostic.' },
    { op: 'remove', path: '/expected/diagnosticTruncationSuffix', reason: 'Original suffix expectation failed and remains in original data.' }
  );
  if (id === 'S64') deltas.push(
    { op: 'set', path: '/invocation/stdin', value: { acquire: 'ALLOW_WRAPPER_ACQUISITION', pull: 'THROW_IF_PULLED' }, reason: 'Shell wrapper acquisition allowed; valid iterator throws only from next.' },
    { op: 'set', path: '/expected/stdinPulls', value: 0, reason: 'No consumption; no fixed acquisition count or Shell change.' },
    { op: 'set', path: '/expected/noExtraFilesystemEffects', value: true, reason: 'Proposed explicit reading: preserve intended literal writes, prohibit additional effects; zero total effects conflicts with success.' }
  );
  if (id === 'S71') deltas.push(
    { op: 'set', path: '/observer', value: { accessMode: 'actual args[1]', accessDenialMatch: 'exact path and supplied mode' }, reason: 'Old observer dropped mode; capture actual argument and match denial without fabrication.' }
  );
  if (id === 'S74') deltas.push(
    { op: 'set', path: '/expected/stderr', value: { exactUtf8Alternatives: [
      'apply_patch: operation 2; prior changes may remain: target bytes changed since preflight: /work/b\n',
      'apply_patch: operation 2; prior changes may remain: target changed since preflight: /work/b\n'
    ] }, reason: 'Only two existing full 98/92-byte diagnostics; no timestamp-cause claim or blanket predicate.' }
  );
  return { originalSourceBase64: excerpt.toString('base64'), originalSourceSha256: sha256(excerpt), original, deltas, row: applyDeltas(original, deltas) };
});
output('FIXTURES-v6.json', {
  schema: 'versioned-fixture-data-v6', classification: 'SOURCE/DATA only; four proposed new product rows, all NOT_RUN',
  supplement: { path: supplementPath, ...describe(path.join(repository, supplementPath)) },
  original32: { path: originalPath, ...describe(path.join(repository, originalPath)) },
  worker: diagnosis.fixtures.worker,
  cases
});
const remaining = JSON.parse(fs.readFileSync(path.join(own, '../remaining-harness-v4/REMAINING.json')));
assert.equal(remaining.jobs.length, 43);
const fresh = remaining.jobs.map(job => ({ ...job, frozenJobId: job.id, id: `V6-FRESH-${job.id}`, execution: 'NOT_RUN' }));
assert.deepEqual(fresh.filter(job => job.role === 'type').map(job => job.variant), ['positive', 'bad-value', 'bad-value-repair', 'root-negative', 'root-repair']);
assert.deepEqual(fresh.filter(job => job.cap && !job.mutation).map(job => [job.cap, job.endpoint]), ['L01', 'L02', 'L05', 'L06', 'L07', 'L10'].flatMap(cap => ['minus', 'at', 'over'].map(endpoint => [cap, endpoint])));
assert.deepEqual(fresh.filter(job => job.backend).map(job => [job.backend, job.ids]), ['real', 'mock-s3'].map(backend => [backend, ['P01', 'P06', 'P09', 'S41']]));
assert.deepEqual(fresh.filter(job => job.mutation).map(job => [job.mutation, job.phase]), ['M01', 'M03', 'M04', 'M09', 'M12', 'M18'].flatMap(mutation => ['before', 'mutant', 'restored'].map(phase => [mutation, phase])));
const freshCaseReceipts = fresh.filter(job => job.role === 'product').reduce((sum, job) => sum + (job.ids?.length || 1), 0);
assert.equal(freshCaseReceipts, 44);
const tail = ['source', 'installed', 'moved'].map(layout => ({ id: `V6-TAIL-${layout}`, role: 'product', layout, ids: fixtureIds, timeoutMs: 60000, maxBytes: 2097152, execution: 'NOT_RUN' }));
const auxiliary = [
  ...['tree', 'candidate', 'objects'].map(name => ({ id: `V6-AUX-GIT-${name}`, role: 'git', timeoutMs: 15000, maxBytes: 1048576 })),
  ...['loader-positive', 'loader-negative', 'stdout-bytes', 'process-envelope'].map(name => ({ id: `V6-AUX-GUARD-${name}`, role: 'guard', timeoutMs: 30000, maxBytes: 262144 })),
  { id: 'V6-AUX-BUILD-source', role: 'build', timeoutMs: 600000, maxBytes: 2097152 },
  ...['add', 'commit', 'identity'].map(name => ({ id: `V6-AUX-RUNTIME-SEAL-${name}`, role: 'git', timeoutMs: 30000, maxBytes: 262144 }))
].map(job => ({ ...job, execution: 'NOT_RUN', admission: 'EXPLICIT LATER GO; route and exact argv/permissions not yet qualified' }));
output('REMAINING-v6.json', {
  classification: 'OLDcandidate mapping only; NOT an executable successor plan; old43 stay UNRUN; new root handoff required', candidate: diagnosis.candidate,
  frozen43: remaining, fresh43: fresh, fixtureTail: tail, auxiliary,
  counts: { freshRemainingJobs: 43, movedTypes: 5, limits: 18, adapters: 2, mutants: 18, fresh43ProductCaseReceipts: freshCaseReceipts, newFixtureIds: 4, tailLayouts: 3, tailJobs: 3, tailRows: 12, proposedProductCaseReceiptsWithTail: freshCaseReceipts + 12, auxiliaryJobs: auxiliary.length, totalProposedChildren: fresh.length + tail.length + auxiliary.length, productJobs: 41 },
  mapping: { movedTypes: fresh.filter(job => job.role === 'type'), limits: fresh.filter(job => job.cap && !job.mutation), adapters: fresh.filter(job => job.backend), mutants: fresh.filter(job => job.mutation) },
  budget: { controllerMs: 6600000, cleanupReserveMs: 30000, peakAllOwnedProcesses: 2, children: 57, captureBytes: 134217728, scratchBytes: 536870912, sumDeclaredChildTimeoutMs: [...fresh, ...tail, ...auxiliary].reduce((sum, job) => sum + job.timeoutMs, 0), sumDeclaredChildCaptureCaps: [...fresh, ...tail, ...auxiliary].reduce((sum, job) => sum + job.maxBytes, 0), otherOSChildrenAllowed: 0 },
  barriers: ['S54 separate Poincare adjudication', 'Versioned worker for new fields/IDs remains to be authored and bound', 'Build/metadata/guard paths and permission closure require later review', 'Keep committed runtime seal; real Git add/commit machinery unqualified', 'No durable-file or serialized-handoff change without explicit later authority']
});
const input = JSON.parse(fs.readFileSync(path.join(own, '../remaining-harness-v4/INPUTS.json')));
input.movedPrefix = 'consumer-moved-v6-';
output('INPUTS-v6.json', input);
const sourceNames = ['PLAN.md', 'CALLGRAPH.md', 'REVIEW.md', 'primitives.mjs', 'fixture-data.mjs', 'child.mjs', 'data-controls.mjs', 'owner.mjs', 'author.mjs', 'evidence-author.mjs'];
const files = Object.fromEntries(sourceNames.sort().map(name => [name, describe(path.join(own, name))]));
for (const [name, bytes] of outputs) files[name] = { bytes: bytes.length, mode: 0o644, sha256: sha256(bytes) };
const bindings = [
  ...fs.readdirSync(path.join(own, '../remaining-harness-v5')).sort().map(name => `${base}/remaining-harness-v5/${name}`),
  `${base}/postrun-diagnosis-v1/FINDINGS.md`, `${base}/postrun-diagnosis-v1/BINDINGS.json`,
  `${base}/remaining-harness-v4/REPORT.md`, `${base}/remaining-harness-v4/PRESEAL.json`, `${base}/remaining-harness-v4/EVIDENCE-SEAL.json`,
  ...Object.keys(previous.files).map(name => `${base}/remaining-harness-v4/${name}`),
  supplementPath, originalPath, `${base}/capture-membership-v3/future-v3/worker.mjs`,
  `${base}/capture-membership-v3/future-v3/evidence/work-archive.json.gz.base64`
];
const sourceBindings = Object.fromEntries([...new Set(bindings)].sort().map(name => [name, describe(path.join(repository, name))]));
assert.equal(sourceBindings[`${base}/remaining-harness-v4/PRESEAL.json`].sha256, '14019b529fcd5483d2e40e0200165a601ce32d5b5762d88fb3d239c4224ec128');
for (const [name, binding] of Object.entries(previous.files)) assert.deepEqual(sourceBindings[`${base}/remaining-harness-v4/${name}`], binding);
for (const tool of Object.values(previous.tools)) assert.deepEqual(describe(tool.path), tool.binding);
const outputDirectory = path.join(own, 'attempt-01');
const work = path.join(outputDirectory, 'work');
const mainFilename = path.join(outputDirectory, 'MAIN-PRESEAL.json');
const childFilename = path.join(own, 'child.mjs');
const commonArgs = ['--no-warnings', '--permission', `--allow-fs-read=${childFilename}`];
const stageArgs = stage => [...commonArgs, `--allow-fs-read=${mainFilename}`, childFilename, stage, mainFilename];
const positiveArgs = [...commonArgs, ...['data-controls.mjs', 'primitives.mjs', 'fixture-data.mjs', 'INPUTS-v6.json', 'FIXTURES-v6.json'].map(name => `--allow-fs-read=${path.join(own, name)}`), `--allow-fs-read=${mainFilename}`, `--allow-fs-read=${path.join(repository, supplementPath)}`, `--allow-fs-read=${path.join(repository, originalPath)}`, `--allow-fs-read=${path.join(work, 'positive')}`, `--allow-fs-write=${path.join(work, 'positive')}`, childFilename, 'positive', mainFilename];
const gitPlan = structuredClone(previous.children[0]);
gitPlan.args = gitPlan.args.map(argument => argument.replaceAll('/remaining-harness-v4/', '/remaining-harness-v6/'));
gitPlan.env = Object.fromEntries(Object.entries(gitPlan.env).map(([key, value]) => [key, value.replaceAll('/remaining-harness-v4/', '/remaining-harness-v6/')]));
const ownerArgs = ['--no-warnings', '--permission', '--allow-child-process', `--allow-fs-read=${own}`, ...Object.keys(sourceBindings).map(name => `--allow-fs-read=${path.join(repository, name)}`), ...Object.values(previous.tools).map(tool => `--allow-fs-read=${tool.path}`), `--allow-fs-write=${outputDirectory}`, path.join(own, 'owner.mjs')];
output('DISCOVERY-PRESEAL.json', {
  schema: 'remaining-harness-v6-discovery-and-finite-main-template', candidate: diagnosis.candidate,
  files, sourceBindings, tools: previous.tools, nodeVersion: previous.nodeVersion,
  launch: { login: false, executable: previous.tools.node.path, args: ownerArgs, shellPrefix: 'exec -c', append: ['committed-source-id40', 'DISCOVERY-PRESEAL-sha25664'], selectedStartupEnv: {}, observedEnvIsNotAssumedEmpty: true },
  discovery: { id: 'D00', executable: previous.tools.node.path, args: [...commonArgs, childFilename, 'discovery'], envRule: 'Exact own process.env, only __CF_USER_TEXT_ENCODING permitted; value discovered once as local Node metadata, 1..256 UTF8 bytes. Unexpected keys STOP.', unknownHistoricalValue: true },
  output: 'attempt-01', bounds: { totalMs: 600000, admissionCutoffMs: 540000, maximumChildren: 12, fixedChildren: 5, peakAllOwnedProcesses: 2, captureBytes: 33554432, persistedBytes: 2097152, scratchBytes: 134217728, tightenedScratchBytes: 1048576, scratchEntries: 128, childTimeoutMs: 15000, retirementGraceMs: 2500, perChildRawBytes: 65536 },
  mainTemplate: { schema: 'remaining-harness-v6-main-preseal', nodeEnv: 'FROM_SINGLE_AUTHENTICATED_D00_RAW_RECORD', intentionalRefusalExpectedEnv: 'SAME_KEY_WITH_VALUE_PLUS_LITERAL_!V6-INTENTIONAL-MISMATCH',
    inputs: path.join(own, 'INPUTS-v6.json'), fixtures: path.join(own, 'FIXTURES-v6.json'), supplement: path.join(repository, supplementPath), original32: path.join(repository, originalPath), positiveWork: path.join(work, 'positive'), fixtureIds,
    controls: ['R01', 'R02', 'R03', 'B01', 'G01', 'P01'], dataChecks: ['D01', 'D02', 'D03', 'D04'],
    children: [
      { id: 'START-POSITIVE', executable: previous.tools.node.path, args: positiveArgs, expectedExit: 0 },
      { id: 'START-REFUSAL', executable: previous.tools.node.path, args: stageArgs('refusal'), expectedExit: 1 },
      { ...gitPlan, expectedExit: 0 },
      { id: 'P01', executable: previous.tools.node.path, args: stageArgs('nested'), expectedExit: 0 }
    ], gitFixture: previous.gitFixture
  },
  sourceMutationAfterCommit: 'FORBIDDEN', postFailure: 'STOP preserve evidence; no retries/corrections',
  mainSealDerivation: 'After D00 retirement only: clone template, bind exact env + intentional unequal expectation; assign each Node env exact, Git env finite base plus observed key; add source commit/preseal SHA/discovery stdout SHA; exclusive fsync/readback before any controls.'
});
process.stdout.write('*** Begin Patch\n');
for (const [name, bytes] of outputs) process.stdout.write(`*** Add File: ${path.relative(repository, path.join(own, name))}\n${bytes.toString().trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n`);
process.stdout.write('*** End Patch\n');
