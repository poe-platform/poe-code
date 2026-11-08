import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { IDS, select, createPilotClock } from './selector.mjs';
const owned = 'tests/compatibility/bash-ere-core-public-pilot-preparation-20260829';
const packet = 'tests/compatibility/bash-ere-core-transport-rebind-20260829/author-v3';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (name, cap = 4 * 1024 * 1024) => { const stat = fs.lstatSync(name); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap); const bytes = fs.readFileSync(name); assert.equal(bytes.length, stat.size); return bytes; };
const bind = row => { const bytes = read(row.path); assert.equal(bytes.length, row.size); assert.equal(hash(bytes), row.sha256); assert.equal(fs.lstatSync(row.path).mode & 0o777, row.mode); return bytes; };
const sealBytes = read(`${packet}/output/CORE-GUARD-PRESEAL.json`);
assert.equal(hash(sealBytes), 'e832b9cf2342c99d09a785f801ae4c73f5905a3d349c9efbc2818e6955c1f66e');
const seal = JSON.parse(sealBytes);
const definitions = JSON.parse(bind(seal.definitions));
const selected = select(definitions.rows);
const original = JSON.parse(bind(definitions.original));
const originalRows = Array.isArray(original) ? original : original.rows;
for (const row of selected) { const prior = originalRows.find(item => item.id === row.id); assert(prior); assert.equal(row.script, prior.script); }
const shipping = JSON.parse(read(`${packet}/output/SHIPPING.json`));
const layouts = [], cells = [];
for (const layout of seal.layouts) {
  const manifest = JSON.parse(bind(layout.manifest));
  const actual = [], actualDirectories = [];
  const walk = directory => { for (const name of fs.readdirSync(directory)) { const filename = path.join(directory, name); const stat = fs.lstatSync(filename); assert(!stat.isSymbolicLink()); if (stat.isDirectory()) { actualDirectories.push(path.relative(layout.app, filename)); walk(filename); } else { assert(stat.isFile()); actual.push(path.relative(layout.app, filename)); } } };
  walk(layout.app);
  assert.deepEqual(actual.sort(), manifest.rows.map(row => row.path).sort());
  assert.deepEqual(actualDirectories.sort(), [...manifest.directories].sort());
  for (const row of manifest.rows) bind({ ...row, path: path.join(layout.app, row.path) });
  for (const row of shipping.rows) bind({ ...row, path: path.join(layout.packageRoot, row.path) });
  const ownerFile = path.join(layout.packageRoot, 'dist/commands/regex-execution/ere/transport/owner.js');
  assert(read(ownerFile).toString('utf8').includes('new Worker(new URL("./worker-entry.js", import.meta.url), {'));
  const productPrefix = path.relative(layout.app, layout.packageRoot) + '/';
  layouts.push({ name: layout.name, app: layout.app, packageRoot: layout.packageRoot, manifest: layout.manifest, completeFileCount: manifest.rows.length, productFileCount: manifest.rows.filter(row => row.path.startsWith(productPrefix)).length, bytes: manifest.bytes, expectedWorkerUrl: path.join(layout.packageRoot, 'dist/commands/regex-execution/ere/transport/worker-entry.js'), originQualification: 'existing DATA materialization; NOT npm-install evidence' });
  for (const definition of selected) {
    const inherited = layout.cells.find(row => row.originalId === definition.id);
    assert(inherited && inherited.workerStartsMaximum === definition.workerStartsMaximum);
    const cellPath = path.join(layout.app, 'cells', `${definition.id}.json`);
    const existing = JSON.parse(read(cellPath));
    assert.deepEqual(existing.definition, definition);
    cells.push({ id: `${layout.name}/${definition.id}`, definition, shellExecCalls: 1, regexVisits: (definition.script.match(/=~/g) ?? []).length, workerStartsMaximum: definition.workerStartsMaximum, inheritedCell: { path: cellPath, size: read(cellPath).length, sha256: hash(read(cellPath)) }, inheritedLimits: existing.limits, state: 'UNRUN', executable: false });
  }
}
const controls = [];
assert.deepEqual(selected.map(row => row.id), IDS);
assert.equal(cells.length, 24);
assert.equal(cells.reduce((sum, row) => sum + row.shellExecCalls, 0), 24);
assert.equal(cells.reduce((sum, row) => sum + row.regexVisits, 0), 30);
assert.equal(cells.reduce((sum, row) => sum + row.workerStartsMaximum, 0), 24);
assert.throws(() => select(definitions.rows.filter(row => row.id !== 'R22')));
controls.push({ id: 'P01-fixed-selection-and-unchanged-cell-bindings', status: 'PASS' });
let current = 1007000;
const clock = createPilotClock({ started: 0, now: () => current });
assert.equal(clock.admit(10000, 3000).admitted, true);
current++;
assert.equal(clock.admit(10000, 3000).admitted, false);
const unknown = createPilotClock({ started: 0, now: () => 0 }); unknown.stopUnknown();
assert.equal(unknown.admit(1, 1).admitted, false);
controls.push({ id: 'P02-remaining-budget-and-unknown-stop', status: 'PASS' });
const roles = [
  ['outer-owner', 1], ['capture-shell', 1], ['coordinator', 1], ['admission', 1],
  ['npm-install-installed', 1], ['npm-install-move-origin', 1], ['quiescent-install-census', 1], ['precell-seal-check', 1],
  ['ordinary-cell', cells.length], ['capture-finalizer', 1], ['git-preindex', 1], ['git-add', 1],
  ['git-check', 1], ['git-commit', 1], ['git-show', 1], ['git-postindex', 1], ['publication-census', 1],
].map(([role, maximum]) => ({ role, maximum }));
const components = {
  retainedDataLayouts: layouts.reduce((sum, row) => sum + row.bytes, 0),
  freshPilotLayouts: layouts.reduce((sum, row) => sum + row.bytes, 0),
  compressedPackage: 909885,
  cellEventsAndPipes: cells.length * 3 * 65536,
  outerAndAdministrativeCaptures: 4 * 1024 * 1024,
  emergencyJournalReserve: 1024 * 1024,
  publicationCaptureCopy: cells.length * 3 * 65536 + 5 * 1024 * 1024,
  metadataAndNpmExtraFiles: 8 * 1024 * 1024,
  twoNativeInstallMutableReservations: 2 * 32 * 1024 * 1024,
  publicationTailReserve: 8 * 1024 * 1024,
};
const logicalBytes = Object.values(components).reduce((sum, value) => sum + value, 0);
assert(logicalBytes <= 256 * 1024 * 1024);
const captureBytes = components.cellEventsAndPipes + components.outerAndAdministrativeCaptures + components.emergencyJournalReserve + components.publicationTailReserve;
const futureRoot = path.resolve(owned, 'FUTURE-PILOT-01');
assert(!fs.existsSync(futureRoot));
const producerGuardBound = Object.values(seal.logicalBound.components).reduce((sum, value) => sum + value, 0);
assert.equal(producerGuardBound, 332963204);
const profile = {
  schema: 'ORDINARY_PUBLIC_PILOT_AUTHOR_PREPARATION_V1', status: 'PREPARED_NOT_EXECUTION_READY', authorized: false,
  prepared: new Date().toISOString(), requiresDifferentReviewer: true,
  sourcePureReview: 'f17d8dec11190ef40ecac6c175b208a2e29c7fbf', sourceCommit: '4abbdeec8e34de88ed2cf7bd32be9c06b413c631',
  producerFinal: 'b015f0ea4f53b3c28dfb78c77eec3bf6138ad35f', producerGuardSha256: hash(sealBytes), archive: seal.archive, node: seal.node,
  definitions: seal.definitions, selectionIds: IDS, layouts, cells, controls,
  observer: { instrumentedNotStock: true, inheritedObserverAllowed: false, futureOnly: 'retain actual Worker, forward exact original URL/options; observe exit/streams only; no postMessage/on replacement, private protocol inspection, extra terminate, restoration or recovery' },
  proposal: { knownOS: roles.reduce((sum, row) => sum + row.maximum, 0), roles, peak: 4, workers: 24, oneLive: true, shellExecCalls: 24, regexVisits: 30, milliseconds: 1200000, publicationMilliseconds: 180000, captureMaximum: 67108864, workingMaximum: 268435456, publicationReserveIncluded: true },
  timeReservation: { cells: 24 * 13000, twoInstallsAndCleanup: 130000, setupAdmissionCensus: 120000, publication: 180000, total: 742000, remainder: 458000, conditionalNotCompletionGuarantee: true },
  logicalBound: { components, logicalBytes, captureBytes, conditional: true, nativeReservationNotOSQuota: true },
  futurePaths: { root: futureRoot, currentlyAbsent: true, caches: ['installed-cache', 'moved-cache'].map(name => path.join(futureRoot, name)), nativeMutableReservationPerInstall: 33554432 },
  blockers: ['new lifecycle-only observer and public-only cell entrypoint must be authored and sealed; inherited observer mutates methods and performs recovery', 'new 24-cell coordinator and native install/admission/census/publication owner must be sealed; inherited dispatcher fixes 210 cells and old clock', 'conditional native mutable-cache reservation needs ROOT acceptance and quiescent census; no live cache walk or ENOENT suppression', 'different pilot PREEXEC reviewer plus producer verdict binding and fresh time-bound ROOT grant required'],
  producerAuditReconciliation: { oldWorkerSuffixAssertion: 'reviewer mistakenly required worker.js; sealed literal is worker-entry.js', oldLayoutPrefixAssertion: 'reviewer mistakenly assumed package/ for every layout; explicit packageRoot authenticated here', staticEdgesPreviouslyCountedBeforeWrongSuffixAssertion: 29, literalWorkerUrlCountPreviouslyCounted: 1, combinedClassification: 30, allThreeLayoutCensusesNowComplete: true, producerConditionalBound: producerGuardBound },
  authority: { full135: 'OPEN', sixNonpublic: 'OPEN', sevenCORE: 'OPEN', privateQualificationTransferred: false, publicNpmInstallProof: false, runtimeCellsRun: 0 },
};
fs.writeFileSync(`${owned}/PILOT-PRESEAL.json`, JSON.stringify(profile, null, 2) + '\n', { flag: 'wx' });
const receipt = { schema: 1, time: new Date().toISOString(), profileSha256: hash(read(`${owned}/PILOT-PRESEAL.json`)), files: ['selector.mjs', 'prepare.mjs'].map(name => ({ path: name, bytes: read(`${owned}/${name}`).length, sha256: hash(read(`${owned}/${name}`)) })), controls, layouts: layouts.map(({ name, productFileCount, completeFileCount, bytes }) => ({ name, productFileCount, completeFileCount, bytes })), roles: profile.proposal.knownOS, logicalBytes, captureBytes, historicalAuditFailuresPreserved: true, runtimeCalls: 0 };
fs.writeFileSync(`${owned}/PREPARATION-RECEIPT.json`, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipt, null, 2));
