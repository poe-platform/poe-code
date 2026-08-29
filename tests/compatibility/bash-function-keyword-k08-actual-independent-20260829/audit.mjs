import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';

const root = process.argv[2];
const input = root + '/inputs/';
const actual = 'activation-v1/actual-v1/';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = path => {
  const stat = fs.lstatSync(path);
  assert(stat.isFile() && stat.size <= 2097152, 'regular bounded input');
  return fs.readFileSync(path);
};
const pin = (bytes, expected) => {
  assert.equal(bytes.length, expected.bytes, 'byte count');
  assert.equal(hash(bytes), expected.sha256, 'digest');
};
const json = name => JSON.parse(read(input + name));
const inputs = JSON.parse(read(root + '/INPUTS.json'));
for (const entry of inputs) pin(read(input + entry.path), entry);
const sealBytes = read(input + 'SEAL.json');
pin(sealBytes, {bytes:200923,sha256:'db262c234c02526f2864ef66d8e137e9cd9817645431d944ff3459ad3c89d9d9'});
const seal = JSON.parse(sealBytes), cases = json('CASES.json'), manifest = json(actual + 'RAW-MANIFEST.json');
const terminal = json(actual + 'TERMINAL-SUMMARY.json'), go = json('GO.json');
for (const [name, expected] of Object.entries(seal.files)) pin(read(input + name), expected);
pin(read(input + 'GO.json'), terminal.rootAuthorization.grant);
pin(read(input + 'REVIEW.json'), terminal.rootAuthorization.review);
pin(read(input + 'activation-v1/COMMAND.resolved.txt'), terminal.rootAuthorization.command);
assert.equal(go.preseal, hash(sealBytes));
const raw = new Map();
for (const part of manifest.parts) {
  const bytes = read(input + actual + part.path); pin(bytes, part);
  const contents = JSON.parse(bytes); assert.equal(contents.files.length, part.files);
  for (const entry of contents.files) {
    assert(!raw.has(entry.path), 'duplicate raw path');
    const bytes = Buffer.from(entry.base64, 'base64');
    assert.equal(bytes.toString('base64'), entry.base64); pin(bytes, entry);
    raw.set(entry.path, bytes);
  }
}
assert.equal(raw.size, 469); assert.equal(manifest.files.length, 469);
assert.equal([...raw.values()].reduce((sum, bytes) => sum + bytes.length, 0), 15816908);
for (const entry of manifest.files) pin(raw.get(entry.path), entry);
const decode = name => JSON.parse(raw.get(name));
const owner = decode('TARGET-RESULT.json'), collector = decode('COLLECTOR.json');
const validLifecycle = row => {
  assert.equal(row.exit, true); assert.equal(row.close, true);
  assert.equal(row.stdoutEOF, true); assert.equal(row.stderrEOF, true);
  assert.equal(row.knownOutstanding, 0); assert.equal(row.forced, false);
  assert.equal(row.signal, null); assert.equal(row.primaryPresent, false);
  assert.deepEqual(row.secondary, []); assert(row.finished < collector.finalDeadline);
  const eventNames = row.events.map(event => event.event);
  for (const capture of row.captures) {
    pin(Buffer.from(capture.base64, 'base64'), capture);
    assert.equal(capture.flushed, true); assert.equal(capture.closed, true);
  }
  return eventNames;
};
assert.equal(owner.status, 'COMPLETED'); assert.equal(owner.primaryPresent, false);
assert.deepEqual(owner.secondary, []); assert.equal(owner.ledger.rows.length, 77);
assert.equal(owner.ledger.starts, 78); assert.equal(owner.ledger.active, 0);
for (const row of owner.ledger.rows) validLifecycle(row);
validLifecycle(collector.ownerLifecycle);
assert.equal(collector.primaryPresent, false); assert.deepEqual(collector.secondary, []);
assert.equal(collector.status, 'COLLECTOR_COMPLETED');
pin(raw.get('TARGET-RESULT.json'), collector.ownerResultPin);
assert(collector.started >= go.issuedAtEpochMs && collector.started <= go.latestStartEpochMs);
assert.equal(collector.finalDeadline, Math.min(collector.started + seal.limits.durationMs, go.expiresEpochMs));
assert(owner.finished <= collector.ownerLifecycle.finished);
const expectedIds = cases.layouts.flatMap(layout => cases.rows.map(row => layout + ':' + row.id)).sort();
const checkMembership = rows => assert.deepEqual(rows.map(row => row.receipt.layout + ':' + row.receipt.caseId).sort(), expectedIds);
checkMembership(owner.observations);
const frame = data => { const bytes = Buffer.from(data.base64, 'base64'); pin(bytes, data); return bytes; };
const checkCase = (row, expected) => {
  const receipt = row.receipt, observed = receipt.observation;
  assert.equal(receipt.caseId, expected.id);
  if (expected.expectedRejection) {
    assert.equal(observed.kind, 'rejected'); assert.equal(observed.hasPrimary, true);
    assert.deepEqual(receipt.reasonFields, expected.expectedRejection);
  } else { assert.equal(observed.kind, 'resolved'); assert.equal(observed.status, expected.status ?? 0); }
  assert.deepEqual(frame(observed.stdout), Buffer.from(expected.stdout));
  const err = frame(observed.stderr);
  if (expected.stderrContains !== undefined) assert(err.toString().includes(expected.stderrContains));
  else assert.deepEqual(err, Buffer.from(expected.stderr ?? ''));
  assert.deepEqual(observed.filesBefore, observed.filesAfter);
  assert.equal(observed.hasCleanupError, false); assert.equal(observed.cleanup.settled, true);
  assert.deepEqual(receipt.publicSettlement.events, ['exec-started', expected.expectedRejection ? 'exec-rejected' : 'exec-resolved', 'dispose-started', 'dispose-resolved']);
};
const checkLoaded = (row, expectedHash) => {
  pin(raw.get(row.id + '.role.json'), row.rolePin); pin(raw.get(row.id + '.trace'), row.trace);
  const role = decode(row.id + '.role.json');
  const events = raw.get(row.id + '.trace').toString().trim().split('\n').map(line => JSON.parse(line));
  const loads = events.filter(event => event.event === 'module-loaded' && event.url === row.helperLoad.url);
  assert.equal(loads.length, 1); assert.equal(loads[0].role, row.id);
  assert.equal(loads[0].sha256, expectedHash); assert.equal(row.helperLoad.sha256, expectedHash);
  assert.equal(role.files[role.helperEntry].sha256, expectedHash);
  assert.deepEqual(JSON.parse(raw.get(row.id + '.stdout')), row.receipt);
  assert.equal(raw.get(row.id + '.stderr').length, 0);
};
for (const row of owner.observations) {
  checkCase(row, cases.rows.find(expected => expected.id === row.receipt.caseId));
  checkLoaded(row, seal.compiledHelperSha256);
}
for (const row of owner.helpers) {
  assert.equal(row.receipt.results.length, 16);
  assert(row.receipt.results.every(result => result.pass === true && result.liveReleased === true && result.closed === true));
  checkLoaded(row, seal.compiledHelperSha256);
}
const mutantHashes = ['b3f167969a3771def4ebeb4a3e363826f86f2277d5c000313a9743c2a8282256','589ebb1a41e7443e664496cc57b1f3e98f357b60837501c3a8b8aaa7c4295475','1f033294567f6d5923bc42c8428058f1b56a85e426217b99d0411643aaaa2f7b'];
for (const [index, mutation] of owner.mutants.entries()) checkLoaded(mutation.observed, mutantHashes[index]);
const first = owner.mutants[0].observed.receipt.observation;
assert.equal(first.status, 1); assert.equal(frame(first.stdout).length, 0);
assert.equal(frame(first.stderr).toString(), 'shell: line 1: $1 - 1: arithmetic syntax error in expression (error token is "$1 - 1")\n');
const second = owner.mutants[1].observed.receipt.observation;
assert.equal(second.status, 0); assert.equal(frame(second.stdout).toString(), '9:9'); assert.equal(frame(second.stderr).length, 0);
const failed = owner.mutants[2].observed.receipt.results.filter(row => !row.pass);
assert.equal(failed.length, 1); assert.equal(failed[0].id, 'H04'); assert.equal(failed[0].hasPrimary, false);
for (const [id, code] of [['N01','AUTH_HASH'],['N02','EDGE_REFUSED']]) {
  const lifecycle = decode(id + '-lifecycle.json'); assert.notEqual(lifecycle.status, 0);
  assert.equal(raw.get(id + '.stdout').length, 0); assert(raw.get(id + '.stderr').toString().includes(code));
}
const archive = read(seal.archive.path); pin(archive, seal.archive);
const tar = zlib.gunzipSync(archive, {maxOutputLength:seal.archive.decodedBytes});
assert.equal(tar.length, seal.archive.decodedBytes);
const shipping = new Map(seal.shipping.map(entry => [entry.path, entry])); const members = new Set();
let offset = 0;
while (offset + 512 <= tar.length && tar[offset] !== 0) {
  const header = tar.subarray(offset, offset + 512);
  const name = header.subarray(0, 100).toString().split('\0')[0].replace(/^package\//, '');
  const size = parseInt(header.subarray(124, 136).toString().replace(/\0/g, '').trim(), 8);
  assert(Number.isSafeInteger(size) && size >= 0); assert(!members.has(name));
  assert(shipping.has(name), 'shipping member'); pin(tar.subarray(offset + 512, offset + 512 + size), shipping.get(name));
  members.add(name); offset += 512 + Math.ceil(size / 512) * 512;
}
assert.equal(members.size, 1006); assert(tar.subarray(offset).every(byte => byte === 0));
const ledgerBytes = read(root + '/ADMIN-LEDGER.json');
assert.equal(hash(ledgerBytes),'d8313efb358280f7f438b8762c92811c21dbf69767803f0e7c1488aa038f4453');
const ledger = JSON.parse(ledgerBytes);
assert.equal(ledger.starts.length, 7);
for (const row of ledger.starts) {
  assert.deepEqual(row.exit,{code:0,signal:null}); assert.deepEqual(row.close,{code:0,signal:null});
  assert(row.finished < ledger.deadline); for (const stream of ['stdout','stderr']) pin(read(row[stream].path), row[stream]);
}
const controls = [];
const rejects = (name, run) => { assert.throws(run); controls.push(name); };
rejects('raw-byte', () => pin(Buffer.from('changed'), manifest.files[0]));
rejects('missing-primary', () => checkMembership(owner.observations.slice(1)));
rejects('duplicate-primary', () => checkMembership([...owner.observations.slice(1), owner.observations[1]]));
const altered = structuredClone(owner.observations[0]); const bytes = Buffer.from('changed');
altered.receipt.observation.stderr = {bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')};
rejects('diagnostic', () => checkCase(altered, cases.rows[0]));
rejects('mutant-hash', () => checkLoaded(owner.mutants[0].observed, seal.compiledHelperSha256));
rejects('missing-close', () => validLifecycle({...owner.ledger.rows[0],close:false}));
const result = {schema:'K08-INDEPENDENT-AUDIT-RESULT-1',finished:new Date().toISOString(),inputCount:inputs.length,rawFiles:raw.size,rawBytes:manifest.rawBytes,packageMembers:members.size,primary:owner.observations.length,helpers:owner.helpers.map(row=>({id:row.id,rows:row.receipt.results.length})),mutants:3,bindings:2,tamperControls:controls,knownDirectRows:owner.ledger.rows.length,ownerRetired:collector.ownerLifecycle.qualified,collectorTerminal:collector.status,administrativeRoles:ledger.starts.length,administrativeFinished:new Date(Math.max(...ledger.starts.map(row=>row.finished))).toISOString(),noNewTypesOrRestores:true,qualifications:['source-prepared/returned load trace plus exact result, not standalone evaluation proof','known direct roles, not universal descendants','collector process exit is reported tool evidence, not an independent OS probe','no native/product execution by reviewer','original STOP1002 and LF-copy qualification retained']};
fs.writeFileSync(root + '/RESULT.json', JSON.stringify(result,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify(result)+'\n');
