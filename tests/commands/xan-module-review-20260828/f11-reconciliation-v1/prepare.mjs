import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, lstat, open, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hash } from './conditional.mjs';
import { transformParent, transformAdapter, parentSection } from './overlay.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const repo = path.resolve(root, '../../../..');
const prefix = 'tests/commands/xan-module-review-20260828/';
const candidate = '0ec84fc38c3fafd75776d80148d4f3c2d77e6247';
const base = '5137a74ec855a32d8a8860eb66b62eb44d11e290';
const diagnosis = '04fae50ae2ac224eba32cdb6ed84c43d2ee671ea';
const historical = 'dad2b08ce6bba02d3c404e7a55da5f4163b39d77';
const readGit = (revision, filename) => execFileSync('git', ['show', `${revision}:${filename}`], { cwd: repo, maxBuffer: 4 * 1024 * 1024 });
const write = async (filename, value) => {
  const file = await open(path.join(root, filename), 'wx');
  try { await file.writeFile(typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`); await file.sync(); }
  finally { await file.close(); }
};
const bindings = [];
const bind = (revision, filename) => {
  const bytes = readGit(revision, filename);
  bindings.push({ revision, path: filename, bytes: bytes.length, sha256: hash(bytes) });
  return bytes;
};
assert.equal(hash(bind(diagnosis, `${prefix}diagnosis-v1/RESULT-SEAL.json`)), '1155f77cce223c78f8ca08b6f102e5a2348d7645fbb442da64f4018b4e7a0593');
const diagnosisSeal = JSON.parse(readGit(diagnosis, `${prefix}diagnosis-v1/RESULT-SEAL.json`));
for (const name of ['F11.md', 'CONTINUATION.md', 'CASES.json', 'CORRECTIONS.json', 'corrections.mjs', 'SYNTHETIC-V2-RESULT.json']) {
  assert.equal(hash(bind(diagnosis, `${prefix}diagnosis-v1/${name}`)), diagnosisSeal.entries.find(entry => entry.path === name).sha256);
}
const sourceNames = ['argv', 'budget', 'commands', 'csv', 'index', 'io', 'options', 'selector', 'sort', 'writer'];
for (const name of sourceNames) bind(candidate, `src/commands/xan/${name}.ts`);
for (const name of ['src/contracts/command.ts', 'src/contracts/io.ts', 'src/contracts/output.ts', 'src/contracts/errors.ts', 'src/shell/types.ts', 'src/shell/index.ts', 'src/shell/runtime.ts', 'src/index.ts']) bind(base, name);
const sourceBinding = hash(JSON.stringify(bindings.filter(entry => entry.path.startsWith('src/'))));
const defaults = {
  maxArgs: 128, maxArgumentBytes: 65536, maxInputFiles: 16,
  maxInputBytes: 268435456, maxChunks: 262144, maxChunkBytes: 8388608,
  maxRecordBytes: 8388608, maxCellBytes: 4194304, maxColumns: 16384,
  maxRecords: 1000000, maxSelectorBytes: 16384, maxSelectorNodes: 4096,
  maxSelectorDepth: 2, maxSelectedColumns: 16384, maxLastRows: 4096,
  maxWork: 1000000000, maxOutputBytes: 268435456, maxRetainedBytes: 33554432,
};
const diagnostic = name => `xan count: ${name} limit exceeded\n`;
const publicExpected = ({ next = 1, stderr = '', stdout = '', registered = 3, host = 'normal', file = false, returned = 0 } = {}) => ({
  settlement: host === 'normal' ? 'fulfilled' : 'rejected', result: host === 'normal' ? { exitCode: 1 } : null,
  reason: host === 'normal' ? null : { token: host, exactIdentity: true },
  stdoutHex: Buffer.from(stdout).toString('hex'), stderrHex: Buffer.from(stderr).toString('hex'),
  counts: { acquisitions: host === 'caller' ? 0 : 1, next, returns: returned, stdoutWrites: stdout ? 1 : 0,
    stderrWrites: stderr || ['parentBudget', 'parentControl', 'sink'].includes(host) ? 1 : 0, fsReadStream: file ? 1 : 0 },
  cleanupRegistered: registered, cleanupPromiseIdentity: true,
  cleanupFailures: host === 'cleanup' ? [{ token: 'cleanup', exactIdentity: true }] : [], callerAborted: host === 'caller',
});
const workLedger = { atPrimary: { work: 13, retained: 34, reservedOutput: 2 }, firstRejected: { resource: 'maxWork', requested: 2, remaining: 1 },
  finalWork: 14, peakRetained: 64, finalRetained: 0, reservedOutput: 2, outputReservationsRefunded: false,
  diagnosticAdditionalWorkIfFit: 136, diagnosticPeakRetainedIfFit: 90, totalOutputIfFit: 36 };
const retainedLedger = { atPrimary: { work: 6, retained: 32, reservedOutput: 0 }, firstRejected: { resource: 'maxRetainedBytes', requested: 32, remaining: 31 },
  finalWork: 49, peakRetained: 32, finalRetained: 0, reservedOutput: 43, outputReservationsRefunded: false,
  diagnosticAdditionalWorkIfFit: 172, diagnosticPeakRetainedIfFit: 106, diagnosticPeakEvenScannerReleased: 74, totalOutputIfFit: 43 };
const primary = (name, diag, ledger) => ({ classification: 'STATIC_INFERENCE_FROM_PINNED_SOURCE_AND_EXACT_HOST_PATH_NOT_RUNTIME_ERROR_CAPTURE',
  primary: name, diagnosticPath: diag, ...(ledger ? { ledger } : {}) });
const cases = [
  { id: 'F11-W14', host: 'normal', argv: ['count'], inputHex: '610a', overrides: { maxWork: 14 },
    staticPath: primary('maxWork', 'index.ts:48 textSize admits x then rejects a; no stderr reservation/write', workLedger), expected: publicExpected({ next: 2 }) },
  { id: 'F11-R63', host: 'normal', argv: ['count'], inputHex: '610a', overrides: { maxRetainedBytes: 63 },
    staticPath: primary('maxRetainedBytes', 'index.ts:50 reserves 43 output then rejects hold43 at proposed75', retainedLedger), expected: publicExpected() },
  { id: 'F11-AMPLE-RECORDS', host: 'normal', argv: ['count'], inputHex: '610a620a', overrides: { maxRecords: 1 },
    staticPath: primary('maxRecords', 'full identifying diagnostic required'), expected: publicExpected({ stderr: diagnostic('maxRecords') }) },
  { id: 'F11-AMPLE-INPUT', host: 'normal', argv: ['count'], inputHex: '610a', overrides: { maxInputBytes: 1 },
    staticPath: primary('maxInputBytes', 'full identifying diagnostic required'), expected: publicExpected({ stderr: diagnostic('maxInputBytes') }) },
  { id: 'F11-LOW-OUTPUT', host: 'normal', argv: ['count'], inputHex: '610a620a', overrides: { maxRecords: 1, maxOutputBytes: 1 },
    staticPath: primary('maxRecords', 'diagnostic sizing completes; output admission skipped; no emergency quota'), expected: publicExpected() },
  { id: 'F11-CALLER', host: 'caller', argv: ['count'], inputHex: '610a', overrides: { maxWork: 14 },
    staticPath: primary('caller', 'preaborted parse budget.bound; rejects exact caller reason, not an own-limit result'), expected: publicExpected({ next: 0, registered: 0, host: 'caller' }) },
  ...['parentBudget', 'parentControl', 'sink'].map(host => ({ id: `F11-${host}`, host, argv: ['count'], inputHex: '610a620a', overrides: { maxRecords: 1 },
    staticPath: primary('maxRecords', `full stderr write rejects ${host}; EscapingFailure forwarding, not own-limit suppression`),
    expected: publicExpected({ host }) })),
  { id: 'F11-cleanup', host: 'cleanup', argv: ['count', 'input.csv'], inputHex: '610a620a', overrides: { maxRecords: 1 },
    staticPath: primary('maxRecords', 'full diagnostic, owned FS iterator return rejects; exact cleanup reason wins over own-limit result'),
    expected: publicExpected({ host: 'cleanup', file: true, returned: 1, stderr: diagnostic('maxRecords') }) },
  { id: 'F11-DEFAULT-SUCCESS', host: 'normal', argv: ['count'], inputHex: '610a', overrides: {},
    staticPath: primary(null, 'no failure; zero diagnostic required'), expected: { ...publicExpected({ next: 2, registered: 2, stdout: '0\n' }), result: { exitCode: 0 } } },
];
for (const spec of cases) {
  spec.boundary = 'DIRECT_createXanCommand.execute_NOT_Shell.exec';
  spec.deadlineMs = 5000;
  spec.maxDeliveredBytes = Buffer.from(spec.inputHex, 'hex').length;
  spec.maxDeliveries = 1;
  if (spec.host === 'caller') spec.staticPath.ledger = { finalWork: 0, peakRetained: 0, finalRetained: 0, reservedOutput: 0, outputReservationsRefunded: false };
  if (spec.id === 'F11-DEFAULT-SUCCESS') spec.staticPath.ledger = { finalWork: 15, peakRetained: 64, finalRetained: 0, reservedOutput: 2, outputReservationsRefunded: false };
  if (!spec.staticPath.ledger && spec.host !== 'caller' && spec.id !== 'F11-DEFAULT-SUCCESS') {
    const limit = spec.id === 'F11-AMPLE-INPUT' ? 'maxInputBytes' : 'maxRecords';
    const size = Buffer.byteLength(diagnostic(limit));
    const before = limit === 'maxInputBytes' ? 5 : spec.host === 'cleanup' ? 17 : 8;
    spec.staticPath.ledger = { finalWork: before + (spec.id === 'F11-LOW-OUTPUT' ? size : 4 * size),
      peakRetained: Math.max(limit === 'maxInputBytes' ? 32 : 64, spec.id === 'F11-LOW-OUTPUT' ? 32 : 32 + size + Buffer.byteLength(`${limit} limit exceeded`)),
      finalRetained: 0, reservedOutput: spec.id === 'F11-LOW-OUTPUT' ? 0 : size, outputReservationsRefunded: false };
  }
  const caps = { ...defaults, ...spec.overrides };
  spec.remainingStaticBounds = spec.staticPath.ledger ? {
    work: caps.maxWork - spec.staticPath.ledger.finalWork,
    retainedAfterCleanup: caps.maxRetainedBytes,
    output: caps.maxOutputBytes - spec.staticPath.ledger.reservedOutput,
    nonWorkRetainedOutput: 'all other caps are bound here; only argv/input/scanner counters touched; no selector/tail traversal',
  } : { classification: 'NO_COUNTER_MEASUREMENT_CLAIM', bounds: caps };
}
const candidateBinding = { candidate, base, inventory: '4ec398bc4ae2bbbc15eb0a63b796192619087e9d0e25b8c87524ac7dff9f7df0',
  package: '324268096450f0133265b7003140139fc5118e9e4a39d43ca856ce214918bac7', sourceBinding };
const profile = { version: 'F11-ROOT-ALL-OWN-CAPS-v1-20260828', ...candidateBinding, candidateBinding, defaults,
  oldFreeze: '55810d4aea70fadf151c2fbf746a17f96bfeb599',
  policy: 'NO emergencyquotaexemption/minimumraise. Terminaldiagnostic isbest-effortWITHINremainingALLownXANcaps; insufficientownwork/retained/outputmayyieldstatus1+empty/partialboundedstderr. Mustretainprimaryinternal-limitstatus/cleanup and accountallchargedreservations; cannotmaskcallerabort,parentBudget/control, actualsinkfailureorcleanupfailures. When adequatecapsremain, identifyingdiagnosticstillrequired. maxWork14/maxRetained63cases qualifyasinsufficient-own-resource ONLYafterexactbindings; presealconditionalboundaryexpectedvalues+ample-budget/omission/parent-sink-reasoncountercontrols beforetargetedexecution, no blanketworkaround. Mechanical45+5+2+10causes maybefixedversionwise asverified, preserveactualPromiseidentity/publicreadiness/results. Parentnonzero/allPASS aggregateacceptancehole mustbeclosedviaowncontrol(nonzeroexitcannotgreen)beforepositivequalification. No productpatch/full88replay/independentpackclaim.',
  partialPolicy: 'The policy permits bounded partial diagnostics, but this exact unchanged candidate/path is presealed empty for W14/R63. Unexpected partial output is a contradiction, not an automatic pass.',
  diagnosticWhenFit: { maxWork: diagnostic('maxWork'), maxRetainedBytes: diagnostic('maxRetainedBytes') },
  future: { status: 'HELD_PENDING_ROOT_EXACT_DENIAL_REVIEW', cases: 11, layouts: ['SOURCE', 'INSTALLED_MOVED'], maximumInvocations: 22, attemptsPerCasePerLayout: 1,
    childDeadlineMs: 60000, childOutputBytes: 65536, stderrSpoolBytes: 16384, caseDeadlineMs: 5000,
    caseOutputBytes: 65536, noNative: true, noNetwork: true, noNewDependencies: true, noFull88: true,
    parentBudgetScope: 'DIRECT stderr sink throws public ShellLimitError instance; no actual shared Shell Budget or Shell.exec control mapping claim',
    parentControlScope: 'DIRECT trusted host control reason thrown by actual stderr sink; not a fabricated Shell internal control class',
    cleanupScope: 'owned fs.readStream iterator return rejection; cleanup settled is distinct from cleanup successful',
    oldHistory: { source: '569/79/19', moved: '570/79/18', references: 88, compilerAttempts: 2, initialTS5033: 880, matchingEmission: 442, tools: 313, independentPack: false } },
  cases };
await write('PROFILE.json', profile);
const oldCases = JSON.parse(readGit(diagnosis, `${prefix}diagnosis-v1/CASES.json`)).cases;
await write('OLD-FAILURES.json', oldCases.filter(item => item.id === 'F11-ledger-maxWork--1' || item.id === 'F11-ledger-maxRetainedBytes--1'));
const corrections = JSON.parse(readGit(diagnosis, `${prefix}diagnosis-v1/CORRECTIONS.json`));
const correctionMap = Object.values(corrections).find(value => value && Object.hasOwn(value, `${prefix}actual-review-v2/adapter.mjs`));
assert.ok(correctionMap);
const parentInput = bind(historical, `${prefix}actual-review-v2/runner.mjs`).toString();
const adapterInput = bind(historical, `${prefix}actual-review-v2/adapter.mjs`).toString();
const parent = transformParent(parentInput);
const adapter = transformAdapter(adapterInput, correctionMap[`${prefix}actual-review-v2/adapter.mjs`]);
const section = parentSection(parent.source);
await mkdir(path.join(root, 'overlay')); await mkdir(path.join(root, 'overlay/actual-review-v2'));
await write('overlay/actual-review-v2/runner.mjs', parent.source);
await write('overlay/actual-review-v2/adapter.mjs', adapter.source);
await write('parent-section.mjs', section.module);
for (const filename of ['actual-review-v1/a01.mjs', 'preparation-v2/supervisor.mjs', 'core.mjs', 'actual-review-v2/common.mjs', 'actual-review-v2/worker.mjs', 'actual-review-v2/continuation.mjs']) bind(historical, `${prefix}${filename}`);
await write('BINDINGS.json', { candidate, base, diagnosis, historical, originalRecipe: '549f2055eb964c33cdbf26109645a422b2b5194a', compilerCorrection: 'd5f4e91062c703b7eecaba856c7533068e1fc520', bindings,
  overlays: { parent: { ...parent, source: undefined }, adapter: { ...adapter, source: undefined }, parentSectionSha256: section.sha256 },
  inheritedMechanical: { receipt: `${prefix}diagnosis-v1/SYNTHETIC-V2-RESULT.json`, count: 13, rerun: false, changes: correctionMap },
  scope: 'read-only bytes; no product import, compilation, native oracle or candidate execution' });
const controls = {
  parent: [
    ['zero-pass', 'PASS'], ['nonzero-pass', 'FAIL'], ['nonzero-fail', 'FAIL'], ['zero-fail', 'FAIL'],
    ...['missing-required', 'duplicate', 'stale', 'wrong-job', 'wrong-manifest', 'wrong-phase', 'wrong-count', 'incomplete', 'cleanup-false', 'intact-false', 'final-position', 'timeout', 'replay'].map(mode => [mode, 'HOLD']),
  ].map(([mode, expected]) => ({ mode, expected })),
  predicates: [
    ...cases.map(spec => ({ id: `positive-${spec.id}`, case: spec.id, mutation: null, accept: true })),
    ...['candidate', 'input', 'args', 'caps', 'factory', 'primary', 'diagnosticPath', 'status', 'reason', 'caller', 'cleanup', 'partial', 'overbudget', 'reservation', 'uncharged', 'missingStdout', 'missingStderr', 'invocations', 'admission', 'intact', 'closed'].map(mutation => ({ id: `reject-${mutation}`, case: 'F11-W14', mutation, accept: false })),
    ...['F11-AMPLE-RECORDS', 'F11-AMPLE-INPUT'].map(id => ({ id: `reject-omission-${id}`, case: id, mutation: 'omitDiagnostic', accept: false })),
    ...['parentBudget', 'parentControl', 'sink', 'cleanup', 'CALLER'].map(host => ({ id: `reject-reason-${host}`, case: `F11-${host}`, mutation: 'wrongReasonIdentity', accept: false })),
    ...['parentBudget', 'parentControl', 'sink', 'cleanup', 'CALLER'].map(host => ({ id: `reject-mask-${host}`, case: `F11-${host}`, mutation: 'maskReason', accept: false })),
  ],
  other: ['failed-required-phase', 'missing-required-phase', 'ordinary-failure-continues', 'unsafe-receipt-stops', 'append-aware-source', 'append-aware-package', 'actual-promise-identity', 'middleware-readiness-results', 'overlay-mechanical-byte-proof',
    'full-when-fit-maxWork', 'omission-when-fit-maxWork', 'full-when-fit-maxRetainedBytes', 'omission-when-fit-maxRetainedBytes'],
  maxChildren: 17, deadlines: { ordinaryMs: 2000, intentionalTimeoutMs: 100 }, rawBytes: 65536,
  singleAttempt: true, productInvocations: 0, sourceExecution: 0,
};
await write('CONTROLS.json', controls);
const inputs = [];
async function inventory(directory, prefix = '') {
  for (const name of (await readdir(directory)).sort()) {
    const relative = prefix + name; const stat = await lstat(path.join(directory, name));
    assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) await inventory(path.join(directory, name), `${relative}/`);
    else { const bytes = await readFile(path.join(directory, name)); inputs.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) }); }
  }
}
await inventory(root);
const external = [];
for (const filename of ['actual-review-v1/a01.mjs', 'preparation-v2/supervisor.mjs', 'core.mjs', 'actual-review-v2/common.mjs']) {
  const bytes = await readFile(path.join(root, '..', filename));
  const pinned = bindings.find(entry => entry.path === prefix + filename);
  assert.equal(hash(bytes), pinned.sha256);
  external.push({ path: filename, bytes: bytes.length, sha256: hash(bytes) });
}
const node = await readFile(process.execPath);
await write('PRE-SEAL.json', { classification: 'PRESEALED_SYNTHETIC_ONLY_NOT_EXECUTION_AUTHORIZATION', created: new Date().toISOString(),
  inputs, external, node: { path: process.execPath, bytes: node.length, sha256: hash(node), version: process.version },
  outputsOnly: ['evidence/', 'RESULT-SEAL.json', 'HANDOFF.md'], appendAware: true,
  qualification: 'node tests/commands/xan-module-review-20260828/f11-reconciliation-v1/qualify.mjs <preseal-commit>',
  retries: 0, sourceExecution: 0, candidateInvocations: 0, futureStatus: profile.future.status });
console.log(JSON.stringify({ prepared: true, caseCount: cases.length, parentControls: controls.parent.length, predicateControls: controls.predicates.length, sealSha256: hash(await readFile(path.join(root, 'PRE-SEAL.json'))) }));
