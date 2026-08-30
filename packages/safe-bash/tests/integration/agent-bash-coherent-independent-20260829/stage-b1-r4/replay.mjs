import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const root = '/Users/kjopek/Workspace/safe-bash';
const own = path.join(root, 'tests/integration/agent-bash-coherent-independent-20260829/stage-b1-r4');
const author = path.join(root, 'tests/integration/agent-bash-coherent-author-20260829/stage-b1-r4');
const deadline = fs.lstatSync(`${own}/raw/startup.stdout`).birthtimeMs + 720000;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const auth = []; const rows = [];
function read(file, pin, maximum = 4194304) {
  assert.ok(Date.now() <= deadline, 'phase deadline');
  const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  const bytes = fs.readFileSync(file); assert.equal(bytes.length, stat.size);
  if (pin) { assert.equal(bytes.length, pin.bytes); assert.equal(sha(bytes), pin.sha256); }
  auth.push({ path: file, bytes: bytes.length, sha256: sha(bytes), mode: stat.mode & 511 }); return bytes;
}
function save(name, value) { assert.ok(Date.now() <= deadline); fs.writeFileSync(`${own}/${name}`, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
const preseal = JSON.parse(read(`${author}/PRESEAL.json`, { bytes: 20804, sha256: 'a7c5e284c4dedbb1726e2231a5e67b44ef960f55203706c73b79ce2e63fa8b70' }));
const publication = JSON.parse(read(`${author}/PUBLICATION-BINDING.json`, { bytes: 3872, sha256: '8cc5f053a7331bd7c31d73064269d2034485a0aa78b4a8c96128af2e3b0559ea' }));
const controlPin = { bytes: 2602, sha256: '460c90fa20414c2f12e837194cd19ca04d01e895efc9daef82fc0ae728d37ec5' };
const controls = JSON.parse(read(`${author}/CONTROL-PRESEAL.json`, controlPin));
for (const row of controls.files) read(`${author}/${row.path}`, row);
read(path.join(root, controls.oldFixture.source), controls.oldFixture);
const priorPublication = JSON.parse(read(path.join(root, controls.oldPublication.path), controls.oldPublication));
for (const suffix of ['/policy.mjs', '/publish.mjs']) { const row = priorPublication.files.find(item => item.path.endsWith(suffix)); read(path.join(root, row.path), row); }
const layoutFile = path.join(root, 'tests/integration/agent-bash-coherent-author-20260829/stage-b1-r3/layout.mjs');
read(layoutFile, { bytes: 721, sha256: 'a9ba5c360eff82d7052fbbada2f42945b9aec949612ca9c06a48ad4d6322dddd' });
const oldArgv = process.argv;
process.argv = [process.execPath, `${author}/controls.mjs`, `${author}/CONTROL-PRESEAL.json`, controlPin.sha256, String(controlPin.bytes), `${own}/AUTHOR-REPLAY.json`];
try { await import(pathToFileURL(`${author}/controls.mjs`).href); } finally { process.argv = oldArgv; }
const originalResults = JSON.parse(read(`${own}/AUTHOR-REPLAY.json`));
assert.equal(originalResults.rows.length, 8); assert.ok(originalResults.rows.every(row => row.status === 'PASS'));
const { captureFailure } = await import(pathToFileURL(`${author}/failure.mjs`).href);
const policy = await import(pathToFileURL(`${author}/policy.mjs`).href);
const { createLayoutHarness } = await import(pathToFileURL(layoutFile).href);
function check(id, fn) { try { fn(); rows.push({ id, status: 'PASS', role: 'DATA_NOT_PRODUCT' }); } catch (error) { rows.push({ id, status: 'FAIL', message: error.message }); } }
check('N01', () => {
  for (const reason of [undefined, null, false, 0, -0, '', NaN, Infinity, -Infinity]) {
    const value = captureFailure(reason, 'bounded'); assert.equal(value.primaryPresent, true); assert.equal(value.causePresent, false);
    assert.equal(value.reason.type, reason === null ? 'null' : typeof reason);
    if (typeof reason === 'number') { assert.equal(value.reason.negativeZero, Object.is(reason, -0)); assert.ok(Object.is(value.reason.value, Number.isFinite(reason) ? reason : String(reason))); }
  }
});
check('N02', () => {
  let accessed = 0; const prototype = Object.defineProperty({}, 'message', { get() { accessed++; throw 0; } });
  const reason = Object.create(prototype); Object.defineProperty(reason, 'cause', { get() { accessed++; throw false; } });
  const value = captureFailure(reason, 'x'.repeat(81)); assert.equal(accessed, 0); assert.equal(value.phase.length, 80); assert.equal(Object.hasOwn(value.reason, 'message'), false); assert.equal(value.cause.type, 'ACCESSOR_UNREAD');
  const ownData = Object.assign(Object.create(null), { name: 'n', message: 'm'.repeat(257), code: 'c' }); assert.equal(captureFailure(ownData).reason.message.length, 256);
});
check('N03', () => {
  const pair = Proxy.revocable({}, {}); pair.revoke(); assert.equal(captureFailure(pair.proxy).reason.opaqueProxy, true);
  let touched = 0; const fn = new Proxy(function () {}, { get() { touched++; throw 0; } });
  assert.equal(captureFailure(fn).reason.type, 'function'); assert.equal(captureFailure(Symbol('opaque')).reason.type, 'symbol'); assert.equal(touched, 0);
});
check('N04', () => {
  const fixture = `${own}/layout-fixture`; fs.mkdirSync(fixture, { mode: 0o700 }); const installed = `${fixture}/installed`; fs.mkdirSync(installed);
  const before = createLayoutHarness(installed, 'installed'); fs.writeFileSync(path.join(before.harness, 'trace.data'), 'retained\n', { flag: 'wx' });
  const moved = `${fixture}/physically-moved`; fs.renameSync(installed, moved);
  const retained = path.join(moved, path.relative(installed, before.harness), 'trace.data');
  const after = createLayoutHarness(moved, 'physically-moved'); assert.notEqual(after.harness, path.dirname(retained)); assert.equal(fs.readFileSync(retained, 'utf8'), 'retained\n');
  assert.throws(() => createLayoutHarness(moved, 'physically-moved'), { code: 'EEXIST' }); assert.equal(fs.readFileSync(retained, 'utf8'), 'retained\n');
});
check('N05', () => {
  assert.equal(policy.resultProfile(Buffer.from('{}')).complete, false); assert.equal(policy.resultProfile(Buffer.alloc(0), false).knownRetirement, 'UNKNOWN');
  const layouts = ['source-built', 'installed', 'physically-moved'], ids = ['C10', 'C11', 'C15', 'C16', 'C18'];
  const result = { aggregate: layouts.map(layout => ({ layout, report: { rows: ids.map(id => ({ id, status: 'PASS' })) } })) };
  assert.equal(policy.resultProfile(Buffer.from(JSON.stringify(result))).complete, true); result.aggregate[2].report.rows[4].id = 'C16'; assert.equal(policy.resultProfile(Buffer.from(JSON.stringify(result))).complete, false);
  const start = Date.parse('2026-08-29T00:00:00.000Z'); const window = { startedUTC: new Date(start).toISOString(), expiresUTC: new Date(start + 1800000).toISOString(), latestStartUTC: new Date(start).toISOString() };
  assert.equal(policy.deadline(window, start + 1799999), start + 1800000); assert.throws(() => policy.deadline(window, start + 1800000));
  const ledger = new policy.Ledger(); ledger.charge(policy.limits.capture - policy.limits.tailCapture); assert.throws(() => ledger.charge(1)); ledger.beginTail(); ledger.charge(policy.limits.tailCapture); assert.throws(() => ledger.charge(1));
});
check('N06', () => {
  const profile = publication.workerProfile;
  assert.deepEqual([profile.knownOS, profile.peak, profile.calls, profile.guestWorkersTotal, profile.guestWorkersLive, profile.regexWorkers, profile.asyncLoaderThreads], [32, 3, 15, 15, 5, 0, 0]);
  assert.deepEqual([profile.inclusiveSeconds, profile.activeSeconds, profile.publicationReserveSeconds, profile.captureBytes, profile.workBytes], [1800, 1620, 180, 67108864, 805306368]);
  assert.equal(publication.rootActualAuthority, false); assert.equal(preseal.sourceInputs, 309); assert.equal(publication.package.sha256, '2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca');
  assert.equal(preseal.stageFiles.filter(row => row.target === 'failure.mjs').length, 1);
});
const b0 = JSON.parse(read(path.join(root, preseal.b0.path), preseal.b0));
const stageFile = path.join(root, 'tests/integration/agent-bash-coherent-author-20260829/stage-b0-r2/stageAProducerPreseal.json');
const stage = JSON.parse(read(stageFile, b0.stageAProducerPreseal));
const source = JSON.parse(read(stage.source.path, stage.source));
assert.equal(source.inputs.length, 309);
const sourceProof = [];
for (const file of ['src/contracts/command.ts', 'src/commands/node/index.ts', 'src/shell/shell.ts']) {
  const pin = source.inputs.find(row => row.path === file); assert.ok(pin);
  const bytes = read(path.join('/private/tmp/safe-bash-coherent-stage-a-20260829-r2/source', file), pin);
  const text = bytes.toString(); const lines = text.split('\n');
  const range = file.includes('command.ts') ? [55, 100] : file.includes('node/index') ? [20, 70] : [310, 345];
  sourceProof.push({ path: file, bytes: bytes.length, sha256: sha(bytes), lines: lines.slice(range[0] - 1, range[1]).map((value, index) => `${index + range[0]}: ${value}`) });
}
save('SOURCE-PROOF.json', sourceProof);
for (const row of controls.files) read(`${author}/${row.path}`, row);
save('AUTH.json', auth);
const result = { status: rows.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL', originalGroups: originalResults.rows, novelGroups: rows, sourceBodies: sourceProof.map(({ lines, ...rest }) => rest), at: new Date().toISOString(), deadline, productCalls: 0, Workers: 0, native: 0, layoutFixtures: 1, childProcesses: 0, sourceProofRole: 'frozen read only, not imported or executed' };
save('RESULT.json', result); console.log(JSON.stringify(result, null, 2));
if (result.status !== 'PASS') process.exitCode = 1;
