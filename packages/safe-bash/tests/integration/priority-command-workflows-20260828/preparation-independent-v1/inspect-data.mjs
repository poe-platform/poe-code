import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';

const candidate = '116f5dd79f14032ebcf9a2e46de0d912005c3ffa';
const sealCommit = '8bb0ac19518a227c06a67d6ef8d273af2111894c';
const packet = '5d432becbe385eb323c10feecfa5e982bfd3b099';
const directory = 'tests/integration/priority-command-workflows-20260828';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let gitChildren = 0;
const git = (...args) => { gitChildren++; return execFileSync('git', args, { cwd: '/Users/kjopek/Workspace/safe-bash', timeout: 20000, maxBuffer: 32 * 1024 * 1024 }); };
const blob = (revision, filename) => git('show', `${revision}:${filename}`);
const bindings = JSON.parse(blob(packet, `${directory}/BINDINGS.json`));
const archive = blob(bindings.archive.commit, bindings.archive.path);
assert.equal(digest(archive), bindings.archive.sha256);
const gzip = Buffer.from(archive.toString(), 'base64');
assert.equal(digest(gzip), bindings.archive.gzipSha256);
const raw = JSON.parse(gunzipSync(gzip, { maxOutputLength: bindings.archive.decodeBound }));
assert.equal(digest(JSON.stringify(raw.source.inputs)), bindings.selected.selectedInputTableSha256);
const source = filename => Buffer.from(raw.source.selectedBytes[filename], 'base64').toString();
const argument = process.argv[2];
if (argument === 'source') {
  const filename = process.argv[3];
  assert.ok(Object.hasOwn(raw.source.selectedBytes, filename));
  const start = Number(process.argv[4] ?? 1), end = Number(process.argv[5] ?? Number.MAX_SAFE_INTEGER);
  console.log(source(filename).split('\n').map((line, index) => `${index + 1}\t${line}`).slice(start - 1, end).join('\n'));
} else if (argument === 'sources') {
  console.log(raw.source.inputs.map(row => row.path).filter(name => /(?:shell|regex|network|index|readonly|memory|command)/u.test(name)).join('\n'));
} else if (argument === 'cases') {
  const cases = JSON.parse(blob(packet, `${directory}/CASES.json`));
  const fixtures = JSON.parse(blob(packet, `${directory}/FIXTURES.json`));
  const ids = process.argv.slice(3);
  for (const row of [...cases.workflows, ...cases.controls].filter(row => ids.length === 0 || ids.includes(row.id))) console.log(JSON.stringify({ row, fixture: fixtures.rows.find(fixture => fixture.id === row.id) }, null, 2));
} else if (argument === 'summary') {
  console.log(JSON.stringify({ candidate, packet, sourceKeys: Object.keys(raw.source), input: raw.source.inputs[0], selectedValueType: typeof raw.source.selectedBytes[raw.source.inputs[0].path], packKeys: Object.keys(raw.pack), emitted: Object.keys(raw.source.emitted).length, fullInstalled: Object.keys(raw.fullInstalledBefore).length }, null, 2));
} else if (argument === 'verify') {
  const checks = [];
  const check = (name, body) => { body(); checks.push(name); };
  const objectHash = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
  const packetFiles = ['BINDINGS.json', 'CASES.json', 'EXECUTION-RECIPE.md', 'FIXTURES.json', 'MANIFEST.json', 'READY.md', 'SCHEMA.json', 'verify.mjs'];
  const preserved = [];
  for (const filename of packetFiles) check(`frozen-packet:${filename}`, () => {
    const original = blob(packet, `${directory}/${filename}`);
    assert.deepEqual(blob(candidate, `${directory}/${filename}`), original);
    preserved.push({ path: filename, bytes: original.length, sha256: digest(original) });
  });
  const declarationPath = 'tests/shell/declare-design-20260828/ratified-v3/MATRIX.md';
  const declaration = blob('da935256b8bc2295f9e413f669d34f36b5e04cf9', declarationPath);
  check('declaration-da935256-preserved', () => assert.deepEqual(blob(candidate, declarationPath), declaration));
  const cases = JSON.parse(blob(packet, `${directory}/CASES.json`));
  const fixtures = JSON.parse(blob(packet, `${directory}/FIXTURES.json`));
  const expectedIds = [...Array.from({ length: 24 }, (_, index) => `P${String(index + 1).padStart(2, '0')}`), ...Array.from({ length: 7 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`)];
  check('exact-31-case-and-fixture-ids', () => {
    assert.deepEqual([...cases.workflows, ...cases.controls].map(row => row.id), expectedIds);
    assert.deepEqual(fixtures.rows.map(row => row.id), expectedIds);
  });
  const receipts = [];
  for (const receipt of bindings.receipts) check(`bound-receipt:${receipt.path}`, () => {
    const bytes = blob(receipt.commit, receipt.path);
    assert.equal(digest(bytes), receipt.sha256);
    assert.equal(bytes.length, receipt.bytes);
    receipts.push({ path: receipt.path, sha256: digest(bytes) });
  });
  const sourceRequests = [];
  for (const input of raw.source.inputs) check(`selected-source:${input.path}`, () => {
    const bytes = Buffer.from(raw.source.selectedBytes[input.path], 'base64');
    assert.equal(bytes.length, input.bytes);
    assert.equal(digest(bytes), input.sha256);
    assert.equal(objectHash('blob', bytes), input.blob);
    assert.equal(input.mode, '100644');
    sourceRequests.push({ expression: `${input.revision}:${input.path}`, bytes, oid: input.blob, kind: 'blob' });
  });
  const commitTrees = new Map();
  for (const commit of raw.source.commits) check(`commit-witness:${commit.revision}`, () => {
    const bytes = Buffer.from(commit.base64, 'base64');
    assert.equal(objectHash('commit', bytes), commit.revision);
    assert.equal(/^tree ([a-f0-9]{40})$/mu.exec(bytes.toString())[1], commit.tree);
    commitTrees.set(commit.revision, commit.tree);
    sourceRequests.push({ expression: commit.revision, bytes, oid: commit.revision, kind: 'commit' });
  });
  const trees = new Map();
  const parseTree = tree => {
    const bytes = Buffer.from(tree.base64, 'base64');
    assert.equal(objectHash('tree', bytes), tree.oid);
    const entries = [];
    for (let offset = 0; offset < bytes.length;) {
      const space = bytes.indexOf(32, offset), zero = bytes.indexOf(0, space);
      assert.ok(space > offset && zero > space && zero + 21 <= bytes.length);
      entries.push({ mode: bytes.subarray(offset, space).toString(), name: bytes.subarray(space + 1, zero).toString(), oid: bytes.subarray(zero + 1, zero + 21).toString('hex') });
      offset = zero + 21;
    }
    assert.deepEqual(entries, [...entries].sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.mode === '40000' ? '/' : '')), Buffer.from(right.name + (right.mode === '40000' ? '/' : '')))));
    trees.set(tree.oid, entries);
    return bytes;
  };
  for (const tree of raw.source.reachableTrees) check(`stored-tree-witness:${tree.oid}`, () => sourceRequests.push({ expression: tree.oid, bytes: parseTree(tree), oid: tree.oid, kind: 'tree' }));
  for (const tree of raw.source.reconstructedTrees) check(`derived-tree-witness:${tree.oid}`, () => parseTree(tree));
  const resolve = (tree, filename) => {
    let current = tree;
    const parts = filename.split('/');
    for (const part of parts) { if (!trees.has(current)) return undefined; const entry = trees.get(current).find(row => row.name === part); assert.ok(entry, `${current}:${filename}`); current = entry.oid; }
    return current;
  };
  let witnessedSourcePaths = 0;
  check('available-tree-path-witnesses-consistent', () => {
    for (const input of raw.source.inputs) { const resolved = resolve(commitTrees.get(input.revision), input.path); if (resolved !== undefined) { assert.equal(resolved, input.blob); witnessedSourcePaths++; } }
  });
  const manifestReceipt = bindings.receipts.find(row => row.path.endsWith('coherent78-shell-author-20260828/MANIFEST.json'));
  const manifest = JSON.parse(blob(manifestReceipt.commit, manifestReceipt.path));
  const overrides = new Map(raw.source.componentTable.map(row => [row.path, row.blob]));
  const overlay = (tree, prefix = '') => {
    const entries = trees.get(tree).map(entry => {
      const filename = prefix + entry.name;
      if (overrides.has(filename)) return { ...entry, oid: overrides.get(filename) };
      if (entry.mode === '40000' && [...overrides.keys()].some(key => key.startsWith(filename + '/'))) return { ...entry, oid: overlay(entry.oid, filename + '/') };
      return entry;
    });
    return objectHash('tree', Buffer.concat(entries.map(entry => Buffer.concat([Buffer.from(`${entry.mode} ${entry.name}\0`), Buffer.from(entry.oid, 'hex')]))));
  };
  check('derived-composition-no-object-existence-demand', () => {
    assert.deepEqual(manifest.inputs, raw.source.inputs);
    assert.equal(overrides.size, 5);
    assert.equal(overlay(manifest.baseTree), '8437e4eda904e1248c25eeef0d9d455b1d251495');
    assert.equal(manifest.composedTree, bindings.selected.composition);
  });
  check('stored-source-objects-one-reaped-git-data-batch', () => {
    gitChildren++;
    const batch = execFileSync('git', ['cat-file', '--batch'], { cwd: '/Users/kjopek/Workspace/safe-bash', input: sourceRequests.map(row => row.expression).join('\n') + '\n', timeout: 20000, maxBuffer: 32 * 1024 * 1024 });
    let offset = 0;
    for (const request of sourceRequests) {
      const newline = batch.indexOf(10, offset);
      const [oid, kind, length] = batch.subarray(offset, newline).toString().split(' ');
      assert.equal(oid, request.oid); assert.equal(kind, request.kind); assert.equal(Number(length), request.bytes.length);
      assert.deepEqual(batch.subarray(newline + 1, newline + 1 + Number(length)), request.bytes);
      offset = newline + 2 + Number(length);
      assert.equal(batch[offset - 1], 10);
    }
    assert.equal(offset, batch.length);
  });
  const packageBytes = Buffer.from(raw.pack.base64, 'base64');
  const members = new Map();
  check('full858-package-data-and-installed-manifest', () => {
    assert.equal(packageBytes.length, bindings.package.bytes); assert.equal(digest(packageBytes), bindings.package.sha256);
    assert.equal(digest(JSON.stringify(raw.fullInstalledBefore)), bindings.package.installedManifestSha256);
    const tar = gunzipSync(packageBytes, { maxOutputLength: bindings.package.tarInflateBound });
    for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0;) {
      const header = tar.subarray(offset, offset + 512);
      const name = header.subarray(0, 100).toString().replace(/\0.*$/su, '');
      const size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0.*$/su, '').trim(), 8);
      assert.ok(Number.isSafeInteger(size));
      const kind = header[156];
      assert.ok(kind === 0 || kind === 48, `UNEXPECTED_TAR_KIND:${kind}`);
      assert.ok(name.startsWith('package/') && !members.has(name.slice(8)));
      const bytes = tar.subarray(offset + 512, offset + 512 + size), relative = name.slice(8);
      assert.equal(bytes.length, size); assert.equal(digest(bytes), raw.fullInstalledBefore[relative].sha256);
      members.set(relative, bytes);
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    assert.equal(members.size, 858);
    assert.equal([...members.keys()].filter(name => name.endsWith('.d.ts')).length, 214);
    assert.equal(digest(members.get(bindings.runtimeAdmission.workerEntry.path)), bindings.runtimeAdmission.workerEntry.sha256);
  });
  const workerClosure = new Set();
  const walkImports = filename => {
    if (workerClosure.has(filename)) return;
    assert.ok(members.has(filename), filename); workerClosure.add(filename);
    const text = members.get(filename).toString();
    for (const match of text.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/gu)) walkImports(path.posix.normalize(path.posix.join(path.posix.dirname(filename), match[1])));
  };
  check('accepted-worker-static-import-closure-data', () => walkImports(bindings.runtimeAdmission.workerEntry.path));
  const protocol = JSON.parse(blob(candidate, `${directory}/STUB-PROTOCOL-v2.json`));
  for (const row of protocol.files) check(`candidate-protocol-pin:${row.path}`, () => {
    const bytes = blob(candidate, `${directory}/${row.path}`); assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256);
  });
  const harness = ['admission.mjs', 'source-auth.mjs', 'future-adapter.mjs', 'future-supervisor.mjs', 'runtime-entry.mjs', 'worker-observer.mjs', 'worker-preload.mjs', 'stub-controls.mjs', 'stub-child.mjs', 'PREPARATION.md', 'STUB-PROTOCOL-v2.json'].map(filename => {
    const bytes = blob(candidate, `${directory}/${filename}`); return { path: filename, bytes: bytes.length, sha256: digest(bytes) };
  });
  const priorEvidence = JSON.parse(blob(candidate, `${directory}/stub-evidence-v1/RESULTS.json`));
  const priorProtocol = JSON.parse(blob(candidate, `${directory}/STUB-PROTOCOL.json`));
  check('prior-stub-role-and-source-binding-not-current-proof', () => {
    assert.equal(priorEvidence.role, 'DATA_SYNTHETIC_BENIGN_STUB_ONLY');
    assert.equal(priorEvidence.protocolSha256, digest(blob(candidate, `${directory}/STUB-PROTOCOL.json`)));
    for (const row of priorProtocol.files) assert.equal(digest(blob('812a72b52827f88f03ae87dcf0a0d885b0e011e9', `${directory}/${row.path}`)), row.sha256);
  });
  const sealBytes = blob(sealCommit, `${directory}/PREPARATION-SEAL.json`), seal = JSON.parse(sealBytes);
  check('final-seal-and-code-set-exact-identities', () => {
    assert.equal(digest(sealBytes), '4561e4e3d6ea34ff3c7803ce02294cc2ce61e127c6dddd427e1aef79d253341f');
    assert.equal(seal.codeCommit, candidate);
    assert.equal(digest(JSON.stringify(seal.codeIdentity.rows)), '8d7f684650803c2ec2e5e4471616138341dc22c471921f285d6b7858ef909462');
    for (const [filename, sha256, bytes] of seal.codeIdentity.rows) {
      const original = blob(candidate, `${directory}/${filename}`);
      assert.equal(digest(original), sha256); assert.equal(original.length, bytes);
      assert.deepEqual(blob(sealCommit, `${directory}/${filename}`), original);
    }
  });
  for (const row of seal.files) check(`final-seal-file:${row.path}`, () => {
    const bytes = blob(sealCommit, `${directory}/${row.path}`); assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256);
  });
  const grantTemplate = JSON.parse(blob(sealCommit, `${directory}/GO.template.json`));
  const calls = JSON.parse(blob(sealCommit, `${directory}/CALLS.json`));
  check('sealed93-call-identities-and-nongrant-template', () => {
    assert.equal(grantTemplate.decision, 'PREPARATION_ONLY_NOT_A_GRANT');
    assert.equal(grantTemplate.preparationSealSha256, digest(sealBytes));
    assert.equal(calls.calls.length, 93);
    assert.deepEqual(grantTemplate.ids, expectedIds);
    assert.deepEqual(grantTemplate.layouts.map(row => row.name), ['source-build', 'offline-installed', 'physically-moved']);
    assert.equal(new Set(grantTemplate.layouts.map(row => row.appParent)).size, 3);
    for (const [index, call] of calls.calls.entries()) {
      const layout = grantTemplate.layouts[Math.floor(index / 31)], id = expectedIds[index % 31];
      const row = [...cases.workflows, ...cases.controls].find(row => row.id === id), fixture = fixtures.rows.find(row => row.id === id);
      assert.deepEqual(call, { ordinal: index + 1, layout: layout.name, appParent: layout.appParent, product: layout.product, specifier: layout.specifier, id, scriptSha256: digest(row.script), caseJsonSha256: digest(JSON.stringify(row)), fixtureJsonSha256: digest(JSON.stringify(fixture)), status: 'UNEXECUTED' });
    }
  });
  const sourceAuth = JSON.parse(blob(sealCommit, `${directory}/SOURCE-AUTH.json`));
  check('sealed314-source-auth-receipt-rows-match-git-data', () => {
    const requests = [...sourceRequests];
    const add = (revision, filename) => { const bytes = blob(revision, filename); requests.push({ expression: `${revision}:${filename}`, bytes, oid: objectHash('blob', bytes), kind: 'blob' }); };
    for (const filename of packetFiles) add(packet, `${directory}/${filename}`);
    for (const receipt of bindings.receipts) add(receipt.commit, receipt.path);
    add(bindings.archive.commit, bindings.archive.path);
    add(bindings.authoritativePriority.commit, bindings.authoritativePriority.path);
    const byExpression = new Map(requests.map(row => [row.expression, row]));
    assert.equal(requests.length, 314); assert.equal(sourceAuth.rows.length, 314);
    for (const row of sourceAuth.rows) {
      const request = byExpression.get(row.expression); assert.ok(request);
      assert.equal(row.oid, request.oid); assert.equal(row.kind, request.kind); assert.equal(row.bytes, request.bytes.length); assert.equal(row.sha256, digest(request.bytes)); assert.equal(row.verified, true);
      byExpression.delete(row.expression);
    }
    assert.equal(byExpression.size, 0);
  });
  const finalEvidence = JSON.parse(blob(sealCommit, `${directory}/stub-evidence-v2/RESULTS.json`));
  let driftFacts;
  check('sealed-stub-receipts-labels-and-actual-dependency-refusal-data', () => {
    assert.equal(finalEvidence.role, 'DATA_SYNTHETIC_BENIGN_STUB_ONLY');
    assert.equal(finalEvidence.synthetic.length, 41); assert.equal(finalEvidence.originalMalformedDataControls, 8);
    assert.equal(finalEvidence.children.length, 10); assert.equal(finalEvidence.workerStarts, 11);
    assert.equal(finalEvidence.productImports, 0); assert.equal(finalEvidence.productExecutions, 0);
    const drift = finalEvidence.children.find(row => row.label === 'loader-drift').observation;
    assert.deepEqual(drift.admissionRefusals, []);
    assert.equal(drift.rows.length, 1); assert.equal(drift.rows[0].exited, true); assert.equal(drift.rows[0].exitCode, 1);
    assert.equal(drift.rows[0].terminatePending, 0); assert.deepEqual(drift.rows[0].terminateErrors, []); assert.equal(drift.rows[0].emergency, false);
    assert.ok(drift.rows[0].errors.some(error => error.includes('LOAD_HASH_REFUSED')));
    const childLoads = blob(sealCommit, `${directory}/stub-evidence-v2/loader-drift.worker.jsonl`).toString().trim().split('\n').map(line => JSON.parse(line));
    assert.ok(childLoads.some(row => row.event === 'load' && row.relative === 'stub-entry.mjs'));
    assert.equal(childLoads.some(row => row.event === 'load' && row.relative === 'stub-dependency.mjs'), false);
    driftFacts = { role: 'READ_EXISTING_BENIGN_STUB_DATA_ONLY', admissionRefusals: drift.admissionRefusals, workerErrors: drift.rows[0].errors, exited: true, exitCode: 1, terminatePending: 0, terminateErrors: [], emergency: false, entryLoadReceipt: true, refusedDependencyLoadReceipt: false, notProductExecutionEvidence: true };
  });
  const report = { role: 'INDEPENDENT_STATIC_DATA_ONLY', candidate, packet, dataChecks: checks.length, checks, preserved, declaration: { path: declarationPath, sha256: digest(declaration) }, harness, source: { selectedInputs: raw.source.inputs.length, inputTableSha256: bindings.selected.selectedInputTableSha256, archiveSha256: digest(archive), storedRequests: sourceRequests.length, commitWitnesses: raw.source.commits.length, reachableTrees: raw.source.reachableTrees.length, derivedTrees: raw.source.reconstructedTrees.length, witnessedSourcePaths, composition: manifest.composedTree, packageSha256: digest(packageBytes), packageFiles: members.size, declarations: 214, workerStaticClosure: [...workerClosure].sort().map(filename => ({ path: filename, sha256: digest(members.get(filename)) })) }, counts: { workflows: cases.workflows.length, controls: cases.controls.length, layouts: 3, futureRuntimeSubjects: expectedIds.length * 3, frozenMalformedControlsPreserved: 8, frozenMalformedControlsExecutedHere: 0, priorStubScenariosRead: priorEvidence.children.length, gitDataChildrenForThisValidation: gitChildren, productImports: 0, productExecutions: 0, subjectHarnessImports: 0, workerThreadsStarted: 0, syntheticSubjectRuns: 0 }, allValidationGitChildrenReaped: true, qualification: 'Only builtin data parsing/hashing and synchronous Git DATA reads; no subject code imported, evaluated, typechecked, built, installed or dispatched. Historical stub receipts are inspected data, not this candidate runtime proof. Static relative-import closure is not an actual child-load observation. Archive tree witnesses are partial; all 268 revision:path bindings are separately verified against stored Git blobs in the one batch.' };
  if (process.argv.includes('--summary')) delete report.checks;
  delete report.counts.priorStubScenariosRead;
  report.counts.priorPreparationChildReceipts = priorEvidence.children.length;
  report.counts.priorBenignWorkerScenarios = priorEvidence.children.filter(row => row.observation).length;
  report.finalSeal = { commit: sealCommit, sha256: digest(sealBytes), codeSetSha256: seal.codeIdentity.sha256, pinnedFiles: seal.files.length, codeFilesUnchanged: seal.codeIdentity.rows.length, sourceAuthRowsChecked: sourceAuth.rows.length, finalStubChecksRead: finalEvidence.synthetic.length, finalStubMalformedControlsRead: finalEvidence.originalMalformedDataControls, finalStubWorkerScenariosRead: finalEvidence.children.filter(row => row.observation).length, all93CallsUnexecuted: true, driftFacts };
  console.log(JSON.stringify(report, null, 2));
} else {
  throw new Error('STATIC_DATA_INSPECTION_MODE_REQUIRED');
}
