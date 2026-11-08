import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = '/Users/kjopek/Workspace/safe-bash';
const own = path.dirname(fileURLToPath(import.meta.url));
const relative = 'tests/compatibility/bash-ere-core-public-pilot-preparation-20260829/runtime-author-v1/r2';
const root = path.join(repo, relative);
const parent = path.dirname(root);
const sourceCommit = '0f8684d8eea2042cef6ab194ad2f9be165b31698';
const expectedProfile = 'bacc21fb126bb6e0b5441bee560cb0bad1f7ffda01d129b996c1cdd3e6312e05';
const started = Date.now();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const admitted = [];
function read(filename, maximum = 2097152) {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.length, stat.size);
  admitted.push({ path: filename, bytes: bytes.length, sha256: hash(bytes) });
  return bytes;
}
function write(name, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  assert(bytes.length <= 2097152);
  fs.writeFileSync(path.join(own, name), bytes, { flag: 'wx' });
}
const rows = [];
async function control(id, body) {
  try { await body(); rows.push({ id, status: 'PASS' }); }
  catch (reason) { rows.push({ id, status: 'FAIL', reasonPresent: true, detail: String(reason) }); }
}
try {
  const metadata = spawnSync('/usr/bin/git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'ls-tree', '-rz', sourceCommit, '--', relative], { cwd: repo, encoding: 'buffer', maxBuffer: 1048576, timeout: 10000 });
  write('git.stdout', metadata.stdout ?? Buffer.alloc(0));
  write('git.stderr', metadata.stderr ?? Buffer.alloc(0));
  assert.equal(metadata.status, 0); assert.equal(metadata.signal, null); assert(!metadata.error);
  const committed = new Map();
  for (const entry of metadata.stdout.toString().split('\0').filter(Boolean)) {
    const match = /^(\d+) blob ([0-9a-f]{40})\t(.+)$/.exec(entry); assert(match);
    const bytes = read(path.join(repo, match[3]));
    assert.equal(crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), match[2]);
    committed.set(path.basename(match[3]), bytes);
  }
  const profileBytes = committed.get('PROFILE.json'); assert.equal(hash(profileBytes), expectedProfile);
  const profile = JSON.parse(profileBytes);
  const priorBytes = read(path.join(parent, 'PROFILE.json'));
  assert.equal(hash(priorBytes), '446f44cea9091ce59a12c5591bc1d6e91049003848bef33bd75f520c98728aa6');
  const prior = JSON.parse(priorBytes);
  const { assets, ...rest } = profile; const { assets: oldAssets, ...oldRest } = prior;
  assert.deepEqual(rest, oldRest);
  for (const item of assets) { const bytes = read(item.path); assert.equal(hash(bytes), item.sha256); assert.equal(bytes.length, item.bytes ?? item.size); }
  const coreText = committed.get('core.mjs').toString();
  const finalizerText = committed.get('finalization.mjs').toString();
  const coordinatorText = committed.get('coordinator.mjs').toString();
  const authorText = committed.get('controls-seal.mjs').toString();
  assert(coreText.startsWith("import assert from 'node:assert/strict';"));
  assert.equal((coreText.match(/^import /gm) ?? []).length, 1);
  assert(finalizerText.startsWith("import { ledger, describeLedger } from './core.mjs';"));
  assert(coordinatorText.indexOf('return await finalizeInvocation({') < coordinatorText.indexOf('const journalDescriptor = fs.openSync'));
  assert(coordinatorText.includes('run: async failures => {'));
  assert(coordinatorText.includes('failures, started, now, sample'));
  assert(!coordinatorText.includes('for (const descriptor of descriptors) fs.closeSync'));
  const controlsStart = authorText.indexOf('const results = [];');
  const controlsEnd = authorText.indexOf('const assets = ', controlsStart);
  assert(controlsStart > 0 && controlsEnd > controlsStart);
  const authorBody = authorText.slice(controlsStart, controlsEnd);
  assert.equal((authorBody.match(/await control\(/g) ?? []).length, 8);
  const functionBody = finalizerText.slice(finalizerText.indexOf('\n') + 1).replace('export async function finalizeInvocation', 'return async function finalizeInvocation');
  write('PRESEAL.json', { sourceCommit, expectedProfile, helperSha256: hash(read(fileURLToPath(import.meta.url))), admitted, authorBodySha256: hash(Buffer.from(authorBody)), finalizerFunctionSha256: hash(Buffer.from(functionBody)), membership: ['R01','R02','R03','R04','R05','R06','R07','R08','N05-r2','N06-unknown','N07-secondary'], roles: { pureHelper: 1, metadataGit: 1, expectedWorkers: 0, expectedProductCalls: 0 }, extraction: 'Exact author control bodies; stop before author sealing/publication. Exact finalizer function, remove import/export only; core import only node:assert/strict.', historical: ['026d2e9fbd9bca460bb6267d7fc3e131540d754b HOLD14/15', 'ab57fa894 startup capture STOP'] });
  const core = await import('data:text/javascript;base64,' + Buffer.from(coreText).toString('base64'));
  const finalizeInvocation = new Function('ledger', 'describeLedger', functionBody)(core.ledger, core.describeLedger);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const authorRows = await new AsyncFunction('assert', 'finalizeInvocation', 'schedule', 'profile', authorBody + '\nreturn results;')(assert, finalizeInvocation, core.schedule, prior);
  rows.push(...authorRows);
  await control('N05-r2-extracted-finally', async () => {
    const ownerRoot = {}; const retained = new Set([ownerRoot]); const closed = [];
    let present = false; let reason;
    try { await finalizeInvocation({ ownerRoot, retained, ownership: [], descriptors: [17,18], run: async () => { throw 0; }, close: descriptor => { closed.push(descriptor); throw false; }, emergency() {}, report() {} }); }
    catch (caught) { present = true; reason = caught; }
    assert(present); assert.equal(reason, 0); assert.deepEqual(closed, [17,18]); assert(!retained.has(ownerRoot));
    assert.deepEqual(ownerRoot.failures.secondary.map(row => row.reason), [false,false]);
  });
  await control('N06-unknown-getter-retention', async () => {
    const ownerRoot = {}; const retained = new Set([ownerRoot]); const marker = {};
    const receipt = { get retired() { throw marker; } }; let reason; let present = false;
    try { await finalizeInvocation({ ownerRoot, retained, ownership: [{ receipt }], descriptors: [], run: async () => { throw undefined; }, close() {}, emergency() {}, report() {} }); }
    catch (caught) { reason = caught; present = true; }
    assert(present); assert.equal(reason, undefined); assert(retained.has(ownerRoot)); assert.equal(ownerRoot.failures.secondary[0].reason, marker);
  });
  await control('N07-secondary-overflow-report', async () => {
    const ownerRoot = {}; const retained = new Set([ownerRoot]); let reason;
    try { await finalizeInvocation({ ownerRoot, retained, ownership: [], descriptors: Array.from({ length: 32 }, (_, index) => index), run: async () => { throw null; }, close: descriptor => { throw descriptor; }, emergency() { throw false; }, report() { throw undefined; } }); }
    catch (caught) { reason = caught; }
    assert.equal(reason, null); assert.equal(ownerRoot.failures.secondary.length, 32); assert.equal(ownerRoot.failures.omitted, 2); assert.equal(ownerRoot.failures.secondary[0].reason, false); assert(!retained.has(ownerRoot));
  });
  for (const binding of [...admitted]) assert.equal(hash(read(binding.path)), binding.sha256);
  const grant = JSON.parse(committed.get('GRANT-TEMPLATE.json'));
  assert.equal(grant.authorized, false); assert.equal(grant.profileSha256, expectedProfile); assert.equal(grant.pilotReview, null);
  const result = { verdict: rows.every(row => row.status === 'PASS') ? 'PREEXEC-DELTA-ACCEPT' : 'HOLD', sourceCommit, expectedProfile, rows, elapsedMilliseconds: Date.now() - started, actual: { pureHelpers: 1, metadataGit: 1, productCalls: 0, workers: 0, coordinatorExecutions: 0 }, scope: 'Actual extracted finalizer + exact eight author PURE bodies; whole coordinator/native acquisition/public cell remain SOURCE-only.', grantTemplate: path.join(root, 'GRANT-TEMPLATE.json'), commandTemplate: path.join(root, 'INERT-COMMAND.txt'), grant, conditionalWorkBytes: 254938146, headroomBytes: 13497310, previousHoldsUnchanged: true };
  write('RESULT.json', result);
  write('REPORT.md', `# R2 independent delta review\n\n${result.verdict}: ${rows.filter(row => row.status === 'PASS').length}/${rows.length} PURE groups.\n\nSource ${sourceCommit}; profile ${expectedProfile}. Exact extracted finalizer N05 keeps raw0 despite closefalse, attempts both closes and independently removes known-retired root. UNKNOWN/getter-fault references stay retained; bounded secondary overflow preserves primary. Journal acquisition/shared schedule/emergency/bootstrap wiring SOURCE-only, not native fault proof.\n\n24 selectors/oracles, archive, cell assets, tools and all non-asset profile fields unchanged by exact comparison. No archive inflation/product/npm/build/install/Workers/coordinator invocation. Eight author bodies are extracted before their publication code, not imported with author writes.\n\nPrevious 026d HOLD14/15 and ab57 startup STOP unchanged. Preliminary guessed controls.mjs lookup failed in tool transcript; corrected through committed scoped inventory, no execution at that point. Source display truncation is not reconstructed; helper admits complete committed bytes.\n\nFuture grant: ${path.join(root, 'GRANT-TEMPLATE.json')}; command: ${path.join(root, 'INERT-COMMAND.txt')}. Grant remains false/null, no activation window. Require fresh ROOT/review receipt, authorized=true, exact profile hash, issuedAt/latestStart/expiresAt, monotonic outerStarted before bootstrap/admin, qualified outer capture/ownership and publication. Existing schema validation permits only its exact 19 keys. 40 known OS ceiling/36 enumerated, peak4, <=24 Workers one-live;1200s inclusive180s publication;64MiB capture;256MiB sampled/quiescent logical work, conditional254938146/margin13497310. Not prewrite work/native peak/RSS/OSquota; Git internal disk excluded. Trusted npm regular-pin vs appended-entry/symlink qualification remains. Full135/six nonpublic/seven broader CORE remain OPEN.\n\nKnown review roles are bounded to20 including inspection, editor and Git publication; peak <=3. Helper owns one synchronous metadata child, exit0/signalnull, no unknown active child. Final administrative count must include publication; not a universal census.\n`);
  console.log(JSON.stringify({ verdict: result.verdict, pass: rows.filter(row => row.status === 'PASS').length, total: rows.length, receiptSha256: hash(fs.readFileSync(path.join(own, 'RESULT.json'))) }));
  process.exitCode = result.verdict === 'HOLD' ? 1 : 0;
} catch (reason) {
  console.error(reason);
  write('FAILURE.json', { primaryPresent: true, detail: String(reason), stack: reason?.stack, rows, elapsedMilliseconds: Date.now() - started });
  process.exitCode = 1;
}
