import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const root = '/Users/kjopek/Workspace/safe-bash';
const own = `${root}/tests/integration/agent-bash-coherent-independent-20260829/stage-b1-r4-final-slot`;
const base = `${root}/tests/integration/agent-bash-coherent-author-20260829`;
const packetPath = `${base}/stage-b1-r4-final-binding/FINAL-BINDING.json`;
const deadline = fs.lstatSync(`${own}/raw/startup.stdout`).birthtimeMs + 360000;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const auth = []; let cumulative = 0;
function read(pin) {
  assert.ok(Date.now() <= deadline, 'review deadline');
  const stat = fs.lstatSync(pin.path); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, pin.bytes); assert.ok(stat.size <= 8388608);
  const bytes = fs.readFileSync(pin.path); assert.equal(bytes.length, stat.size); assert.equal(sha(bytes), pin.sha256);
  const after = fs.lstatSync(pin.path); assert.equal(after.ino, stat.ino); assert.equal(after.mtimeMs, stat.mtimeMs);
  cumulative += bytes.length; assert.ok(cumulative <= 100663296);
  auth.push({ ...pin, observedMode: stat.mode & 511 }); return bytes;
}
function stream(pin) {
  const descriptor = fs.openSync(pin.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor); assert.ok(stat.isFile()); assert.equal(stat.size, pin.bytes);
    const digest = crypto.createHash('sha256'); const buffer = Buffer.alloc(65536); let total = 0; let count;
    while ((count = fs.readSync(descriptor, buffer)) > 0) { assert.ok(Date.now() <= deadline); total += count; assert.ok(total <= pin.bytes); digest.update(buffer.subarray(0, count)); }
    assert.equal(total, pin.bytes); assert.equal(digest.digest('hex'), pin.sha256); const after = fs.fstatSync(descriptor); assert.equal(after.ino, stat.ino); assert.equal(after.mtimeMs, stat.mtimeMs); assert.equal(after.size, stat.size);
    auth.push({ ...pin, observedMode: stat.mode & 511, method: 'streamhash/no decode' });
  } finally { fs.closeSync(descriptor); }
}
function save(name, value) {
  assert.ok(Date.now() <= deadline); const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const descriptor = fs.openSync(`${own}/${name}`, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  return { bytes: bytes.length, sha256: sha(bytes) };
}
try {
  const packetBytes = read({ path: packetPath, bytes: 29531, sha256: '3da56afc93588c0bdfa016d02341ed4d0e8e22cd3441d0ecea3f97651b97ccc1' });
  const packet = JSON.parse(packetBytes);
  const runtime = JSON.parse(read(packet.runtimePreseal));
  const publication = JSON.parse(read(packet.publisherBinding));
  const publisherPreseal = JSON.parse(read(packet.publisherPreseal));
  assert.equal(packet.runtimePreseal.sha256, 'a7c5e284c4dedbb1726e2231a5e67b44ef960f55203706c73b79ce2e63fa8b70');
  assert.equal(packet.publisherBinding.sha256, '8cc5f053a7331bd7c31d73064269d2034485a0aa78b4a8c96128af2e3b0559ea');
  assert.equal(packet.publisherPreseal.sha256, '034d23073d3442a0d2bafde999c3367922867926a41780596bd3f28611b94613');
  assert.deepEqual(packet.runtimeFiles, runtime.files.map(entry => ({ path: path.resolve(root, entry.path), bytes: entry.bytes, sha256: entry.sha256 })));
  assert.deepEqual(packet.publisherFiles, publication.files.map(entry => ({ path: path.resolve(root, entry.path), bytes: entry.bytes, sha256: entry.sha256 })));
  assert.equal(packet.runtimeFiles.length, 55); assert.equal(packet.publisherFiles.length, 5); assert.equal(packet.preimportFiles.length, 2);
  for (const entry of [...packet.runtimeFiles, ...packet.publisherFiles, ...packet.preimportFiles]) read(entry);
  for (const entry of packet.preimportOrigin.origins) assert.deepEqual(read(entry), read(entry.origin));
  stream(packet.product.package); stream(packet.node);
  const prior = `${root}/tests/integration/agent-bash-coherent-independent-20260829/stage-b1-r4/RECEIPT.json`;
  const priorStat = fs.lstatSync(prior);
  read({ path: prior, bytes: priorStat.size, sha256: 'cf206ca25a94fba2c8152b8105aa4eb558996555f4121cfdc48870c34146735d' });
  const control = JSON.parse(read(packet.controlSourcePreseal)); read(control.sourceHelper);
  for (const entry of control.files) read(entry);
  const { authenticatePacketFiles } = await import(pathToFileURL(`${base}/stage-b1-r4-final-binding/preimport.mjs`).href);
  const { combinedIdentities } = await import(pathToFileURL(`${base}/stage-b1-r4-final-binding/identity.mjs`).href);
  const identities = control.files.map(entry => ({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 }));
  const rows = [];
  const check = (id, callback) => { callback(); rows.push({ id, status: 'PASS', role: 'PURE_BINDING_NOT_RUNTIME' }); };
  check('S01', () => { const seen = []; authenticatePacketFiles({ publisherFiles: [identities[0]], preimportFiles: [identities[1]] }, entry => { seen.push(entry.path); }); assert.deepEqual(seen, identities.map(entry => entry.path)); });
  check('S02', () => { let reads = 0; assert.throws(() => authenticatePacketFiles({ publisherFiles: [identities[0]], preimportFiles: [identities] }, () => { reads++; })); assert.equal(reads, 0); });
  check('S03', () => { let touched = 0; const invalid = { bytes: 1, sha256: '0'.repeat(64) }; Object.defineProperty(invalid, 'path', { get() { touched++; return identities[0].path; }, enumerable: true }); assert.throws(() => authenticatePacketFiles({ publisherFiles: [invalid], preimportFiles: [] }, () => { touched++; })); assert.equal(touched, 0); });
  const absent = [];
  check('S04', () => {
    assert.equal(Date.parse(packet.expiresUTC) - Date.parse(packet.latestStartUTC), 1800000); assert.equal(Date.parse(packet.latestStartUTC) - Date.parse(packet.issuedUTC), 1200000);
    assert.equal(packet.actualAuthority, false); assert.equal(packet.bounds.knownOS, 32); assert.equal(packet.bounds.calls, 15);
    assert.ok(packet.runtimeCommand.argv[0].includes('/stage-b1-r4/')); assert.ok(packet.publicationCommand.argv[0].includes('/stage-b1-r4/')); assert.ok(packet.preimportCommand.argv[0].includes('/stage-b1-r4-final-binding/'));
    assert.equal(packet.preimportFiles.length, 2); assert.equal(combinedIdentities(packet.publisherFiles, packet.preimportFiles).length, 7);
    assert.equal(typeof packet.slots.knownStartsBeforePublication, 'object'); assert.equal(fs.existsSync(packet.slots.rootGrantFile), false); assert.equal(fs.existsSync(packet.slots.ledgerPath), false);
    assert.deepEqual(packet.runtimeCommand.argv, [`${base}/stage-b1-r4/launch.sh`, packet.runtimePreseal.path, packet.runtimePreseal.sha256, '20804']);
    assert.deepEqual(packet.publicationCommand.argv.slice(0, 6), [`${base}/stage-b1-r4/publication.sh`, '--publish', packet.publisherBinding.path, packet.publisherBinding.sha256, '3872', packet.slots.authorityPath]);
    assert.deepEqual(packet.publicationCommand.argv.slice(6).map(item => item.slot), ['authoritySha256', 'authorityBytes']);
    assert.equal(packet.preimportCommand.argv[0], packet.preimportFiles.find(item => item.path.endsWith('/preimport.mjs')).path); assert.equal(packet.preimportCommand.argv[1], packetPath);
    assert.deepEqual(packet.preimportCommand.argv.slice(2).map(item => item.slot), ['finalPacketSha256', 'finalPacketBytes', 'rootGrantSha256', 'rootGrantBytes', 'observedLedgerSha256', 'observedLedgerBytes']);
    for (const command of [packet.runtimeCommand, packet.publicationCommand, packet.preimportCommand]) { assert.equal(command.cwd, root); assert.equal(command.login, false); }
    for (const filename of packet.absentSlots) {
      let missing = false; try { fs.lstatSync(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; missing = true; }
      assert.ok(missing, `unused slot:${filename}`); absent.push(filename);
    }
    assert.deepEqual([packet.bounds.peak, packet.bounds.inclusiveSeconds, packet.bounds.guestWorkersTotal, packet.bounds.guestWorkersLive, packet.bounds.regexWorkers, packet.bounds.asyncLoaderThreads], [3, 1800, 15, 5, 0, 0]);
    assert.equal(packet.bounds.captureBytes, 67108864); assert.equal(packet.bounds.workBytes, 805306368);
  });
  authenticatePacketFiles(packet);
  for (const entry of packet.preimportFiles) read(entry);
  const at = new Date().toISOString();
  const decision = Date.now() < Date.parse(packet.latestStartUTC) ? 'ACCEPT_SCOPED_FINAL_SLOT_ONLY' : 'HOLD_WINDOW_EXPIRED';
  const result = { schema: 'B1-r4-final-slot-independent-v1', decision, at, phaseDeadline: deadline, bindingCommit: '5d8a638bb2320c1071d28d9aab1c1ed85e6a142e', presealCommit: '8f0908d54285e96eea86619c1e4ddd2338d8b9c0', packet: { bytes: 29531, sha256: sha(packetBytes) }, runtimePreseal: packet.runtimePreseal, publisherBinding: packet.publisherBinding, publisherPreseal: packet.publisherPreseal, checkedCounts: { runtime: 55, publisher: 5, helpers: 2, byteIdenticalOrigins: 2, controls: rows.length, unusedSlots: absent.length }, rows, absent, window: { issued: packet.issuedUTC, latest: packet.latestStartUTC, expires: packet.expiresUTC }, publisherPresealData: publisherPreseal, productCalls: 0, Workers: 0, publisherMain: false, preimportMain: false, actualAuthority: false, dynamicSlots: 'ROOT grant, measured ledger, same-buffer authority hashes/sizes remain unpopulated', prospectiveBounds: packet.bounds, qualifications: packet.qualifications };
  save('AUTH.json', auth); const resultPin = save('RECEIPT.json', result); console.log(JSON.stringify({ decision, at, resultPin, checked: result.checkedCounts, window: result.window, phaseDeadline: deadline }, null, 2));
} catch (error) {
  save('HOLD.json', { decision: 'HOLD', at: new Date().toISOString(), error: String(error.message), auth }); console.error(error); process.exitCode = 1;
}
