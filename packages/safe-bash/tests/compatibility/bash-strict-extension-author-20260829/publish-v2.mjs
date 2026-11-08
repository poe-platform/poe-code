import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const firstRoot = '/tmp/strict-extension-v2-author-aHDK4G';
const tailRoot = '/tmp/strict-extension-v2-tail-AYN6CH';
const prep = '/tmp/strict-extension-v2-prep-VIBsVO';
const capture = fs.mkdtempSync('/tmp/strict-extension-v2-publication-');
const descriptor = fs.openSync(path.join(capture, 'events.jsonl'), 'wx');
const note = value => fs.writeSync(descriptor, JSON.stringify(value) + '\n');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const destination = path.join(own, 'results-v2');
const roots = [
  [firstRoot, 'initial'], [tailRoot, 'tail'],
  ['/tmp/strict-extension-v2-launch-tg4IRZ', 'outer-initial'],
  ['/tmp/strict-extension-v2-tail-launch-ybzVia', 'outer-tail'],
  [prep, 'prep'], ['/tmp/strict-extension-v2-seal-jfrYit', 'seal'],
  ['/tmp/strict-extension-v2-seal-s0yEjf', 'data-failure-one'],
  ['/tmp/strict-extension-v2-seal-ytANII', 'data-failure-two'],
  ['/tmp/strict-extension-v2-tail-seal-1T4cip', 'tail-seal'],
];
const records = [];
let written = 0;
function read(file) { const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16 * 1024 * 1024); return fs.readFileSync(file); }
function write(relative, bytes) {
  assert.ok(!relative.split('/').includes('AGENTS.md'));
  written += bytes.length; assert.ok(written <= 32 * 1024 * 1024);
  const file = path.join(destination, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes, { flag: 'wx' });
  assert.equal(sha(read(file)), sha(bytes));
}
function json(relative, value) { write(relative, Buffer.from(JSON.stringify(value, null, 2) + '\n')); }
function lines(file) { return read(file).toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
try {
  const started = new Date().toISOString();
  note({ role: 'V2_DATA_PUBLICATION', started, pid: process.pid, ppid: process.ppid, productExecutions: 0 });
  fs.appendFileSync(path.join(prep, 'admin.jsonl'), JSON.stringify({ action: 'publish-v2', phase: 'ACTUAL_V2', pid: process.pid, ppid: process.ppid, started, capture, spawned: 0 }) + '\n');
  assert.deepEqual(process.argv.slice(2), ['--publish']);
  assert.ok(!fs.existsSync(destination)); fs.mkdirSync(destination);
  const first = JSON.parse(read(path.join(firstRoot, 'RESULT.json'))), tail = JSON.parse(read(path.join(tailRoot, 'RESULT.json')));
  const outerFirst = JSON.parse(read('/tmp/strict-extension-v2-launch-tg4IRZ/TERMINAL.json'));
  const outerTail = JSON.parse(read('/tmp/strict-extension-v2-tail-launch-ybzVia/TERMINAL.json'));
  assert.equal(first.status, 'FAILED_OR_INCOMPLETE'); assert.match(first.error, /35 !== 33/);
  assert.equal(tail.status, 'AUTHOR_SCOPED_PASS'); assert.deepEqual(tail.failures, []);
  assert.equal(outerFirst.code, 1); assert.equal(outerTail.code, 0);
  const source = JSON.parse(read(path.join(own, 'SOURCE.json'))), preseal = JSON.parse(read(path.join(own, 'PRESEAL-v2.json')));
  assert.equal(sha(read(path.join(own, 'SOURCE.json'))), '9924773241f116d4cd5008fa7cd7f7fc3d95521f5e57b33299dbf2ed7cc2bf69');
  assert.equal(first.package.sha256, 'aaabea71bc3a7f1982a2ded488cbf5a905de304f0bc6f39302d15e293da8495f');
  assert.equal(sha(read(path.join(firstRoot, first.package.file))), first.package.sha256);
  assert.equal(first.package.members.length, 954);
  const sourceChecks = [];
  for (const root of [firstRoot, tailRoot]) for (const row of source.inputs) {
    assert.equal(sha(read(path.join(root, 'source', row.path))), row.sha256);
    sourceChecks.push({ root, path: row.path, sha256: row.sha256 });
  }
  const productRoots = [path.join(firstRoot, 'source'), path.join(firstRoot, 'moved package/node_modules/virtual-bash'), path.join(tailRoot, 'source'), path.join(tailRoot, 'physical moved package/node_modules/virtual-bash'), path.join(tailRoot, 'operator-mutants/node_modules/virtual-bash')];
  for (const root of productRoots) for (const row of first.package.members) assert.equal(sha(read(path.join(root, row.path))), row.sha256);
  const main = [], protocol = [];
  for (const layout of ['source', 'installed', 'moved']) {
    for (const [suffix, expected] of [['redirections-v3', 48], ['strict', 50], ['conditional', 67], ['extension', 35]]) {
      const rows = lines(path.join(firstRoot, layout + '-' + suffix + '.stdout'));
      const summary = rows.at(-1).summary; assert.equal(summary.cases, expected); assert.equal(summary.pass, expected); assert.equal(summary.fail, 0);
      main.push({ layout, cohort: suffix, cases: expected, pass: expected, role: layout === 'moved' && suffix === 'extension' ? 'ACTUAL_RAW35_WITH_VERSIONED_DISPATCH_ADJUDICATION' : 'ACTUAL_INITIAL_V2' });
      if (suffix === 'extension') for (const row of rows.filter(row => row.id?.startsWith('X10'))) protocol.push({ layout, ...row });
    }
    const array = (layout === 'moved' ? tail : first).cohorts.find(row => row.label === (layout === 'moved' ? 'moved-arrays-tail' : layout + '-arrays'));
    assert.equal(array.pass, 12); main.push({ layout, cohort: 'arrays', cases: 12, pass: 12, role: layout === 'moved' ? 'ACTUAL_TAIL' : 'ACTUAL_INITIAL_V2' });
  }
  assert.equal(main.reduce((total, row) => total + row.pass, 0), 636); assert.equal(protocol.length, 9);
  const types = [...first.types, ...tail.types]; assert.equal(types.length, 6); assert.ok(types.every(row => row.pass)); assert.equal(types.reduce((total, row) => total + row.errors.length, 0), 24);
  const mutants = tail.controls.filter(row => row.detected !== undefined); assert.equal(mutants.length, 6); assert.ok(mutants.every(row => row.detected));
  const loadedMutants = mutants.map(row => {
    const loaded = lines(path.join(tailRoot, row.name + '-loads.jsonl'));
    const restored = lines(path.join(tailRoot, row.name + '-restored-loads.jsonl'));
    const matched = loaded.filter(entry => entry.sha256 === row.mutantSha256);
    assert.equal(matched.length, 1); assert.ok(restored.some(entry => entry.sha256 === row.originalSha256));
    return { name: row.name, mutatedLoaded: matched[0], originalSha256: row.originalSha256, restoredLoaded: true };
  });
  assert.equal(tail.cohorts.filter(row => row.label.endsWith('-restored') && row.pass === 1).length, 6);
  assert.equal(tail.controls.filter(row => row.name.startsWith('binding-') && row.pass).length, 2);
  const children = [...first.children, ...tail.children]; assert.equal(children.length, 39);
  assert.ok(children.every(row => row.closed && !row.alarm && !row.spawnError && !row.resourceClosureUnknown && row.signal === null));
  for (const row of children) for (const name of ['exit', 'stdout-end', 'stderr-end', 'close']) assert.ok(row.events.some(event => event.event === name), row.label + ':' + name);
  assert.equal(tail.cleanup.implicitLoaderReservations, 29); assert.equal(tail.cleanup.observedProductWorkers, 0);
  const adminRecords = lines(path.join(prep, 'admin.jsonl'));
  const known = new Map();
  function remember(row, origin, phase) { if (Number.isInteger(row.pid) && row.pid > 0) { const prior = known.get(row.pid); if (!prior) known.set(row.pid, { pid: row.pid, origin, phase, action: row.action ?? row.command ?? row.role ?? 'metadata', observations: [] }); known.get(row.pid).observations.push({ origin, phase, started: row.started, status: row.status, signal: row.signal }); } }
  let phase = 'PREP';
  for (const row of adminRecords) { if (row.started) phase = Date.parse(row.started) >= Date.parse(preseal.masterGrantStarted) ? 'ACTUAL' : 'PREP'; remember(row, 'prep/admin.jsonl', phase); }
  for (const [root, prefix] of roots.filter(row => /seal|failure/.test(row[1]))) if (fs.existsSync(path.join(root, 'events.jsonl'))) {
    let currentPhase = 'PREP';
    for (const row of lines(path.join(root, 'events.jsonl'))) { if (row.started) currentPhase = Date.parse(row.started) >= Date.parse(preseal.masterGrantStarted) ? 'ACTUAL' : 'PREP'; remember(row, prefix, currentPhase); }
  }
  for (const row of children) remember({ ...row, action: row.label }, 'runner', 'ACTUAL');
  for (const [label, outer] of [['initial', outerFirst], ['tail', outerTail]]) { remember({ pid: outer.observerPid, action: label + '-outer' }, 'outer', 'ACTUAL'); remember({ pid: outer.pid, action: label + '-runner' }, 'outer', 'ACTUAL'); }
  const unnumbered = [
    { phase: 'PREP', role: 'two context-only instruction dispatches and their cat/sed commands', maximumDistinctKnownStarts: 4 },
    { phase: 'PREP', role: 'direct apply_patch PLAN/seal dispatch shell and patch command', maximumDistinctKnownStarts: 2 },
    { phase: 'PREP', role: 'apply_patch before first exec seal; Node PID separately known', maximumDistinctKnownStarts: 1 },
    { phase: 'ACTUAL', role: 'apply_patch before exec tail seal; Node PID separately known', maximumDistinctKnownStarts: 1 },
    { phase: 'ACTUAL', role: 'publication-script apply_patch dispatch shell and command', maximumDistinctKnownStarts: 2 },
  ];
  const census = { pidBound: [...known.values()], unnumberedExplicitCommandStarts: unnumbered, prepPidBound: [...known.values()].filter(row => row.phase === 'PREP').length, actualPidBound: [...known.values()].filter(row => row.phase === 'ACTUAL').length, qualification: 'PID-bound observations plus conservative upper count for explicit admin commands without PID receipts. Not a full transitive descendant census, not PGID absence. Parent PIDs not counted as owned. Loader/Worker reservations not OS births.' };
  assert.ok(census.prepPidBound + 7 <= 40); assert.ok(census.actualPidBound + 3 <= 112);
  for (const [root, prefix] of roots) for (const name of fs.readdirSync(root).sort()) {
    const file = path.join(root, name), stat = fs.lstatSync(file); if (!stat.isFile()) continue;
    const bytes = read(file), relative = prefix + '/' + name; write(relative, bytes); records.push({ origin: file, path: relative, bytes: bytes.length, sha256: sha(bytes) });
  }
  json('PACKAGE-MEMBERS.json', first.package.members); json('SOURCE-POSTGUARDS.json', sourceChecks); json('KNOWN-PROCESS-CENSUS.json', census); json('X10-OBSERVATIONS.json', protocol); json('LOADED-MUTANTS.json', loadedMutants);
  const summary = {
    role: 'AUTHOR_V2_COMPOSED_FINITE_CHECKPOINT_INDEPENDENT_REVIEW_REQUIRED',
    sourceCommit: '9bb91c370a0672687399c0a9da4ce1b161f79615', computedTree: source.computedTree,
    fixturePreseal: '970a81e6968dd81773490ca28ec9ddbb65b510b7', tailPreseal: '2a57b730f602e041cf06f5c4a25fa39869751cdf',
    sourceManifestSha256: sha(read(path.join(own, 'SOURCE.json'))),
    package: { members: 954, bytes: first.package.bytes, sha256: first.package.sha256 },
    main, totalMain: 636, types: { groups: 6, expectedNegativeDiagnostics: 24, allPassed: true },
    mutants: { killed: 6, restored: 6, loadedMutantHashesVerified: 6 }, bindingRefusals: 2,
    originalV1: 'c5a8068d:32completed/X10deadline/unknownX10cleanup unchanged',
    initialV2: { status: first.status, exit: outerFirst.code, error: first.error, completedProductRows: 624, staleMovedDispatchExpected: 33, actualMovedExtension: 35 },
    tailV2: { status: tail.status, exit: outerTail.code, mainRows: 12, replayOfCompletedRows: false },
    openDesignIds: ['U27', 'S-U27-INPUT-UNIT-v1', 'S-U28-PRESENCE-v1', 'S-U31-STDIN-v1', 'E23-source-discard'], nativeRuns: 0, privateRuns: 0,
    cleanup: { directChildren: 39, outerObservers: 2, runners: 2, loaderAdmissions: 29, observedRegexWorkers: 0, directCloseAndExitAndPipedEndObserved: true, signals: [], x10CleanupBeforeSettlement: '3/3 versioned protocols; original X10 remains UNKNOWN', globalPGIDAbsent: 'UNPROVED', extensionCompletedShellDisposals: 150 },
    measurements: { actualClockStart: preseal.masterGrantStarted, initialElapsedMs: first.elapsedMs, tailElapsedMs: tail.elapsedMs, runnerCaptureBytesCumulative: tail.captureBytes, outerCaptureBytes: outerFirst.bytes + outerTail.bytes, retainedFreshWorkingBytes: first.actualScratchBytes + tail.actualScratchBytes, cumulativeRunnerWrites: tail.scratchWriteBytes, publicationAt: new Date().toISOString() },
    sourcePostguards: { sources: 2, inputsEach: 293, packageRoots: productRoots.length, membersEach: 954 },
    retainedRoots: roots.map(row => row[0]), noProductSourceEdits: true,
  };
  json('SUMMARY.json', summary); json('RAW-MANIFEST.json', records);
  note({ finished: new Date().toISOString(), files: records.length + 7, publicationBytes: written, main: 636, knownPrepPids: census.prepPidBound, knownActualPids: census.actualPidBound, productExecutions: 0 });
  console.log(JSON.stringify({ destination, publicationBytes: written, files: records.length + 7, main: 636, types: 6, mutants: 6, restored: 6, refusals: 2, census: { prepPidBound: census.prepPidBound, actualPidBound: census.actualPidBound, unnumberedPrepMaximum: 7, unnumberedActualMaximum: 3 }, capture }));
} catch (error) { note({ failure: String(error), stack: error?.stack }); throw error; }
finally { fs.closeSync(descriptor); }
