import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, '../../../..');
const author = path.resolve(own, '../../breadth-continuation-20260828/executor-v3');
const ownRelative = path.relative(repository, own);
const output = path.join(own, 'evidence-v1');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = filename => JSON.parse(fs.readFileSync(filename));
const freezeBytes = fs.readFileSync(path.join(own, 'FREEZE.json'));
const freeze = JSON.parse(freezeBytes);
const presealCommit = process.argv[2];
assert.match(presealCommit ?? '', /^[a-f0-9]{40}$/);
assert.equal(hash(execFileSync('git', ['show', `${presealCommit}:${ownRelative}/FREEZE.json`], { cwd: repository, maxBuffer: 4 * 1024 * 1024 })), hash(freezeBytes));
const snapshot = () => freeze.files.map(entry => {
  assert(!entry.path.split('/').some(name => name.toUpperCase() === 'AGENTS.MD'));
  const filename = path.join(repository, entry.path);
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink());
  return { path: entry.path, bytes: stat.size, mode: stat.mode & 0o7777, sha256: hash(fs.readFileSync(filename)) };
});
const initial = snapshot();
for (const [index, entry] of freeze.files.entries()) {
  assert.equal(initial[index].sha256, entry.sha256);
  assert.equal(entry.sha256, entry.gitSha256);
  assert.equal(initial[index].mode, entry.mode);
  if (!entry.commit) assert.equal(hash(execFileSync('git', ['show', `${presealCommit}:${entry.path}`], { cwd: repository, maxBuffer: 1024 * 1024 })), entry.sha256);
}
const projection = json(path.join(author, 'PROJECTION.json'));
const node = projection.tools.find(tool => tool.role === 'node');
assert.equal(fs.realpathSync(process.execPath), fs.realpathSync(node.path));
assert.equal(hash(fs.readFileSync(node.path)), node.sha256);
const { settle, serial, settled, relativeName } = await import('../../breadth-continuation-20260828/executor-v3/safety.mjs');
const { assessWorkflow, validateTelemetry, qualify } = await import('../../breadth-continuation-20260828/executor-v3/predicates.mjs');
const { inspectTree, viewProjection, authenticateView, parseStage } = await import('../../breadth-continuation-20260828/executor-v3/projection.mjs');
const { parseTransport, transport } = await import('../../breadth-continuation-20260828/executor-v3/transport.mjs');
const { supervise } = await import('../../breadth-continuation-20260828/executor-v3/supervisor.mjs');
const { instrumentFilesystem, assessWhich } = await import('../../breadth-continuation-20260828/executor-v3/w07.mjs');
fs.mkdirSync(output);
const checks = [];
const children = [];
const active = new Set();
let evidenceBytes = 0;
const save = (name, value) => {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  evidenceBytes += bytes.length;
  assert(evidenceBytes <= 4 * 1024 * 1024);
  fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' });
};
const check = async (id, operation) => {
  try { const observation = await operation(); checks.push({ id, expected: 'assertions hold', pass: true, observation: observation ?? null }); }
  catch (error) { checks.push({ id, expected: 'assertions hold', pass: false, error: { name: error.name, code: error.code, message: error.message, actual: error.actual, expected: error.expected, stack: error.stack } }); }
};
function membership(base, relative = '') {
  return fs.readdirSync(path.join(base, relative)).sort().flatMap(name => {
    const member = path.join(relative, name), stat = fs.lstatSync(path.join(base, member));
    const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file';
    return [{ path: member, type }, ...(type === 'directory' ? membership(base, member) : [])];
  });
}
const workflows = json(path.join(author, '../WORKFLOWS.json')).rows;
const specimen = id => workflows.find(row => row.id === id);
function reportFor(row) {
  const entries = [{ path: '/fixture', type: 'directory', mode: 0o777 }, ...row.directories.map(name => ({ path: `/fixture/${name}`, type: 'directory', mode: 0o777 })), ...Object.entries(row.files).map(([name, file]) => ({ path: `/fixture/${name}`, type: 'file', ...file }))];
  return { captureErrors: [], before: { complete: true, entries }, after: { complete: true, entries: [...structuredClone(entries), ...Object.entries(row.expected.addedFiles).map(([name, file]) => ({ path: `/fixture/${name}`, type: 'file', ...file }))].filter(entry => !row.expected.absent.includes(entry.path.slice(9))) }, result: structuredClone(row.expected), additionalObservations: Object.fromEntries((row.additionalObservations ?? []).map(name => [name, true])), cleanup: { completion: 'returned' }, safety: { safe: true }, loads: { count: 2, evaluated: true, denied: [] }, resources: { pending: 0, violations: [] }, late: [], postGuard: true };
}
const childReceipt = () => ({ reaped: true, exit: { code: 0, signal: null }, close: { code: 0, signal: null }, signals: [], failures: [] });
function telemetry(engine) {
  const receipt = { acquire: 1, next: 5, returns: 0, settled: 1, active: 0, yieldedBytes: 7, yieldedLengths: [1, 2, 1, 3] };
  const unavailable = { status: 'UNQUALIFIED', reason: 'Explicitly unsupported by this observation profile.' };
  return engine === 'just-bash' ? { inputAdmission: { status: 'OBSERVABLE_BYTE_ADMISSION', inputBase64: 'AP9BCg2AAA==' }, chunks: unavailable, dispatch: unavailable, timers: unavailable, iteratorCleanup: unavailable } : { inputAdmission: { status: 'OBSERVABLE_CHUNK_ADMISSION', inputBase64: 'AP9BCg2AAA==' }, chunks: { status: 'QUALIFIED', receipt }, dispatch: { status: 'QUALIFIED', catCount: 1, events: [{ command: 'cat' }] }, timers: unavailable, iteratorCleanup: { status: 'QUALIFIED', receipt } };
}
save('INITIAL.json', { presealCommit, freezeSha256: hash(freezeBytes), files: initial, membership: membership(author), activeChildren: 0 });
await check('D01-exact-committed-recipe', () => assert.equal(freeze.recipeSha256, '20e82f8030075adbd2772c54c534c3db5e6eec0fa641a72b0f2fa9d4cf372df8'));
await check('D02-initial-inputs-match-frozen-git', () => { assert(initial.length > 80); return { files: initial.length, recipeMembers: json(path.join(author, 'SEAL.json')).files.length }; });
await check('D03-recursive-packet-membership', () => assert.deepEqual(membership(author), freeze.authorMembership));
await check('D04-author-composed-evidence-not-rerun', () => {
  const audit = json(path.join(author, 'runs/handoff/FINAL-AUDIT.json'));
  assert.equal(audit.finalValidation.passed, 51); assert.equal(audit.finalValidation.failed, 0); assert.equal(audit.childrenCount, 19);
  const runs = ['synthetic-01', 'repair-01', 'load-01'].map(name => json(path.join(author, 'runs', name, 'RESULT.json')));
  assert.equal(runs[0].defectControls.length, 20); assert(runs[0].defectControls.every(row => row.pass));
  assert.deepEqual(runs.map(run => run.children.length), [8, 5, 6]);
  assert.equal(runs[0].controls.rows.find(row => row.id === 'C03').pass, false);
  assert.equal(runs[0].controls.rows.find(row => row.id === 'C05').pass, false);
  assert.equal(runs[1].controls.rows.find(row => row.id === 'C03').pass, false);
  const applicable = new Map();
  for (const run of runs) for (const row of run.controls.rows) if (row.id !== 'C11') applicable.set(row.id, row.pass);
  assert.equal(applicable.size, 11); assert([...applicable.values()].every(Boolean));
  return { authorDataSyntax: '51/51', authorDefects: '20/20', composedApplicable: '11/11', actualC11: 'UNRUN', authorChildren: 19, originalFailuresRetained: true };
});
await check('D05-prior-review-bound-not-rerun', () => { const prior = freeze.files.find(entry => entry.path.endsWith('overlay-v2-review/README.md')); assert.equal(prior.commit, freeze.priorCommit); assert.equal(prior.sha256, prior.gitSha256); return prior; });
await check('D06-compressed-archives-hash-only', () => { for (const entry of [projection.target.pack, projection.baseline.archive]) { const info = fs.lstatSync(entry.physical); assert(info.isFile() && !info.isSymbolicLink()); assert.equal(info.size, entry.bytes); assert.equal(hash(fs.readFileSync(entry.physical)), entry.sha256); } return { targetIndexedMembers: 858, decompressed: false, staged: false }; });
await check('D07-complete-projection-metadata', () => {
  assert.equal(projection.target.files.length, 858); assert.equal(projection.baseline.closure.files.length, 3844); assert.equal(projection.baseline.assets.length, 29);
  assert.equal(projection.baseline.excluded.length, 1);
  const instruction = entry => entry.path.split('/').some(name => name.toUpperCase() === 'AGENTS.MD');
  assert.equal(projection.target.files.filter(instruction).length, 0); assert.equal(projection.baseline.closure.files.filter(instruction).length, 1);
  for (const name of ['target-installed', 'target-moved', 'baseline-installed']) assert.equal(viewProjection(projection, name).files.filter(instruction).length, 0);
  return { instructionContentReads: 0, assets: 29, targetMembers: 858, closureMembers: 3844 };
});
await check('D08-preserved-counts-and-separate-setup', () => {
  const amendment = json(path.join(author, 'AMENDMENT.json')).unchanged;
  assert.deepEqual([amendment.selectedLegacy, amendment.unselectedLegacy, amendment.newWorkflows, amendment.controlFamilies, amendment.semanticExecutions, amendment.targetSetupExecutions, amendment.controlSetupExecutions], [23, 31, 10, 12, 99, 66, 2]);
  assert.deepEqual(amendment.scores, { target: '13/54', baseline: '47/54' });
  assert.deepEqual(amendment.historical.map(row => [row.passed, row.total]), [[400, 402], [391, 394]]);
});
await check('D09-moved-view-origin-metadata', () => { const expected = viewProjection(projection, 'target-moved'); const view = { ...expected, name: 'target-moved', root: '/frozen/target-moved', oldOrigin: '/frozen/move-origin' }; assert(authenticateView(projection, view)); assert.throws(() => authenticateView(projection, { ...view, oldOrigin: '/fallback' }), { code: 'MOVE_ORIGIN_BINDING' }); });
await check('D10-stage-data-hash-bound', () => { const bytes = Buffer.from('{"views":{}}'); assert.deepEqual(parseStage(bytes, hash(bytes)), { views: {} }); assert.throws(() => parseStage(Buffer.from('{"views":{"extra":{}}}'), hash(bytes)), { code: 'STAGED_HASH' }); });
await check('D11-tools-hash-bound', () => { for (const tool of projection.tools) assert.equal(hash(fs.readFileSync(tool.path)), tool.sha256); return projection.tools.map(tool => ({ role: tool.role, sha256: tool.sha256 })); });
await check('S01-F1-emit-rejection-still-disposes', async () => { let disposed = 0; const primary = new Error('emit-start'); const outcome = await settle({ body: async () => 17, emit: async phase => { if (phase === 'dispose-start') throw primary; }, dispose: async () => { disposed++; } }); assert.equal(disposed, 1); assert.equal(outcome.primary, primary); assert.equal(outcome.safe, false); });
await check('S02-F1-ordered-primary-and-secondary-errors', async () => { const primary = new Error('body'); const outcome = await settle({ body: async () => { throw primary; }, emit: async phase => { throw new Error(phase); }, dispose: async () => { throw new Error('dispose'); } }); assert.equal(outcome.primary, primary); assert.deepEqual(outcome.errors.map(row => row.phase), ['body', 'emit:dispose-start', 'dispose', 'emit:dispose-settled']); });
for (const [name, primary] of [['null', null], ['undefined', undefined]]) await check(`S03-F1-${name}-primary-retained`, async () => { const outcome = await settle({ body: async () => { throw primary; }, emit: async () => { throw new Error('secondary'); }, dispose: async () => {} }); assert.equal(outcome.primary, primary); });
for (const phase of ['before', 'after', 'unsafe-result', 'action']) await check(`S04-F2-${phase}-stops-tail`, async () => {
  let dispatched = 0, boundaries = 0;
  const result = await serial([{ id: 'first' }, { id: 'tail' }], async () => { dispatched++; if (phase === 'action') throw new Error('action'); return { safe: phase !== 'unsafe-result', pass: true }; }, async () => { boundaries++; if ((phase === 'before' && boundaries === 1) || (phase === 'after' && boundaries === 2)) throw new Error(phase); });
  assert(result.unsafe); assert.equal(result.rows[1].status, 'UNRUN_UNSAFE_TAIL'); assert.equal(dispatched, phase === 'before' ? 0 : 1);
});
await check('S05-F2-settled-assertion-may-continue', async () => { let dispatched = 0; const result = await serial([{ id: 'first' }, { id: 'tail' }], async () => { dispatched++; return { safe: true, pass: false }; }, async () => {}); assert.equal(dispatched, 2); assert.equal(result.unsafe, false); });
await check('S06-W03-shared-bytes-distinct-qualification', () => { for (const engine of ['virtual-bash', 'just-bash']) { const report = reportFor(specimen('W03')); report.telemetry = telemetry(engine); assert.deepEqual(validateTelemetry(engine, report.telemetry), []); const result = assessWorkflow(specimen('W03'), report, engine); assert.equal(result.sharedSemanticsPass, true); assert.equal(result.pass, null); assert.equal(result.completeTelemetryQualified, false); } });
await check('S07-F3-malformed-receipts-cannot-qualify', () => { for (const engine of ['virtual-bash', 'just-bash']) for (const value of [null, [], {}, { ...telemetry(engine), timers: null }, { ...telemetry(engine), timers: { status: 'UNQUALIFIED', reason: '' } }, { ...telemetry(engine), extra: {} }]) { const report = reportFor(specimen('W03')); report.telemetry = value; assert(validateTelemetry(engine, value).length > 0); assert.equal(assessWorkflow(specimen('W03'), report, engine).pass, false); } });
await check('S08-W03-byte-status-filesystem-negatives', () => { for (const kind of ['stdout', 'status', 'filesystem']) { const report = reportFor(specimen('W03')); report.telemetry = telemetry('virtual-bash'); if (kind === 'stdout') report.result.stdoutBase64 = 'AA=='; if (kind === 'status') report.result.exitCode = 7; if (kind === 'filesystem') report.after.entries.find(entry => entry.path === '/fixture/copied').base64 = 'AA=='; assert.equal(assessWorkflow(specimen('W03'), report, 'virtual-bash').pass, false); } });
await check('S09-W07-no-bytes-inference', () => { const snapshot = { entries: [{ path: '/fixture/bin/tool', mode: 0o755 }] }; const events = [{ method: 'stat', outcome: 'returned' }, { method: 'access', mode: 1, outcome: 'returned' }]; const result = assessWhich(events, [], snapshot, snapshot, 'just-bash'); assert.equal(result.receipt.dispatchObservable, false); assert.equal(result.observations['No fixture executable is executed'], false); });
await check('S10-W07-receiver-and-semantic-phase', async () => { const events = []; let phase = 'setup'; const filesystem = { async stat() { assert.equal(this, filesystem); return {}; } }; const wrapped = instrumentFilesystem(filesystem, events, () => phase); await wrapped.stat('/fixture/bin/tool'); assert.equal(events.length, 0); phase = 'semantic'; await wrapped.stat('/fixture/bin/tool'); assert.equal(events.length, 1); });
await check('S11-child-success-requires-all-exit-close-group-fields', () => { assert(settled(childReceipt())); for (const altered of [{ reaped: false }, { exit: { code: 7, signal: null } }, { close: null }, { close: { code: 0, signal: 'SIGTERM' } }, { signals: ['SIGTERM'] }, { failures: [{ code: 'CAPTURE_LIMIT' }] }]) assert.equal(settled({ ...childReceipt(), ...altered }), false); });
await check('S12-complete-outcome-positive-model', () => assert.equal(qualify(specimen('W01'), reportFor(specimen('W01')), childReceipt(), true, 'virtual-bash').pass, true));
for (const [name, mutate] of [
  ['missing-late', report => { delete report.late; }],
  ['late-error', report => { report.late = [{ message: 'unhandled' }]; }],
  ['denied-load', report => { report.loads.denied = [{ code: 'UNBOUND_MODULE' }]; }],
  ['missing-post-guard', report => { delete report.postGuard; }],
  ['execution-error', report => { report.executionError = { message: 'execution failed' }; }],
]) await check(`S13-outcome-rejects-${name}`, () => { const report = reportFor(specimen('W01')); mutate(report); const result = qualify(specimen('W01'), report, childReceipt(), true, 'virtual-bash'); assert.equal(result.safe, false); });
const workerText = fs.readFileSync(path.join(author, 'worker.mjs'), 'utf8');
const prefixStart = workerText.indexOf('  const configBytes =');
const prefixEnd = workerText.indexOf('  loader = installLoader');
assert(prefixStart > 0 && prefixEnd > prefixStart);
const prefix = workerText.slice(prefixStart, prefixEnd);
assert(!prefix.includes('await import('));
function workerPreimportModel(kind, phase) {
  const configBytes = Buffer.from(JSON.stringify({ kind, authorization: { phase }, view: { oldOrigin: null } }));
  const requireThat = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
  const execute = new Function('fs', 'process', 'hash', 'requireThat', 'readJson', 'path', 'root', 'authority', 'authenticateView', 'inspectTree', prefix);
  execute({ readFileSync: () => configBytes, existsSync: () => false }, { argv: ['node', 'worker', 'config', hash(configBytes)] }, hash, requireThat, () => ({}), path, '/synthetic-root', value => ({ phase: value.phase }), () => true, () => true);
}
await check('S14-admission-grant-cannot-admit-case-preimport', () => assert.throws(() => workerPreimportModel('case', 'admission')));
await check('S15-cohort-grant-cannot-admit-C11-preimport', () => assert.throws(() => workerPreimportModel('C11', 'cohort')));
await check('S16-transport-malformed-and-duplicate-final', () => { for (const text of ['', '{}', '{"sequence":0,"kind":"final"}\n{"sequence":1,"kind":"final"}\n', '{"sequence":1,"kind":"final"}\n', '{"sequence":0,"kind":"phase"}\n']) assert.throws(() => parseTransport(Buffer.from(text))); assert.equal(parseTransport(Buffer.from('{"sequence":0,"kind":"final"}\n')).length, 1); });
await check('S17-transport-write-failure-latches-disposal', async () => { const writer = transport(-1); let disposed = 0; const outcome = await settle({ body: async () => {}, emit: async phase => writer.emit({ phase }), dispose: async () => { disposed++; } }); assert.equal(disposed, 1); assert.equal(outcome.safe, false); assert.equal(writer.state().failed, true); assert.equal(outcome.errors[1].error.code, 'TRANSPORT_ALREADY_FAILED'); });
await check('S18-tree-extra-mode-symlink-negatives', () => {
  const directory = path.join(output, 'tree'); fs.mkdirSync(directory); const filename = path.join(directory, 'data'); fs.writeFileSync(filename, 'abc');
  const files = [{ path: 'data', bytes: 3, mode: 0o644, sha256: hash('abc') }]; inspectTree(directory, files);
  const extra = path.join(directory, 'extra'); fs.mkdirSync(extra); try { assert.throws(() => inspectTree(directory, files), { code: 'UNLISTED_ENTRY' }); } finally { fs.rmdirSync(extra); }
  fs.chmodSync(filename, 0o600); try { assert.throws(() => inspectTree(directory, files), { code: 'FILE_METADATA' }); } finally { fs.chmodSync(filename, 0o644); }
  const held = path.join(output, 'held'); fs.renameSync(filename, held); fs.symlinkSync(held, filename); try { assert.throws(() => inspectTree(directory, files), { code: 'SYMLINK' }); } finally { fs.unlinkSync(filename); fs.renameSync(held, filename); }
  inspectTree(directory, files);
});
await check('S19-instruction-name-rejected-before-content', () => { for (const name of ['AGENTS.md', 'nested/agents.MD', '../fallback', '/ambient']) assert.throws(() => relativeName(name)); });
let unsafeChild = false;
for (const mode of ['load', 'deny', 'late-rejection', 'output-overflow']) {
  if (unsafeChild) { checks.push({ id: `C-${mode}`, pass: false, status: 'UNRUN_UNSAFE_TAIL' }); continue; }
  await check(`C-${mode}`, async () => {
    assert(children.length < 4); assert.equal(active.size, 0);
    const handle = supervise(node.path, ['--unhandled-rejections=strict', '--max-old-space-size=64', path.join(own, 'child.mjs'), mode], own, { deadline: 2000 });
    active.add(handle);
    let receipt;
    try { receipt = await handle; } finally { active.delete(handle); }
    children.push({ mode, pid: receipt.pid, reaped: receipt.reaped, exit: receipt.exit, close: receipt.close, natural: receipt.natural });
    save(`child-${mode}.json`, receipt);
    unsafeChild = !receipt.reaped || !receipt.exit || !receipt.close || receipt.failures.some(error => ['REAP_DEADLINE', 'GROUP_REMAINS', 'SUPERVISION_EXCEPTION'].includes(error.code));
    assert.equal(unsafeChild, false);
    for (const identifier of [receipt.pid, -receipt.pid]) assert.throws(() => process.kill(identifier, 0), { code: 'ESRCH' });
    if (mode === 'load') { assert(settled(receipt)); const report = receipt.records.at(-1).report; assert.deepEqual(report.observation, { value: 73, fixtureOnly: true }); assert.deepEqual(report.loads.map(row => row.format).sort(), ['commonjs', 'module']); assert.equal(report.resources.pending, 0); }
    if (mode === 'deny') { assert(settled(receipt)); assert.deepEqual(receipt.records.at(-1).report.denied, ['UNBOUND_ASSET', 'OFFLINE_DENIED', 'OFFLINE_DENIED', 'UNBOUND_MODULE']); }
    if (mode === 'late-rejection') { assert.equal(settled(receipt), false); assert.equal(receipt.exit.code, 1); assert(Buffer.from(receipt.stderr, 'base64').toString().includes('PRESEALED_LATE_REJECTION')); }
    if (mode === 'output-overflow') { assert.equal(settled(receipt), false); assert(receipt.failures.some(error => error.code === 'CAPTURE_LIMIT')); }
  });
}
await check('D12-final-hashes-and-new-entry-check', () => { assert.deepEqual(snapshot(), initial); assert.deepEqual(membership(author), freeze.authorMembership); assert.equal(hash(fs.readFileSync(path.join(own, 'FREEZE.json'))), hash(freezeBytes)); });
await check('D13-all-owned-children-closed', () => { assert.equal(active.size, 0); assert.equal(children.length, 4); assert(children.every(child => child.reaped && child.exit && child.close)); });
save('FINAL.json', { files: snapshot(), membership: membership(author), activeChildren: active.size, children });
const result = { schema: 'independent-v3-data-synthetic-review', presealCommit, freezeSha256: hash(freezeBytes), recipeCommit: freeze.recipeCommit, recipeSha256: freeze.recipeSha256, checks, counts: { total: checks.length, passed: checks.filter(row => row.pass).length, failed: checks.filter(row => !row.pass).length, data: checks.filter(row => row.id.startsWith('D')).length, synthetic: checks.filter(row => !row.id.startsWith('D')).length }, children, activeChildren: active.size, execution: { product: 0, comparator: 0, native: 0, actualC11: 0, staging: 0, engineImports: 0, originalCohortsRerun: 0 }, workerPrefixSha256: hash(prefix), outcomeMutationScope: 'Assessor boundary coherence; not evidence of contradictory actual worker output.', phaseModelScope: 'Exact preimport worker prefix with fake trusted dependencies; no authority grant or engine import.' };
save('RESULT.json', result);
console.log(JSON.stringify({ counts: result.counts, failures: checks.filter(row => !row.pass).map(row => row.id), children: children.length, reaped: children.filter(child => child.reaped).length, active: active.size }));
if (result.counts.failed) process.exitCode = 1;
