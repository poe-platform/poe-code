import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const repository = '/Users/kjopek/Workspace/safe-bash';
const base = 'tests/commands/yq-independent-20260828';
const owned = join(repository, base, 'actual-35da1854-handoff-v1');
const output = join(owned, 'evidence');
const [presealCommit] = process.argv.slice(2);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const objectDigest = (value) => digest(JSON.stringify(value));
const git = (args, input) => execFileSync('/usr/bin/git', args, { cwd: repository, input, timeout: 60000, maxBuffer: 134217728 });
const pointerEscape = (value) => value.replaceAll('~', '~0').replaceAll('/', '~1');
const pointerValue = (value, pointer) => pointer.split('/').slice(1).reduce((current, part) => current[part.replaceAll('~1', '/').replaceAll('~0', '~')], value);
const ref = (artifact, pointer = '') => ({ artifact, pointer });
const index = { schema: 1, date: '2026-08-28', repository, roots: {}, artifacts: {}, captures: {}, descriptorFields: ['sha256', 'bytes', 'mode', 'gitBlob'], executionAuthorization: 'CONSUMED; ARTIFACT_READS_ONLY' };
const roots = new Map();
const external = new Map();
const saved = [];

function save(name, value, pretty = false) {
  const bytes = `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`;
  writeFileSync(join(output, name), bytes, { flag: 'wx', mode: 0o644 });
  saved.push({ path: `evidence/${name}`, bytes: Buffer.byteLength(bytes), sha256: digest(bytes) });
}

function fileFacts(path) {
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  assert.equal(realpathSync(path), path);
  const bytes = readFileSync(path);
  return { mode: stat.mode & 0o7777, bytes: bytes.length, sha256: digest(bytes) };
}

function snapshot(path) {
  const entries = [];
  function visit(current, name) {
    const stat = lstatSync(current);
    assert(!stat.isSymbolicLink(), current);
    if (stat.isDirectory()) {
      entries.push({ path: name || '.', kind: 'directory', mode: stat.mode & 0o7777 });
      for (const child of readdirSync(current).sort()) visit(join(current, child), name ? `${name}/${child}` : child);
    } else entries.push({ path: name, kind: 'file', ...fileFacts(current) });
  }
  visit(path, '');
  return entries;
}

function loadRoot(id, commit, prefix, expectedSeal) {
  const listing = git(['ls-tree', '-rz', commit, '--', prefix]).toString().split('\0').filter(Boolean).map((line) => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/u.exec(line);
    assert(match, line);
    return { path: match[3].slice(prefix.length + 1), gitMode: match[1], blob: match[2] };
  });
  const packed = git(['cat-file', '--batch'], listing.map((entry) => `${entry.blob}\n`).join(''));
  const files = new Map();
  let offset = 0;
  for (const entry of listing) {
    const end = packed.indexOf(10, offset);
    const [blob, type, size] = packed.subarray(offset, end).toString().split(' ');
    assert.equal(blob, entry.blob);
    assert.equal(type, 'blob');
    const bytes = packed.subarray(end + 1, end + 1 + Number(size));
    offset = end + Number(size) + 2;
    files.set(entry.path, { ...entry, bytes, sha256: digest(bytes) });
  }
  assert.equal(files.get('FINAL-SEAL.json').sha256, expectedSeal);
  const seal = JSON.parse(files.get('FINAL-SEAL.json').bytes);
  const expected = seal.entries ?? [
    { path: '.', kind: 'directory', mode: seal.rootMode },
    ...Object.entries(seal.files).map(([path, value]) => ({ path, kind: 'file', ...value })),
  ];
  if (seal.entryDigest) assert.equal(objectDigest(seal.entries), seal.entryDigest);
  const expectedFiles = expected.filter((entry) => entry.kind === 'file');
  assert.deepEqual([...files.keys()].sort(), [...expectedFiles.map((entry) => entry.path), 'FINAL-SEAL.json'].sort());
  for (const entry of expectedFiles) {
    const file = files.get(entry.path);
    assert.equal(file.sha256, entry.sha256, entry.path);
    assert.equal(file.bytes.length, entry.bytes, entry.path);
    assert.equal(file.gitMode === '100755', Boolean(entry.mode & 0o111));
    file.mode = entry.mode;
  }
  files.get('FINAL-SEAL.json').mode = 0o644;
  const live = snapshot(join(repository, prefix));
  const expectedWithSeal = [...expected, { path: 'FINAL-SEAL.json', kind: 'file', mode: 0o644, bytes: files.get('FINAL-SEAL.json').bytes.length, sha256: expectedSeal }];
  assert.deepEqual(Object.fromEntries(live.map((entry) => [entry.path, entry])), Object.fromEntries(expectedWithSeal.map((entry) => [entry.path, entry])));
  const root = { id, commit, prefix, files, live };
  roots.set(id, root);
  index.roots[id] = { commit, path: prefix, files: files.size, sealPath: 'FINAL-SEAL.json', sealSha256: expectedSeal, liveTreeDigest: objectDigest(live), currentArtifactMembershipModesAndHashes: true };
  return root;
}

function artifact(id, rootId, path) {
  const root = roots.get(rootId);
  const file = root.files.get(path);
  assert(file, `${rootId}/${path}`);
  index.artifacts[id] = { root: rootId, path, descriptor: [file.sha256, file.bytes.length, file.mode, file.blob] };
  return path.endsWith('.json') ? JSON.parse(file.bytes) : file.bytes;
}

function outside(id, commit, path, expectedSha256) {
  const key = `${commit}:${path}`;
  if (!external.has(key)) {
    const bytes = git(['show', key]);
    assert.equal(digest(bytes), expectedSha256, key);
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    external.set(key, { bytes, blob, sha256: expectedSha256 });
  }
  const file = external.get(key);
  index.artifacts[id] = { commit, path, descriptor: [file.sha256, file.bytes.length, 0o644, file.blob] };
  return path.endsWith('.json') ? JSON.parse(file.bytes) : file.bytes;
}

function byteFact(hex, binding) {
  assert(typeof hex === 'string' && /^(?:[a-f0-9]{2})*$/u.test(hex));
  const bytes = Buffer.from(hex, 'hex');
  return { bytes: bytes.length, sha256: digest(bytes), ref: binding };
}

function main() {
  assert.equal(process.cwd(), repository);
  assert(/^[a-f0-9]{40}$/u.test(presealCommit ?? ''));
  for (const name of ['PRESEAL.md', 'FINDINGS-PLAN.json', 'extract.mjs']) assert.deepEqual(readFileSync(join(owned, name)), git(['show', `${presealCommit}:${relative(repository, join(owned, name))}`]));
  mkdirSync(output);
  const actual = loadRoot('actual', '4b219eae180fcd2fd15ea864c9bc5226c54cda04', `${base}/actual-35da1854-v1`, 'c1d91e34da93ba6ee547e5d6fc9647ca7116bfbbcc731afda51a13790ac07321');
  loadRoot('build', 'f7503dc7dce11f9a3072b3670df498d64305d737', `${base}/candidate-35da1854-build-v1`, 'c8c6b98809ddb909c4b93f6e057d67cfd566bbfbeafd7088b2b0eeb4ebafcdb6');
  const auth = artifact('authentication', 'actual', 'preparation/AUTHENTICATION.json');
  const inventory = artifact('inventory', 'actual', 'preparation/INVENTORY-194.json');
  const jobsDocument = artifact('jobs', 'actual', 'execution/DECLARED-JOBS-149.json');
  const observations = artifact('observations', 'actual', 'execution/OBSERVATIONS.json');
  const audit = artifact('primitive-audit', 'actual', 'execution/RAW-PRIMITIVE-AUDIT.json');
  const coverage = artifact('old-coverage', 'actual', 'execution/COVERAGE-194.json');
  const sourceStatic = artifact('source-static', 'actual', 'execution/SOURCE-STATIC.json');
  const excerpts = artifact('source-excerpts', 'actual', 'execution/SOURCE-EXCERPTS.json');
  const root = artifact('root-envelope', 'actual', 'ROOT-EXECUTION.json');
  const counts = artifact('counts', 'actual', 'execution/COUNTS.json');
  const parent = artifact('parent', 'actual', 'execution/RUN-PROCESS.json');
  const parentStart = artifact('parent-start', 'actual', 'execution/PARENT-START.json');
  const reaps = artifact('reap', 'actual', 'execution/REAP-AUDIT.json');
  artifact('guard-inputs', 'actual', 'preparation/INPUT-GUARDS.json');
  artifact('integrity-after', 'actual', 'execution/INTEGRITY-AFTER.json');
  artifact('preservation', 'actual', 'execution/CAPTURE-PRESERVATION.json');
  const movements = artifact('moves', 'actual', 'execution/MATERIALIZATION-AUDIT.json');
  artifact('old-preparation-failures', 'actual', 'PREPARATION-HISTORY.md');
  const priorBuild = artifact('build-authenticated-during-review', 'actual', 'execution/BUILD-PROOF-AUTHENTICATED.json');
  const build = artifact('build-receipt', 'build', 'INDEPENDENT-BUILD-RECEIPT.json');
  const buildBindings = artifact('build-bindings', 'build', 'HANDOFF-BINDINGS.json');
  const compiler = artifact('build-process', 'build', 'COMPILER-PROCESS.json');
  for (const [id, path] of [['build-comparisons', 'OUTPUT-COMPARISONS.json'], ['build-raw-map', 'RAW-OUTPUT-MAP.json'], ['build-final-map', 'INDEPENDENT-PACKAGE-MAP.json'], ['build-packing', 'PACKING.json'], ['build-integrity', 'INTEGRITY-AFTER.json']]) artifact(id, 'build', path);
  assert.equal(jobsDocument.jobs.length, 149);
  assert.equal(objectDigest(jobsDocument.jobs), jobsDocument.jobsSha256);
  assert.equal(inventory.rows.length, 194);
  assert.equal(observations.length, 167);
  assert.equal(parent.elapsedMs, 619594);
  assert.equal(counts.aggregate, 'FAIL');
  assert.equal(reaps.children.length, 167);
  const sourceBindingRecord = auth.records.find((entry) => entry.path.endsWith('/runtime/recipe/source-bindings.json'));
  const sourceBindings = outside('frozen-bindings', sourceBindingRecord.commit, sourceBindingRecord.path, sourceBindingRecord.sha256);
  const frozen = new Map();
  for (const binding of sourceBindings.bindings.filter((entry) => entry.path.endsWith('.json'))) frozen.set(binding.id, outside(binding.id, binding.revision, binding.path, binding.sha256));
  const contract = frozen.get('final');
  const manifest = frozen.get('final-manifest');
  for (const binding of manifest.inheritedBindings) assert.equal(objectDigest(pointerValue(contract, binding.pointer)), binding.sha256);
  const recipeRecord = auth.records.find((entry) => entry.path.endsWith('/integration-v2/core/RECIPE.json'));
  const recipe = outside('integration-recipe', recipeRecord.commit, recipeRecord.path, recipeRecord.sha256);
  const packetMapsRecord = auth.records.find((entry) => entry.path.endsWith('/candidate-35da1854-v1/MAPS.json'));
  const packetMaps = outside('packet-maps', packetMapsRecord.commit, packetMapsRecord.path, packetMapsRecord.sha256);
  for (const [id, path] of [['packet-full-receipt', root.consumerReceipt.path], ['packet-admission', root.admissionReceipt.path], ['framework-review', root.frameworkReviewReceipt.path]]) {
    const relativePath = relative(repository, path);
    const binding = auth.records.find((entry) => entry.path === relativePath);
    assert(binding, relativePath);
    outside(id, binding.commit, binding.path, binding.sha256);
  }
  const fullReceipt = outside('packet-full-receipt', '71a16afd5b430175180fc4741531b75c31b25882', relative(repository, root.consumerReceipt.path), root.consumerReceipt.sha256);
  const actualRows = [];
  const admission = [];
  for (let observationIndex = 0; observationIndex < observations.length; observationIndex++) {
    const observation = observations[observationIndex];
    const captureKey = `${observation.mode === 'original-runtime' ? 'o' : observation.mode === 'moved-runtime' ? 'm' : 'a'}:${observation.jobId}`;
    const captureFiles = {};
    for (const [name, file] of actual.files) if (name.startsWith(`${observation.evidence}/`) && !name.slice(observation.evidence.length + 1).includes('/')) captureFiles[name.slice(observation.evidence.length + 1)] = [file.sha256, file.bytes.length, file.mode, file.blob];
    const summaryPath = join(dirname(observation.evidence), 'summary.json');
    const summary = actual.files.get(summaryPath);
    assert(summary);
    index.captures[captureKey] = { root: 'actual', path: observation.evidence, files: captureFiles, parentSummary: { path: summaryPath, descriptor: [summary.sha256, summary.bytes.length, summary.mode, summary.blob] } };
    const receipt = JSON.parse(actual.files.get(`${observation.evidence}/receipt.json`).bytes);
    const child = JSON.parse(actual.files.get(`${observation.evidence}/child.json`).bytes);
    const verdict = JSON.parse(actual.files.get(`${observation.evidence}/verdict.json`).bytes);
    const captureRef = (file, pointer = '') => ({ capture: captureKey, file, pointer });
    if (!observation.runtime) {
      admission.push({ capture: captureKey, originalIds: recipe.stages.find((stage) => stage.name === 'source-admission').ids, role: 'SOURCE_PACKAGE_ADMISSION_NOT_SEMANTICS', rawAggregate: observation.aggregate, receipt, child, newExecution: false });
      continue;
    }
    const jobIndex = jobsDocument.jobs.findIndex((job) => job.id === observation.jobId);
    assert(jobIndex >= 0);
    const job = jobsDocument.jobs[jobIndex];
    const jobPointer = `/jobs/${jobIndex}`;
    const capture = receipt.capture;
    const auditIndex = audit.observations.findIndex((row) => row.mode === observation.mode && row.jobId === observation.jobId);
    assert(auditIndex >= 0);
    const primitive = audit.observations[auditIndex];
    const obligation = JSON.parse(actual.files.get(`${observation.evidence}/obligations.json`).bytes);
    const state = observation.classification === 'SCOPED_OBSERVATION_MATCH' ? 'PASS_PROJECTION' : observation.classification === 'UNFULFILLED_OBLIGATIONS' ? 'INCOMPLETE' : 'HARNESS_FAILURE';
    const chunks = job.stdinChunksHex.map((hex, chunkIndex) => byteFact(hex, ref('jobs', `${jobPointer}/stdinChunksHex/${chunkIndex}`)));
    const expectedOutput = job.expected.stdoutHex ?? (typeof job.expected.stdoutUtf8 === 'string' ? Buffer.from(job.expected.stdoutUtf8).toString('hex') : null);
    const effect = (phase) => capture.effects[phase].map((entry, effectIndex) => ({ path: entry.path, ...byteFact(entry.hex, captureRef('receipt.json', `/capture/effects/${phase}/${effectIndex}/hex`)) }));
    const eventKinds = {};
    for (const event of capture.events) eventKinds[event.kind] = (eventKinds[event.kind] ?? 0) + 1;
    actualRows.push({
      sequence: observationIndex, environment: observation.mode, originalId: job.recordId, fragmentation: job.id.split('--')[1], role: job.role,
      capture: captureKey, declaredJob: ref('jobs', jobPointer), frozenRecord: ref('observations', `/${observationIndex}/frozen`), overlay: job.overlayReference ? ref('jobs', `${jobPointer}/overlayReference`) : null,
      argv: job.argv, argvSha256: objectDigest(job.argv), stdin: { chunks, totalBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0), combinedSha256: digest(Buffer.concat(job.stdinChunksHex.map((hex) => Buffer.from(hex, 'hex')))), stdinIsDefault: job.stdinIsDefault, producerReuse: job.producerReuse },
      fixtures: job.files.map((file, fixtureIndex) => ({ path: file.path, ...byteFact(file.hex, ref('jobs', `${jobPointer}/files/${fixtureIndex}/hex`)) })),
      expected: { ref: ref('jobs', `${jobPointer}/expected`), status: job.expected.status ?? null, stdout: expectedOutput === null ? null : { bytes: expectedOutput.length / 2, sha256: digest(Buffer.from(expectedOutput, 'hex')), ref: ref('jobs', `${jobPointer}/expected`) }, diagnosticCode: job.expected.diagnosticCode ?? null, successStderrEmpty: job.expected.status === 0, assertionKeys: Object.keys(job.expected), assertions: job.expected.assertions ? ref('jobs', `${jobPointer}/expected/assertions`) : null, assertionCount: job.expected.assertions?.length ?? 0 },
      observed: { status: capture.status, rejected: capture.rejected, rejection: capture.rejection, cleanupErrors: capture.cleanupErrors, stdout: byteFact(capture.stdoutHex, captureRef('receipt.json', '/capture/stdoutHex')), stderr: byteFact(capture.stderrHex, captureRef('receipt.json', '/capture/stderrHex')), effects: { before: effect('before'), after: effect('after'), identicalAsRecordedData: objectDigest(capture.effects.before) === objectDigest(capture.effects.after) }, events: { count: capture.events.length, kinds: eventKinds, ref: captureRef('receipt.json', '/capture/events') } },
      assertions: { classification: state, rawAggregate: observation.aggregate, rawVerdict: verdict.outcome, obligationStatus: obligation.status, unfulfilledCount: obligation.unfulfilled.length, unfulfilled: captureRef('obligations.json', '/unfulfilled'), assertionFailure: captureRef('verdict.json', '/failures'), primitiveFacts: primitive.facts.map((fact, factIndex) => ({ field: fact.field, sameAsRecordedReadOnlyAudit: fact.same, ref: ref('primitive-audit', `/observations/${auditIndex}/facts/${factIndex}`) })), unassertedFactsNotPromoted: true, fullRecordPass: false },
      child: { pid: child.pid, group: child.group, exitCode: child.exitCode, signal: child.signal, timedOut: child.timedOut, overflow: child.overflow, spawnError: child.spawnError, elapsedMs: child.elapsedMs, reaped: child.reaped, integrity: verdict.integrity, reapProof: verdict.reapProof },
      loadedCode: { proofRole: receipt.proofRole, binding: receipt.binding ?? null, importedEdges: receipt.imported?.length ?? null, imported: receipt.imported ? captureRef('receipt.json', '/imported') : null, movement: receipt.movement ? captureRef('receipt.json', '/movement') : null, publicIntegration: false, dedicatedLoadedControl: 'UNRUN' },
    });
  }
  assert.equal(actualRows.length, 166);
  assert.equal(admission.length, 1);
  const planned = [];
  function plannedRow(environment, jobId, originalId, role) {
    const position = observations.findIndex((row) => row.mode === environment && row.jobId === jobId);
    const runtimePosition = actualRows.findIndex((row) => row.environment === environment && row.originalId === originalId && `${originalId}--${row.fragmentation}` === jobId);
    planned.push({ slot: planned.length + 1, environment, jobId, originalId, role, state: position < 0 ? 'UNRUN' : environment === 'source-admission' ? 'ADMISSION_OBSERVED' : actualRows[runtimePosition].assertions.classification, actualLedgerIndex: runtimePosition < 0 ? null : runtimePosition, unrunIsProductFailure: false });
  }
  plannedRow('source-admission', 'source-admission', null, 'SOURCE_PACKAGE_ADMISSION');
  for (const environment of ['original-runtime', 'moved-runtime']) for (const job of jobsDocument.jobs) plannedRow(environment, job.id, job.recordId, job.role);
  plannedRow('loaded-code', 'loaded-code', null, 'DEDICATED_LOADED_CONTROL');
  plannedRow('types', 'types', null, 'DEDICATED_TYPE_WORKER');
  assert.equal(planned.length, 301);
  assert.equal(planned.filter((row) => row.state === 'UNRUN').length, 134);
  const mapped = inventory.rows.map((row, rowIndex) => ({ id: row.id, role: row.primaryRole, secondaryRoles: row.secondaryRoles,
    frozen: ref('inventory', `/rows/${rowIndex}/frozen`), originalRecordSha256: row.frozen.recordSha256,
    overlay: row.currentOverlay ? ref('inventory', `/rows/${rowIndex}/currentOverlay`) : null,
    observations: actualRows.map((actualRow, actualIndex) => actualRow.originalId === row.id ? actualIndex : null).filter((value) => value !== null),
    completeProjectionEligibilityNotResult: row.fullRecordEligibleAfterProjection, semanticEligibilityNotResult: row.semanticDenominatorEligible,
    missingBindings: ref('inventory', `/rows/${rowIndex}/missingBindings`), missingBindingCount: row.missingBindings.length,
    sourceStaticIndex: sourceStatic.results.findIndex((sourceRow) => sourceRow.id === row.id), criticalAnnotationIndex: sourceStatic.annotations.findIndex((sourceRow) => sourceRow.id === row.id),
    sourceAdmissionEvidence: admission[0].originalIds.includes(row.id) ? admission[0].capture : null,
    dedicatedRuntimeState: ['negative-control', 'type-consumer', 'lifecycle-cooperative'].includes(row.primaryRole) ? 'UNRUN_OR_UNBOUND_NOT_PRODUCT_FAILURE' : null, fullRecordPass: false }));
  const sourceCoverage = sourceStatic.results.map((row, rowIndex) => ({ id: row.id, classification: row.classification, observation: row.observation,
    exactEvidence: ref('source-static', `/results/${rowIndex}`), excerpts: row.references.map((key) => ref('source-excerpts', `/${pointerEscape(key)}`)),
    runtimeCounterTrace: 'UNRUN_UNBOUND', unresolvedPrivateRuntimeObligation: true, fullRecordPass: false }));
  const findingPlan = JSON.parse(readFileSync(join(owned, 'FINDINGS-PLAN.json')));
  const findings = findingPlan.findings.map((finding) => {
    const row = inventory.rows.find((entry) => entry.id === finding.id);
    const original = pointerValue(frozen.get(row.frozen.source), row.frozen.pointer);
    assert.equal(objectDigest(original), row.frozen.recordSha256);
    const norm = pointerValue(contract, finding.counterPointer);
    const witnesses = finding.witness.map(([path, firstLine, lastLine]) => {
      const binding = auth.sourceRecords.find((entry) => entry.path === path);
      assert.equal(binding.commit, root.authorSourceCommit);
      const id = `selected:${path}`;
      const bytes = outside(id, binding.commit, path, binding.sha256);
      assert.equal(index.artifacts[id].descriptor[3], binding.blob);
      const sealed = Object.values(excerpts).find((entry) => entry.path === path && entry.startLine <= firstLine && entry.endLine >= lastLine);
      assert(sealed, `${path}:${firstLine}-${lastLine}`);
      const text = bytes.toString().split('\n').slice(firstLine - 1, lastLine).join('\n');
      assert.equal(text, sealed.text.split('\n').slice(firstLine - sealed.startLine, lastLine - sealed.startLine + 1).join('\n'));
      return { source: ref(id), blob: binding.blob, sha256: binding.sha256, firstLine, lastLine, text };
    });
    return { ...finding, normative: { originalId: finding.id, originalRecord: ref(row.frozen.source, row.frozen.pointer), recordSha256: row.frozen.recordSha256,
      frozenAssertion: original.expect.assertions, frozenScenarioNotExecuted: original.input,
      currentContract: ref('final', finding.counterPointer), contractEntrySha256: objectDigest(norm), exactCounterObligation: norm,
      inheritedByFinalCarry: ref('final-manifest', '/inheritedBindings/9'), finalCarryDocument: ref('final-contract'),
      additional: finding.extraContractPointers.map((pointer) => ({ ref: ref('final', pointer), sha256: objectDigest(pointerValue(contract, pointer)) })) },
      witnesses, dependentOriginalIds: inventory.rows.filter((entry) => finding.dependentFamilies.includes(entry.id.split('-')[0])).map((entry) => entry.id),
      classification: 'EXISTING_ALLOCATION_ORDER_STATIC_COUNTERPROOF', newRuntimeBoundaryInputs: 0, runtimeCounterTrace: 'UNRUN', newPolicy: false };
  });
  const finalContractBinding = sourceBindings.bindings.find((entry) => entry.id === 'final-contract');
  outside('final-contract', finalContractBinding.revision, finalContractBinding.path, finalContractBinding.sha256);
  const runtimeAuthorization = artifact('runtime-authorization', 'actual', 'raw-compound/metadata/runtime-authorization.json');
  artifact('runtime-provenance', 'actual', 'raw-compound/metadata/runtime-provenance.json');
  const movedTimes = actualRows.filter((row) => row.environment === 'moved-runtime').map((row) => row.child.elapsedMs);
  assert.equal(Math.min(...movedTimes), 16840);
  assert.equal(Math.max(...movedTimes), 27231);
  const chronology = { actualPresealCommit: '7d3423edda8de5f125cabb884d49c3712e5e25d3', actualPresealCommitTime: git(['show', '-s', '--format=%cI', '7d3423edda8de5f125cabb884d49c3712e5e25d3']).toString().trim(), parentStartedAt: new Date(parentStart.started).toISOString(), parentElapsedMs: parent.elapsedMs, buildCompilerStartedAt: compiler.startedAt, buildCompilerExitedAt: compiler.exitedAt, buildProofReceivedAfterActualPreseal: priorBuild.receivedAfterActualPreseal, exactHandoffArrivalTimestamp: 'NOT_RECORDED', executionReceiptNeverSubstituted: true };
  save('ACTUAL-JOBS.json', actualRows);
  save('PLANNED-STATUS.json', planned);
  save('ID-MAP-194.json', { rows: mapped, overlays: inventory.overlays.map((id) => ({ id, originalId: id, manifest: ref('final-manifest', `/overlays/${manifest.overlays.findIndex((entry) => entry.id === id)}`), mappingIndex: mapped.findIndex((entry) => entry.id === id) })), roleCounts: inventory.roleCounts, semanticEligibilityNotResults: { complete: 94, partial: 17 }, missingBindingRecords: 80, no202CaseDenominator: true });
  save('SOURCE-COVERAGE.json', { designated: sourceCoverage, criticalAnnotations: sourceStatic.annotations.map((row, rowIndex) => ({ id: row.id, ref: ref('source-static', `/annotations/${rowIndex}`), role: row.role, noAdditionalCase: true })), classificationCounts: sourceCoverage.reduce((counts, row) => ({ ...counts, [row.classification]: (counts[row.classification] ?? 0) + 1 }), {}), unknownPrivateRuntimeProofs: 23, semanticPasses: 0 });
  save('REPAIR-FINDINGS.json', { findings, successor: findingPlan.successor, authority: 'EXISTING_FROZEN_OBLIGATIONS_ONLY; NOT A NEW CONTRACT' }, true);
  save('RUN-SUMMARY.json', { originalAggregate: 'FAIL', stop: counts.stopped, parent, admissionBudgetMs: recipe.bounds.totalAdmissionMs, plannedChildren: 301, actualChildren: 167, runtimeJobs: 166, originalJobs: 149, movedJobs: 17, unrunPlannedChildren: 134, originalUniqueRuntimeIds: 132, failureJobs: { incomplete: 31, harness: 1 }, sourceAdmission: admission,
    observationsByEnvironment: counts.byEnvironment, movedElapsedRangeMs: [16840, 27231], stopwatchPerformanceClaim: false, isolatedTimingRootCause: false,
    reapIntegrity: { ref: ref('reap'), knownOwnedReap: reaps.knownOwnedReap, children: 167, completeInputGuards: 42, newReapOrRuntimeExperiment: false },
    dedicatedLoaded: 'UNRUN', loadedMutantControl: 'UNRUN', negativeControlIds: mapped.filter((row) => row.role === 'negative-control').map((row) => row.id), negativeControlRuns: 0, typeWorkerRuns: 0, compilerFixtureRuns: 0, scopedTypeFixtures: recipe.scopedTypeJobs, pendingPublicTypeFixtures: recipe.pendingPublicJobs,
    overallFailureUnchanged: true, unrunIsProductFailure: false, newExecutionAuthorization: false }, true);
  save('PROVENANCE.json', { executionClassification: root.buildProof.classification, executionRootEnvelope: ref('root-envelope'), originalFullReceipt: ref('packet-full-receipt'), originalReceiptHash: root.consumerReceipt.sha256,
    selectedSource: { baseline: root.sourceBase, acceptedLength: root.acceptedLength, sevenNewOrigin: root.authorSourceCommit, sourceEvidence: 'ef6032b210feb5cf19e6f6f94c40413740bef335', authorHandoff: 'bcec1ead34aee37c8fe574b248a8242ad4f60cfa', additions: fullReceipt.sourceAdditions, selectedManifest: ref('authentication', '/sourceRecords'), consumerMap: ref('packet-maps', '/source'), archiveMap: ref('packet-maps', '/archive'), sourceMapSha256: packetMaps.sourceMapSha256, wholeMutableHead: false, whole35daTree: false },
    sizes: { fullSourceArchive: 273, consumerProjection: 271, fullPackage: 870, baselinePackage: 846, emittedAdditions: 24 }, archives: { source: root.sourceArchive, package: root.packageArchive },
    wholePackage: { ref: ref('packet-maps', '/fullPackage'), sha256: root.packageArchive.sha256, packageMapSha256: packetMaps.packageMapSha256 }, readme: { ...packetMaps.readme, proof: ref('packet-maps', '/readme'), baselineBuildReference: ref('build-bindings', '/baselineReadme') },
    toolchain: { ...auth.tools, originalAndCopiedBuildTools: ref('build-bindings', '/tools'), actualGuardedToolTrees: ref('guard-inputs'), newCompilerOrToolCohortRun: false },
    actualEntry: runtimeAuthorization.compiled.entry, actualRuntimeBinding: ref('runtime-authorization'), loaderRecipeAndNode: { recipe: runtimeAuthorization.recipe, node: runtimeAuthorization.node },
    loadedProofLevels: { actualFactoryCalls: 166, originalEntryHashBound: 149, movedImportReceipts: 17, dedicatedLoadedCodeControl: 'UNRUN', dedicatedLoadedMutant: 'UNRUN', scopedTypeControls: 'UNRUN', publicIntegration: 'ABSENT_EXPECTED_DIRECT_MODULE_ONLY', globalTypes: 'NOT_RUN; foreign.mts blocker not waived' },
    recordedMaterializations: { observationQualification: 'Paths and before/after/current-at-review facts from sealed evidence; no new physical source/package/tool scan or replay in this task.', archiveSourceRoot: root.archiveSourceRoot, consumerSourceRoot: root.consumerSourceRoot, originalPackageRoot: root.packageRoot, runtimeRecipeRoot: root.runtimeRecipeRoot, guardedOriginalAndPriorMovedTrees: ref('guard-inputs'), oldPostRunIntegrity: ref('integrity-after'), freshMoves: { count: movements.moves.length, ref: ref('moves') }, independentBuildSource: buildBindings.source, independentBuildPackage: buildBindings.compiled, independentBuildBeforeAfter: ref('build-integrity') },
    independentBuild: { proof: ref('build-receipt'), receivedAndAuthenticated: ref('build-authenticated-during-review'), independentlyCompiled: build.independentlyCompiled, rootTrustedBuildReceipt: build.rootTrustedBuildReceipt, rawJsDeclarations: 434, sourceMapsRelocated: 217, declarationMapsRelocated: 217, mapsRequireExplicitRelocation: true, comparisonManifest: ref('build-comparisons'), rawOutputManifest: ref('build-raw-map'), finalPackageManifest: ref('build-final-map'), packageSerialization: ref('build-packing'), compilerProcess: ref('build-process'), compilerRunsByThisWorker: 0, originalAuthorReceiptRewritten: false }, chronology,
    noPassInheritanceAcrossRepairedAllocationSemantics: true, fullAcceptance: false }, true);
  for (const stored of roots.values()) assert.deepEqual(snapshot(join(repository, stored.prefix)), stored.live);
  save('INDEX.json', index);
  save('EXTRACTION-RESULT.json', { schema: 1, date: '2026-08-28', sourceCommit: presealCommit, oldActualCommit: actual.commit, buildCommit: roots.get('build').commit,
    authenticatedOldFiles: { actual: actual.files.size, build: roots.get('build').files.size }, outputCounts: { runtimeJobs: actualRows.length, plannedChildren: planned.length, unrun: 134, sourceAdmission: 1, originalIds: mapped.length, overlays: inventory.overlays.length, sourceRows: sourceCoverage.length, findings: findings.length },
    originalAndBuildArtifactsUnchangedBeforeAfterIncludingMembership: true, newProductOrHarnessImports: 0, newProductRuns: 0, newCompilerRuns: 0, nativeYamlRuns: 0, fullRecordPassesAdded: 0, originalAggregate: 'FAIL', files: saved }, true);
  console.log(JSON.stringify({ status: 'ARTIFACT_HANDOFF_EXTRACTED', originalAggregate: 'FAIL', runtimeRows: actualRows.length, unrun: 134, oldFilesAuthenticated: actual.files.size + roots.get('build').files.size, outputBytes: saved.reduce((sum, entry) => sum + entry.bytes, 0), productRuns: 0 }));
}

try { main(); }
catch (error) {
  const failure = { date: '2026-08-28', name: error.name, message: error.message, stack: error.stack, productRuns: 0, artifactExtractionFailure: true };
  const failurePath = join(owned, 'DATA-FAILURE.json');
  if (!existsSync(failurePath)) writeFileSync(failurePath, `${JSON.stringify(failure, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  console.error(JSON.stringify(failure));
  process.exitCode = 1;
}
