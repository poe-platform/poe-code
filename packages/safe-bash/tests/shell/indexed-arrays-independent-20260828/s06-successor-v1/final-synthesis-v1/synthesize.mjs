import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const here = path.dirname(fileURLToPath(import.meta.url));
const successor = path.dirname(here), own = path.dirname(successor);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const read = filename => {
  assert.equal(fs.realpathSync(filename), filename);
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.ok(stat.size <= 64 * 1024 * 1024);
  return fs.readFileSync(filename);
};
const json = filename => JSON.parse(read(filename));
const put = (name, value) => fs.writeFileSync(path.join(here, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
const bundles = [
  { id: 'original-v5', commit: '14179c5eae195757ed5e83fe31a51971597700b6', directory: 'preparation-v5/release-ARRAY-S06-20260828-02', records: 437, rawBytes: 116980358, maxExpanded: 192 * 1024 * 1024, archiveHash: '3dbb6dc3708156e0c895b04aacf78f508322b6b08336acff78a6aa53cd707a0c', archiveBlob: 'dd36833ede265113a28011608982731e8a1fd314', indexBlob: '8a4041b01a2bf2efcd46f7450d83ac75174d84de', auditBlob: '78f4a6ac41c97081f1997c4da69cf2fdfda605b1' },
  { id: 'versioned-tail', commit: '5fafd41c95594c107be9704b5a2346567d77e265', directory: 'continuation-v1/release-ARRAY-TAIL-20260828-01', records: 103, rawBytes: 17733842, maxExpanded: 64 * 1024 * 1024, archiveHash: '53507c36482a956ef793c6fda2c718a3dc01aad64bf03c3db59a918ae331cc16', archiveBlob: 'a9be6e538fbe8055d9e10a739acea0ebad7802c1', indexBlob: '3027529f7356b80c1adc19a8e7f07caf18f5c1af', auditBlob: '66c98f8c6414c44c3df5a450283baa0ffdb301d3' }
];
for (const bundle of bundles) {
  const directory = path.join(successor, bundle.directory);
  const archivePath = path.join(directory, 'RECORDS.jsonl.gz');
  const archive = read(archivePath), indexBytes = read(path.join(directory, 'CAPTURE-INDEX.json')), auditBytes = read(path.join(directory, 'ACTUAL-AUDIT.json'));
  assert.equal(digest(archive), bundle.archiveHash);
  assert.equal(blob(archive), bundle.archiveBlob);
  assert.equal(blob(indexBytes), bundle.indexBlob);
  assert.equal(blob(auditBytes), bundle.auditBlob);
  bundle.index = JSON.parse(indexBytes); bundle.audit = JSON.parse(auditBytes); bundle.values = new Map();
  assert.equal(bundle.index.records.length, bundle.records);
  assert.equal(bundle.index.rawRecordBytes, bundle.rawBytes);
  assert.equal(bundle.index.archive.sha256, bundle.archiveHash);
  let count = 0, total = 0, expanded = 0;
  const input = fs.createReadStream(archivePath).pipe(createGunzip());
  input.on('data', bytes => { expanded += bytes.length; if (expanded > bundle.maxExpanded) input.destroy(new Error('DATA decode bound')); });
  try {
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      assert.ok(count < bundle.records && line.length <= 32 * 1024 * 1024);
      const row = JSON.parse(line), expected = bundle.index.records[count++], bytes = Buffer.from(row.base64, 'base64');
      assert.match(row.name, /^[A-Za-z0-9_-]+\.json$/u);
      assert.equal(row.name, expected.name); assert.equal(row.mode, 0o644);
      assert.equal(row.bytes, expected.bytes); assert.equal(bytes.length, expected.bytes);
      assert.equal(row.sha256, expected.sha256); assert.equal(digest(bytes), expected.sha256);
      if (/^(body-|types-|admission-|child-|old-ast-manifest|composition-admission|FINAL)/u.test(row.name)) bundle.values.set(row.name, JSON.parse(bytes));
      total += bytes.length;
    }
  } finally { input.destroy(); }
  assert.equal(count, bundle.records); assert.equal(total, bundle.rawBytes);
  bundle.authentication = { id: bundle.id, commit: bundle.commit, archive: path.relative(own, archivePath), sha256: bundle.archiveHash, archiveBlob: bundle.archiveBlob, indexBlob: bundle.indexBlob, auditBlob: bundle.auditBlob, verifiedRecords: count, verifiedRawBytes: total };
  bundle.bodies = bundle.audit.bodies.map(summary => {
    const raw = bundle.values.get(summary.record); assert.ok(raw);
    assert.deepEqual(raw.job, summary.job); assert.equal(raw.verdict.coherent, summary.coherent);
    assert.equal(raw.verdict.mutantKilled, summary.mutantKilled);
    assert.deepEqual(raw.verdict.observations.map(row => ({ id: row.id, pass: row.pass })), summary.observations.map(row => ({ id: row.id, pass: row.pass })));
    return { record: summary.record, ...raw };
  });
  const final = bundle.values.get('FINAL.json');
  assert.equal(final.candidate, 'c0adae539c736db0e4023d401562ce958d9ebb00');
  assert.equal(final.composition, '30f88590b66b88dc9694a56c85f1ee690f02218b');
  assert.equal(final.packageSha256, 'e12ed19882b6722503a8fb962ca88e0d6c40300a7e76acc3f81aef5961e0a3a3');
  assert.equal(final.accounting.active, 0);
  assert.ok(final.accounting.children.every(child => child.retired && child.groupAbsent && child.closeObserved && child.supervisorSettled));
  for (const owner of final.accounting.children) {
    const record = path.basename(owner.receipt.path), entry = bundle.index.records.find(row => row.name === record);
    assert.equal(entry.sha256, owner.receipt.sha256);
    const child = bundle.values.get(record); assert.ok(child.closeObserved && child.groupAbsent);
  }
}
const [old, tail] = bundles;
assert.equal(old.audit.coordinatorExitCode, 78);
assert.equal(old.audit.accepted, false);
assert.equal(tail.audit.coordinatorExitCode, 0);
assert.equal(tail.audit.affectedTailAccepted, true);
const scopeBytes = read(path.join(successor, 'SCOPE-BINDING-v2.json'));
assert.equal(digest(scopeBytes), 'ed7d15f4026bb81df52362956939236c7c5f04fb7285f6acc5f9e5ba803d84f3');
const scope = JSON.parse(scopeBytes);
const sourceRoot = path.join(successor, 'continuation-v1/RUN-ARRAY-TAIL-20260828-01/source');
for (const entry of scope.selectedSource) {
  assert.notEqual(path.basename(entry.path), 'AGENTS.md');
  const filename = path.join(sourceRoot, entry.path), bytes = read(filename);
  assert.equal(digest(bytes), entry.sha256); assert.equal(bytes.length, entry.bytes);
  assert.equal(fs.lstatSync(filename).mode & 0o777, parseInt(entry.mode, 8) & 0o777);
}
const finalTree = old.values.get('FINAL.json').finalCensuses.find(tree => path.basename(tree.root) === 'apps');
function definition(name) {
  const filename = path.join(finalTree.root, 'source-app', name), expected = finalTree.entries[`source-app/${name}`], bytes = read(filename);
  assert.ok(expected); assert.equal(digest(bytes), expected.sha256); assert.equal(bytes.length, expected.bytes);
  return { value: JSON.parse(bytes), reference: { path: filename, sha256: expected.sha256, origin: 'original-v5 FINAL authenticated app census' } };
}
const vectors = definition('VECTORS.json'), controls = definition('CONTROLS.json'), holdouts = definition('HOLDOUTS.json'), h12 = definition('H12-OVERLAY.json'), ast = definition('AST-COMPAT.json'), proofs = definition('SOURCE-PROOFS.json');
const layouts = ['source-build', 'installed', 'moved'];
function reference(bundle, body, id) {
  const observation = body.verdict.observations.find(row => row.id === id); assert.ok(observation);
  return { evidence: bundle.id, commit: bundle.commit, record: body.record, recordSha256: bundle.index.records.find(row => row.name === body.record).sha256, observationId: id, observedPass: observation.pass, category: observation.category, wholeWorkerAccepted: body.verdict.accepted, requiredLoads: observation.detail?.requiredLoads ?? [], observationSha256: digest(Buffer.from(JSON.stringify(observation))) };
}
function originalBody(layout, cohort) { const body = old.bodies.find(row => row.job.label === `${layout}-${cohort}`); assert.ok(body); return body; }
function tailBody(layout, cohort) { const body = tail.bodies.find(row => row.job.stage === 'layout' && row.job.layout === layout && row.job.cohort === cohort); assert.ok(body); return body; }
const mixed = new Set(['M03', 'M07', 'M14', 'M15', 'M20']);
const qualifications = {
  M01: 'Loaded private helper near-MAX hook; not configured public capacity or actual ticket exhaustion by workload.',
  M02: 'Loaded private helper near-MAX hook; atomic/distinct tickets, not public lowered-cap proof.',
  M04: 'Loaded binding-store watch lifetime helper, not every integrated Runtime route.',
  M05: 'Loaded helper absent-binding/ABA watch behavior.',
  M06: 'Loaded reference-counted payload helper.',
  M08: 'Integrated nested restoration and actual terminal cleanup, finite schedule only.',
  M09: 'Actual local/typed/scalar overlay cases, not a universal host middleware claim.',
  M10: 'Private helper B0 plus actual scalar-empty B0 route with zero reservations; not every scalar workload at zero parent budget.',
  M11: 'Configured helper F0 reservation refusal, not invocation telemetry for arbitrary scripts.',
  M12: 'Configured helper F1 metadata refusal; F is not a guaranteed usable element capacity.',
  M13: 'Configured helper exact checked derived overflow; not a full numerical-domain proof.',
  M16: 'Actual Runtime maximum-deletion path with finite observed accounting; no injected public-boundary counters.',
  M17: 'Actual invoke snapshot and dotglob epoch change, one controlled checkpoint; no arbitrary scheduler proof.',
  M18: 'Actual two public execs and internal invokes: fresh public/shared internal roots, finite cohort.',
  M19: 'Loaded helper UTF16 scan versus UTF8 materialization controls, not all command formatting accounting.',
  M22: 'Versioned actual Runtime prepared-write bridge: caller identity and readonly-before-stale; escaping is BRIDGE_CAPTURE fulfilled0, not global public escaping-rejection proof.',
  P03: 'Alias of actual snapshot/epoch path M17, not additional independent mechanism.',
  P04: 'Alias of M22-v2; BRIDGE_CAPTURE escaping fulfilled0, not separate public propagation proof.',
  P05: 'Alias/overlap with nested restoration M08.',
  P09: 'Only frozen registered-command sink-error route fulfills1 with buffered emoji/exact diagnostic; limit/caller/cleanup rejection routes separate.',
  P10: 'Epoch changes for accepted getopts/CD/LET/dotglob/STACK writers; only actual pushd/popd marker changes required.',
  'H12-v2': 'Root-ratified default-IFS-only project profile, not G8 implication/native observation; old H12 held with no expected output remains.',
  O11: 'Original semantic values retained; versioned terminal observer fixes NamedBinding/IndexedBinding discrimination and cleanup forwarding.',
  S06: 'Successor semantic repair; original c7 failure and public quote-provenance limitations retained.'
};
const groups = {};
function mapGroup(name, definitions, cohort) {
  groups[name] = definitions.map(item => {
    const id = item.id;
    const row = { id, definition: item, proofClass: id === 'M21' ? 'SOURCE_ONLY' : mixed.has(id) ? 'MIXED' : name === 'mechanical' ? 'BOUNDED_LOADED_MECHANISM' : name === 'ast' ? 'PUBLIC_AST_FOUR_INPUTS_ONLY' : name === 'operations' ? 'PUBLIC_OR_INSTRUMENTED_ROUTE' : 'PUBLIC_BEHAVIOR', qualification: qualifications[id] ?? null, layouts: {} };
    if (id.startsWith('M')) {
      const proof = proofs.value.find(proof => proof.id === id);
      if (proof) { row.sourceArgument = proof; row.qualification = proof.limitation; }
    }
    for (const layout of layouts) {
      const initial = originalBody(layout, cohort), original = reference(old, initial, id);
      let selected = original;
      if (id === 'M22' || id === 'P04') selected = reference(tail, tailBody(layout, 'mechanical'), 'M22');
      else if (id === 'P09' || id === 'P10') selected = reference(tail, tailBody(layout, 'operations'), id);
      assert.equal(selected.observedPass, true);
      row.layouts[layout] = { original, selected, versioned: selected.evidence !== original.evidence, originalRetained: true };
    }
    return row;
  });
}
mapGroup('semantic', [...vectors.value.splice, ...vectors.value.zeroView], 'semantic');
mapGroup('mechanical', controls.value.controls, 'mechanical');
mapGroup('holdouts', holdouts.value.semantic.map(row => row.id === 'H12' ? { id: 'H12-v2', script: h12.value.script, ...h12.value.expected, basis: h12.value.basis, original: row } : row), 'holdouts');
mapGroup('operations', holdouts.value.operations, 'operations');
mapGroup('ast', ast.value.cases, 'ast');
assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([name, rows]) => [name, rows.length])), { semantic: 33, mechanical: 22, holdouts: 16, operations: 10, ast: 4 });
const expectedTypes = [
  ['public', 0, []], ['ast', 0, []],
  ['negative-option', 2, ["negative-option.mts(5,3): error TS2353: Object literal may only specify known properties, and 'arrays' does not exist in type 'ShellOptions'."]],
  ['negative-limit', 2, ["negative-limit.mts(3,3): error TS2353: Object literal may only specify known properties, and 'arrayWork' does not exist in type 'ShellLimits'."]],
  ['negative-export', 2, ['negative-export.mts(1,10): error TS2305: Module \u0027"virtual-bash"\u0027 has no exported member \u0027ArrayLedger\u0027.']],
  ['option-inverse', 0, []], ['limit-inverse', 0, []], ['export-inverse', 0, []],
  ['original-public', 2, ["original-public.mts(5,39): error TS2322: Type '(context: ShellCommandContext) => Promise<CommandResult>' is not assignable to type 'CommandHandler'.", "original-public.mts(6,3): error TS2722: Cannot invoke an object which is possibly 'undefined'."]],
  ['ast-negative', 2, ['ast-negative.mts(11,22): error TS2322: Type \u0027{ kind: "synthetic-unhandled"; }\u0027 is not assignable to type \u0027never\u0027.']]
];
groups.types = expectedTypes.map(([id, code, diagnostics]) => ({ id, expectedCode: code, exactDiagnostics: diagnostics, qualification: code === 0 ? 'Actual original compiler success, not rerun' : 'Actual exact negative diagnostic expectation, not behavior acceptance', layouts: Object.fromEntries(layouts.map(layout => {
  const filename = `types-${layout}.json`, receipt = old.values.get(filename), outcome = receipt.results.find(row => row.id === id);
  assert.ok(outcome?.accepted); assert.equal(outcome.run.code, code);
  const actual = (outcome.run.stdout + outcome.run.stderr).split(/\r?\n/u).filter(line => /error TS\d+:/u.test(line));
  assert.deepEqual(actual, diagnostics);
  assert.ok(outcome.run.closeObserved && outcome.run.groupAbsent && !outcome.run.fault && !outcome.run.signal);
  assert.ok(outcome.run.stdout.includes(`Module name 'virtual-bash' was successfully resolved to '${receipt.binding.rootDeclaration}'`));
  const prior = tail.audit.priorTypes.find(row => row.layout === layout), hash = old.index.records.find(row => row.name === filename).sha256;
  assert.equal(prior.sha256, hash);
  return [layout, { evidence: old.id, record: filename, recordSha256: hash, accepted: outcome.accepted, actualCode: outcome.run.code, actualPid: outcome.run.pid, rootDeclaration: receipt.binding.rootDeclaration, inheritedUnchangedByTail: true }];
})) }));
const originalKills = old.bodies.filter(body => body.job.label.startsWith('U') && body.verdict.mutantKilled);
assert.deepEqual(originalKills.map(body => body.job.label), ['U01', 'U02', 'U03', 'U04', 'U05', 'U06', 'U07', 'U10']);
const tailKills = tail.bodies.filter(body => body.job.label.startsWith('U') && body.verdict.mutantKilled);
assert.deepEqual(tailKills.map(body => body.job.label), ['U08', 'U09', 'U11', 'U12', 'U13-S06']);
const positiveRef = (id, stage) => {
  const body = tail.bodies.find(body => body.job.stage === stage && body.verdict.observations.some(row => row.id === id));
  assert.ok(body); const ref = reference(tail, body, id); assert.equal(ref.observedPass, true); return ref;
};
const mutations = [...originalKills.map(body => [old, body]), ...tailKills.map(body => [tail, body])].map(([bundle, body]) => {
  assert.equal(body.verdict.coherent, true);
  assert.equal(body.verdict.activations.length, 1);
  const activation = body.verdict.activations[0]; assert.ok(activation.hits > 0);
  assert.ok(body.verdict.loads.some(load => load.path === activation.path && load.sha256 === activation.sha256));
  const id = body.job.label, prior = old.bodies.find(row => row.job.label === id);
  return { id, chosenEvidence: bundle.id, record: body.record, recordSha256: bundle.index.records.find(row => row.name === body.record).sha256, activatedLoadedModule: activation, qualifiedKill: body.verdict.mutantKilled, failures: body.verdict.failed, companionPasses: body.verdict.observations.filter(row => row.pass).map(row => row.id), phaseSpecificity: body.verdict.phaseSpecificity ?? null, originalState: prior ? { loaded: true, activated: prior.verdict.activations.length > 0, killed: prior.verdict.mutantKilled, record: prior.record } : { loaded: false, activated: false, killed: false, state: id === 'U08' ? 'blocked by positive prerequisite' : 'not dispatched after stop' }, restoredControls: body.job.ids.map(observationId => observationId === 'P11-U11' ? { id: observationId, before: reference(tail, tailBody('source-build', 'operations'), observationId), restoredOriginalP06: positiveRef('P06', 'positive-after'), qualification: 'Mixed P11 positive ran across all three unmutated layouts before mutation; restored-after is original P06, not a new P11-after rerun.' } : { id: observationId, before: positiveRef(observationId, 'positive-before'), after: positiveRef(observationId, 'positive-after'), qualification: bundle === old ? 'Later cross-attempt same-candidate restored control; original interrupted attempt not rescored.' : 'Same tail before/after companions.' }) };
}).sort((left, right) => Number(left.id.match(/\d+/u)[0]) - Number(right.id.match(/\d+/u)[0]));
assert.equal(new Set(mutations.map(row => row.id)).size, 13);
const sourceArguments = proofs.value.map(proof => ({ ...proof, boundPremises: proof.premises.map(premise => {
  const selected = scope.selectedSource.find(row => row.path === premise.path), source = read(path.join(sourceRoot, premise.path));
  assert.equal(digest(source), selected.sha256);
  assert.equal(source.toString().split(premise.literal).length - 1, premise.occurrences);
  return { ...premise, sha256: selected.sha256 };
}) }));
const oldAstChild = [...old.values.entries()].find(([name, value]) => name.startsWith('child-') && value.args?.some(arg => arg.endsWith('/old-ast/ast-worker.mjs')));
assert.ok(oldAstChild); assert.equal(oldAstChild[1].code, 0);
const publicAst = { exactInputs: ast.value.cases, oldPackageSha256: ast.value.oldPackageSha256, successorPackageSha256: ast.value.successorPackageSha256, actualOldParserChild: { record: oldAstChild[0], sha256: old.index.records.find(row => row.name === oldAstChild[0]).sha256, executable: oldAstChild[1].executable, pid: oldAstChild[1].pid, code: oldAstChild[1].code }, declarations: old.audit.types.map(row => ({ layout: row.layout, qualification: row.publicDeclarations, unapprovedAstChanges: row.unapprovedAstChanges })), limitation: 'Four actual own-data AST comparisons and211 nonprivate declaration/package metadata byte matches against c7, not exhaustive DOTGLOB AST parity. Module-local WeakMaps/WeakSet require same parser/runtime graph; metadata serialization/structuredClone/cross-copy transfer is not proved or exported.' };
const helperText = read(path.join(sourceRoot, 'src/shell/arrays/syntax.ts')).toString();
assert.ok(helperText.includes('new WeakMap<Word, ArrayAssignment>()') && helperText.includes('new WeakMap<WordPart, ArraySelector>()') && helperText.includes('new WeakSet<WordPart>()'));
const nonAdditiveCount = { semanticFamilies: 33, mechanicalFamilies: 22, sourceOnly: ['M21'], mixed: [...mixed], holdouts: 16, operationFamilies: 10, astInputs: 4, typeCasesPerLayout: 10, layouts, uniqueOriginalKilledFamilies: originalKills.map(body => body.job.label), newlyQualifiedU01ThroughU12: ['U08', 'U09', 'U11', 'U12'], separateS06Reversion: 'U13-S06', uniqueKilledFamiliesIncludingReversion: 13, originalLoadedActivatedKilledRetained: [10, 9, 8], tailLoadedActivatedKilled: [5, 5, 5], obligationLayoutReferences: 285, qualification: 'Counts span behavior, helper, source argument, AST and compiler controls; not285 behavior passes. No old coordinator status is changed.' };
const map = { kind: 'SOURCE-DATA synthesis only; no actual new executions', date: '2026-08-28', recommendation: 'Recommend ROOT qualified acceptance only on the exact selected DOTGLOB base, with listed proof limitations; not current HEAD integration or unconditional parity.', binding: { candidate: scope.product, composition: scope.selectedComposition, base: '37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e', packageSha256: scope.package.sha256, packageMembers: Object.keys(scope.package.inventory).length, selectedInputs: scope.selectedSource.length, defaults: 77 }, counts: nonAdditiveCount, evidence: bundles.map(bundle => bundle.authentication), groups, sourceArguments, mutations, publicAst, definitions: [vectors, controls, holdouts, h12, ast, proofs].map(row => row.reference), exclusions: ['M22 escaping is BRIDGE_CAPTURE fulfilled0, not global public escaping rejection proof.', 'P04 aliases M22; P03/P05 also overlap mechanical paths.', 'No new candidate/compiler/native/product execution, no extra cleanup.', 'No current HEAD/78-default integration, provider recomposition or whole-product gate.', 'Private G4A E input/post-transfer formatting excluded; logical work is not CPU/RSS/hard preemption.', 'Original H12 held history, c7 failures, v3-v5 admission failures, original HOLD and reporting-data failure remain unchanged.'] };
put('PROOF-MAP.json', map);
put('DATA-RECEIPT.json', { kind: 'Read/hash/decode/source-premise verification; zero product imports/children', scriptSha256: digest(read(fileURLToPath(import.meta.url))), proofMapSha256: digest(read(path.join(here, 'PROOF-MAP.json'))), authenticatedBundles: bundles.map(bundle => bundle.authentication), totalAuthenticatedRecords: 540, totalAuthenticatedRawBytes: 134714200, selectedInputsRechecked: scope.selectedSource.length, sourcePremisesChecked: sourceArguments.reduce((sum, proof) => sum + proof.boundPremises.length, 0), newCandidateExecutions: 0, newCompilerExecutions: 0, newNativeExecutions: 0, removedFiles: 0, counts: nonAdditiveCount });
console.log(JSON.stringify({ map: path.join(here, 'PROOF-MAP.json'), authenticatedRecords: 540, references: 285, originalKills: 8, newlyQualifiedFamilies: 4, separateReversion: 1, sourceOnly: ['M21'], mixed: [...mixed], productExecutions: 0 }));
