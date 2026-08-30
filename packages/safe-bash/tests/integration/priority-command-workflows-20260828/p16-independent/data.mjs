import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { regular, sha, objectHash } from './common.mjs';
export function inspectData(repo, author) {
  const parent = path.resolve(author, '../..'), prior = path.join(parent, 'npm-pin-rebinding-v2'), proof = path.join(parent, 'npm-pin-rebinding-independent/o6-composition-v3');
  const json = filename => JSON.parse(regular(filename)), read = name => json(path.join(author, name));
  const rows = [], details = {};
  const check = (id, body) => { try { body(); rows.push({ id, passed: true }); } catch (reason) { rows.push({ id, passed: false, error: String(reason?.stack ?? reason) }); } };
  const bindings = read('BINDINGS.json'), encoded = regular(path.join(repo, bindings.archive.path));
  assert.equal(encoded.length, bindings.archive.bytes); assert.equal(sha(encoded), bindings.archive.sha256);
  const zipped = Buffer.from(encoded.toString(), 'base64'); assert.equal(sha(zipped), bindings.archive.gzipSha256);
  const raw = JSON.parse(gunzipSync(zipped, { maxOutputLength: bindings.archive.decodeBound }));
  const selected = raw.source.inputs, membership = json(path.join(proof, 'MEMBERSHIP-268.json')), rolemap = json(path.join(proof, 'ROLEMAP.json')), priorResult = json(path.join(proof, 'RESULTS.json'));
  const cells = row => ({ path: row.path, revision: row.revision, blob: row.blob ?? row.oid, mode: row.mode, bytes: row.bytes, sha256: row.sha256 });
  check('D01-identical-complete268-map', () => { assert.equal(selected.length, 268); assert.deepEqual(selected.map(cells), membership.map(cells)); assert.deepEqual(selected.map(cells), rolemap.inputs.map(cells)); assert.equal(sha(JSON.stringify(selected)), bindings.selected.selectedInputTableSha256); assert.equal(priorResult.sourceInputs, 268); assert.equal(priorResult.originVerified, 268); assert.equal(priorResult.composedVerified, 268); assert.deepEqual(priorResult.unresolved, []); });
  check('D02-every-selected-byte', () => {
    assert.deepEqual(Object.keys(raw.source.selectedBytes).sort(), selected.map(row => row.path).sort());
    for (const row of selected) { assert.ok(!row.path.split('/').includes('AGENTS.md')); const bytes = Buffer.from(raw.source.selectedBytes[row.path], 'base64'); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256); assert.equal(objectHash('blob', bytes), row.blob); assert.equal(row.mode, '100644'); }
  });
  check('D03-derived-root-inherited-not-objectlookup', () => {
    const bytes = regular(path.join(proof, 'COMPOSED-ROOT.tree.data'));
    assert.equal(objectHash('tree', bytes), '8437e4eda904e1248c25eeef0d9d455b1d251495'); assert.equal(sha(bytes), priorResult.rootSha256);
    assert.equal(rolemap.target.role, 'DERIVED_ONLY'); assert.equal(rolemap.target.commit, null);
    assert.deepEqual(selected.filter(row => row.role !== 'public78 unchanged baseline').map(cells), rolemap.inputs.filter(row => row.role !== 'public78 unchanged baseline').map(cells));
    details.inheritance = { authority: '3f780826f645b7297e8cf9b5030e55385b235aff', completeMembership: 268, rootSha256: sha(bytes), newFullTreeTraversal: false, sparseWitnessPromoted: false, derivedObjectRequested: false };
  });
  check('D04-identical-package858', () => {
    const bytes = Buffer.from(raw.pack.base64, 'base64'); assert.equal(bytes.length, 759089); assert.equal(sha(bytes), '6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e'); assert.equal(bindings.package.sha256, rolemap.packageSha256); assert.equal(sha(JSON.stringify(raw.fullInstalledBefore)), bindings.package.installedManifestSha256); assert.equal(Object.values(raw.fullInstalledBefore).filter(row => row.kind === 'file').length, 858);
    details.package = { sha256: sha(bytes), bytes: bytes.length, regularFiles: 858, fullTarProof: 'inherited exact-byte accepted package, not repacked/reinstalled' };
  });
  const cases = read('CASES.json'), fixtures = read('FIXTURES.json'), oldCases = json(path.join(prior, 'CASES.json')), all = [...cases.workflows, ...cases.controls], oldAll = [...oldCases.workflows, ...oldCases.controls];
  check('D05-original31-semantic-inputs', () => { assert.equal(all.length, 31); all.forEach((row, index) => { const next = structuredClone(row); delete next.traceContract; if (row.id === 'P16') next.childObservation = oldAll[index].childObservation; assert.deepEqual(next, oldAll[index]); }); assert.deepEqual(fixtures, json(path.join(prior, 'FIXTURES.json'))); assert.deepEqual(cases.defaults, oldCases.defaults); });
  const p16 = all.find(row => row.id === 'P16');
  check('D06-exact-predeclared-P16-tuple-authority', () => {
    const old = oldAll.find(row => row.id === 'P16'); assert.deepEqual(p16.literalChildArgv, old.literalChildArgv);
    assert.deepEqual(p16.traceContract.stages, [
      { argv: old.argv[0], kind: 'result', exitCode: 0, stdinIsDefault: true },
      { argv: old.argv[1], kind: 'result', exitCode: 0, stdinIsDefault: false },
      ...old.literalChildArgv.map(argv => ({ argv, kind: 'result', exitCode: 0, stdinIsDefault: true })),
    ]); assert.deepEqual(p16.traceContract.before, [[0,2],[2,3]]); assert.equal(Buffer.from(p16.expected.stdoutBase64, 'base64').length, 51);
  });
  check('D07-other30-no-generic-nested-admission', () => {
    for (const row of all.filter(row => row.id !== 'P16')) { assert.deepEqual(row.traceContract.stages.map(stage => stage.argv), row.argv); assert.deepEqual(row.traceContract.before, []); row.traceContract.stages.forEach((stage, index) => { if (row.expected.stageExitCodes[index] === null) { assert.equal(stage.kind, 'throw'); assert.equal(stage.callerReasonSameObject, true); } else { assert.equal(stage.kind, 'result'); assert.equal(stage.exitCode, row.expected.stageExitCodes[index]); } }); }
  });
  const grantBytes = regular(path.join(author, 'GO.template.json')), grant = JSON.parse(grantBytes), selection = read('SELECTION.json'), ids = oldAll.map(row => row.id);
  const expectedSelection = [...ids.slice(15).map(id => 'source-build:' + id), ...ids.map(id => 'offline-installed:' + id), ...ids.map(id => 'physically-moved:' + id)];
  check('D08-exact78-not-old15-replay', () => { assert.equal(expectedSelection.length, 78); assert.deepEqual(grant.selection, expectedSelection); assert.deepEqual(selection.calls.map(row => row.layout + ':' + row.id), expectedSelection); assert.deepEqual(selection.counts, { total:78, originallyUnrun:77, sourceOriginallyUnrun:15, installedOriginallyUnrun:31, movedOriginallyUnrun:31, newVersionSourceP16Repeat:1 }); assert.equal(selection.calls.filter(row => row.role === 'new-version-repeat').length, 1); });
  const adapter = regular(path.join(author, 'future-adapter.mjs')).toString(), admission = regular(path.join(author, 'admission.mjs')).toString(), supervisor = regular(path.join(author, 'future-supervisor.mjs')).toString(), entry = regular(path.join(author, 'runtime-entry.mjs')).toString();
  check('D09-two-validator-sites-one-helper', () => { assert.equal(adapter.split('assertTraceStages(row, trace.stages);').length - 1, 2); assert.ok(adapter.includes("from './stage-helper.mjs'")); assert.ok(adapter.indexOf('trace.stages.push(stage)') < adapter.indexOf('const result = await next()')); assert.ok(adapter.includes('stage.callerReasonSameObject = reason === callerReason')); assert.ok(adapter.includes('checkNamespace(trace.before, trace.after, row.expected); checkGuards(row, trace);')); });
  check('D10-runtime-helper-copy-loadbinding', () => { assert.match(admission, /runtimeFiles = \[[^\n]*'stage-helper\.mjs'/); assert.ok(supervisor.includes('for (const name of runtimeFiles) fs.copyFileSync')); assert.ok(supervisor.includes('for (const name of runtimeFiles)')); assert.ok(entry.includes('UNSELECTED_CALL_REFUSED')); assert.ok(entry.includes('admitFile(resolved, admission.files)')); });
  const seal = read('PREPARATION-SEAL-v4.json'), roles = read('AUTHORITY-ROLES.json');
  check('D11-seal-code-authority', () => {
    assert.equal(seal.codeCommit, '497c566083fac2eda1ddad14edba052e3c0a6d54'); assert.equal(seal.packet, '4088ee524e9ec6ae47ef90af3538dc35addcc3a0');
    for (const row of seal.files) { const bytes = regular(path.resolve(author, row.path)); assert.equal(sha(bytes), row.sha256, row.path); assert.equal(bytes.length, row.bytes); }
    assert.equal(sha(JSON.stringify(seal.codeIdentity.rows)), seal.codeIdentity.sha256);
    for (const [name, digest, length] of seal.codeIdentity.rows) { const bytes = regular(path.resolve(author, name)); assert.equal(sha(bytes), digest); assert.equal(bytes.length, length); }
    assert.equal(roles.code.rows.length, 8); assert.ok(roles.code.rows.every(row => row.expression.startsWith(seal.codeCommit + ':')));
  });
  check('D12-sourceauth-306-unchanged-eight-packet-rebinds', () => {
    const current = read('SOURCE-AUTH.json'), old = json(path.join(prior, 'SOURCE-AUTH.json'));
    assert.equal(current.rows.length, 314); assert.equal(current.runtimeCodeAuthority.length, 8);
    const fresh = current.rows.filter(row => row.expression.startsWith(seal.packet + ':')), previous = old.rows.filter(row => row.expression.startsWith('7ef6e6b816ccc6b2449605c7950ab825d148a529:'));
    assert.equal(fresh.length, 8); assert.equal(previous.length, 8); assert.deepEqual(current.rows.filter(row => !fresh.includes(row)), old.rows.filter(row => !previous.includes(row)));
    assert.equal(current.archiveSha256, old.archiveSha256); assert.equal(current.selectedInputTableSha256, old.selectedInputTableSha256); assert.equal(current.selectedInputTableSha256, bindings.selected.selectedInputTableSha256);
    for (const row of fresh) { const filename = row.expression.slice(row.expression.indexOf(':') + 1); assert.equal(sha(regular(path.join(repo, filename))), row.sha256); }
  });
  check('D13-find-invoke-middleware-source-chain', () => {
    const text = name => Buffer.from(raw.source.selectedBytes[name], 'base64').toString();
    assert.ok(text('src/commands/find.ts').includes('directExecutor'));
    const executorPaths = selected.filter(row => row.path.endsWith('.ts') && text(row.path).includes('directExecutor') && text(row.path).includes('context.invoke')).map(row => row.path); assert.ok(executorPaths.length > 0);
    const runtime = text('src/shell/runtime.ts'); assert.ok(runtime.includes('invoke:')); assert.ok(runtime.includes('middleware') || runtime.includes('dispatcher'));
    details.sourceChain = { find: 'src/commands/find.ts', executorPaths, shell: 'src/shell/runtime.ts', proof: 'authenticated selected source and recorded entry-before-next; no runtime execution' };
  });
  const budget = read('PARENT-BUDGET.template.json');
  check('D14-fresh-logical-budget-arithmetic', () => {
    assert.equal(budget.id, 'priority-command-workflows-20260828/future-run-02'); assert.equal(budget.deadlineEpochMs, 1788026556000);
    assert.deepEqual(budget.remaining, { children:85,workerStarts:312,loaderThreads:82,captureBytes:356515840,scratchBytes:536870912 });
    assert.equal(85, 78 + 3 + 4); assert.equal(312, 78 * 4); assert.equal(82, 78 + 4); assert.equal(356515840, 85 * 4194304); assert.equal(grant.bounds.windowMs, 1200000);
    assert.ok(supervisor.includes('Math.min(parentBudget.deadlineEpochMs, started + bounds.windowMs)')); assert.ok(supervisor.includes('for (const id of ids.filter(id => selectedCalls.includes'));
  });
  check('D15-old-budget-closed-and-no-activation', () => { assert.equal(roles.oldReservation.status, 'CLOSED_TO_FUTURE_CONSUMPTION'); for (const key of ['refund','release','reuse','reset']) assert.equal(roles.oldReservation[key], false); assert.equal(roles.historicalResults.aggregate, 'UNKNOWN'); assert.equal(roles.historicalResults.withheld, 4); assert.equal(grant.decision, 'PREPARATION_ONLY_NOT_A_GRANT'); for (const filename of ['GO.json','PARENT-BUDGET.json']) assert.equal(fs.existsSync(path.join(author, filename)), false); assert.equal(fs.existsSync(grant.root), false); });
  check('D16-historical-null-not-HEAD', () => { assert.equal(rolemap.target.commit, null); assert.equal(rolemap.target.role, 'DERIVED_ONLY'); assert.ok(!JSON.stringify(roles.code.rows).includes('HEAD:')); assert.ok(roles.inheritedFiles.every(row => row.role.includes('HISTORICAL') || row.role.includes('DEPENDENCY') || row.role.includes('DATA'))); });
  const actualGoBytes = Buffer.from(grantBytes.toString().replace('"PREPARATION_ONLY_NOT_A_GRANT"', '"GO"'));
  details.templates = { inactiveGo: { bytes: grantBytes.length, sha256: sha(grantBytes) }, hypotheticalDecisionOnlyGoNotWrittenOrAuthorized: { bytes: actualGoBytes.length, sha256: sha(actualGoBytes) }, budget: { bytes: regular(path.join(author, 'PARENT-BUDGET.template.json')).length, sha256: sha(regular(path.join(author, 'PARENT-BUDGET.template.json'))) }, preparationSeal: { bytes: regular(path.join(author, 'PREPARATION-SEAL-v4.json')).length, sha256: sha(regular(path.join(author, 'PREPARATION-SEAL-v4.json'))) }, codeIdentity: seal.codeIdentity.sha256, supervisorSha256: sha(supervisor), helperSha256: sha(regular(path.join(author, 'stage-helper.mjs'))), command: grant.command, deadlineISO: new Date(budget.deadlineEpochMs).toISOString() };
  return { rows, details, passed: rows.filter(row => row.passed).length, total: rows.length, allPassed: rows.every(row => row.passed), workerInput: { controls: read('DATA-CONTROLS.presealed.json'), row: p16, grant, oldGrant: json(path.join(prior, 'GO.json')), budget, oldBudget: json(path.join(parent, 'PARENT-BUDGET.json')) } };
}
