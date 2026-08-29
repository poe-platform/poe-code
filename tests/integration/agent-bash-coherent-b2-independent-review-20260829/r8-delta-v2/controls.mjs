import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const [sealPath, expectedHash, output] = process.argv.slice(2);
const sealStat = fs.lstatSync(sealPath); assert(sealStat.isFile() && sealStat.size < 131072);
const sealBytes = fs.readFileSync(sealPath); assert.equal(digest(sealBytes), expectedHash);
const seal = JSON.parse(sealBytes); assert(Date.now() < Date.parse(seal.controlDeadline));
for (const row of seal.inputs) {
  const stat = fs.lstatSync(row.path); assert(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, row.bytes);
  assert.equal(digest(fs.readFileSync(row.path)), row.sha256);
}
const { sampleTree } = await import(pathToFileURL(seal.cacheModule));
const { publishOwnedCopy } = await import(pathToFileURL(seal.publicationModule));
const { ledger } = await import(pathToFileURL(seal.supportModule));
fs.mkdirSync(output);
const groups = [];
const run = (id, check) => { try { check(); groups.push({ id, status: 'PASS' }); } catch (reason) { groups.push({ id, status: 'FAIL', reasonPresent: true, reason: String(reason?.stack ?? reason) }); } };
const directory = { isDirectory: () => true };
const file = size => ({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false, size });
const missing = Object.assign(new Error('synthetic missing'), { code: 'ENOENT' });
function model(target, operation, reason, size = 5) {
  return { lstatSync(filename) { if (filename === target && operation === 'lstat') throw reason; return ['/r', '/r/cache', '/r/cache/d'].includes(filename) ? directory : file(size); }, readdirSync(filename) { if (filename === target && operation === 'readdir') throw reason; return filename === '/r' ? ['cache', 'immutable'] : filename === '/r/cache' ? ['d'] : ['file']; } };
}
const options = io => ({ cacheRoot: '/r/cache', active: true, reservationBytes: 32, maximumBytes: 100, io });
run('T01-cache-lstat-race', () => { const result = sampleTree(['/r'], options(model('/r/cache/d/file', 'lstat', missing))); assert.equal(result.snapshotRaceCount, 1); assert.equal(result.bytes, 37); });
run('T02-cache-readdir-race', () => { const result = sampleTree(['/r'], options(model('/r/cache/d', 'readdir', missing))); assert.equal(result.snapshotRaceCount, 1); assert.equal(result.races[0].kind, 'SNAPSHOT_RACE'); });
run('T03-immutable-missing', () => assert.throws(() => sampleTree(['/r'], options(model('/r/immutable', 'lstat', missing))), reason => reason === missing));
run('T04-other-falsy-errors', () => { for (const reason of [Object.assign(new Error('denied'), { code: 'EACCES' }), false, undefined]) { let caught = false; try { sampleTree(['/r'], options(model('/r/cache/d/file', 'lstat', reason))); } catch (error) { caught = true; assert.equal(error, reason); } assert(caught); } });
run('T05-quiescent-strict', () => assert.throws(() => sampleTree(['/r'], { ...options(model('/r/cache/d/file', 'lstat', missing)), active: false }), reason => reason === missing));
run('T06-reservation-and-aggregate', () => { assert.throws(() => sampleTree(['/r'], options(model('none', 'none', null, 33)))); assert.throws(() => sampleTree(['/r'], { ...options(model('none', 'none', null)), maximumBytes: 36 })); });
run('T07-cache-anchor-missing', () => assert.throws(() => sampleTree(['/r'], options(model('/r/cache', 'lstat', missing))), reason => reason === missing));
const payload = path.join(output, 'payload'), receipts = path.join(output, 'identities');
const source = path.join(output, 'source'), other = path.join(output, 'other');
const bytes = Buffer.from('identity\n');
fs.writeFileSync(source, bytes, { flag: 'wx' }); fs.writeFileSync(other, bytes, { flag: 'wx' });
const expected = { bytes: bytes.length, sha256: digest(bytes) };
const publish = (origin, name, identityRoot = receipts, descriptor = expected) => publishOwnedCopy(origin, path.join(payload, name), descriptor, payload, identityRoot);
run('T08-publication-identities-v2-api', () => {
  assert.equal(publish(source, 'copy').outcome, 'created-copy'); assert.equal(publish(source, 'copy').outcome, 'verified-existing-copy');
  assert.throws(() => publish(other, 'copy'));
  const different = path.join(output, 'different'); fs.writeFileSync(different, 'different\n', { flag: 'wx' });
  assert.throws(() => publish(different, 'copy', receipts, { bytes: 10, sha256: digest(Buffer.from('different\n')) }));
  assert.deepEqual(fs.readFileSync(path.join(payload, 'copy')), bytes);
});
run('V2-01-legitimate-sidecar-name', () => {
  assert.equal(publish(other, 'copy.source.json').outcome, 'created-copy'); assert.equal(publish(other, 'copy.source.json').outcome, 'verified-existing-copy');
  assert.deepEqual(fs.readdirSync(payload).sort(), ['copy', 'copy.source.json']); assert.equal(fs.readdirSync(receipts).length, 2);
});
run('V2-02-conflicts-and-reserved-namespace', () => {
  assert.throws(() => publish(other, 'copy'));
  for (const invalid of [payload, path.join(payload, 'reserved'), output]) assert.throws(() => publish(source, 'must-not-exist', invalid));
  assert(!fs.existsSync(path.join(payload, 'must-not-exist')));
  assert.throws(() => publishOwnedCopy(source, path.join(receipts, 'reserved-payload'), expected, payload, receipts));
  publish(source, 'tamper'); fs.writeFileSync(path.join(payload, 'tamper'), 'wrong\n');
  assert.throws(() => publish(source, 'tamper')); assert.equal(fs.readFileSync(path.join(payload, 'tamper'), 'utf8'), 'wrong\n');
});
run('N01-cache-prefix-neighbor-strict', () => {
  const io = model('/r/cache-other/file', 'lstat', missing);
  const read = io.readdirSync; io.readdirSync = name => name === '/r' ? ['cache', 'cache-other'] : name === '/r/cache-other' ? ['file'] : read(name);
  const stat = io.lstatSync; io.lstatSync = name => name === '/r/cache-other' ? directory : stat(name);
  assert.throws(() => sampleTree(['/r'], options(io)), reason => reason === missing);
});
run('N02-accessor-code-not-consumed', () => {
  let reads = 0; const fault = Object.defineProperty({}, 'code', { get() { reads++; return 'ENOENT'; } });
  assert.throws(() => sampleTree(['/r'], options(model('/r/cache/d/file', 'lstat', fault))), reason => reason === fault); assert.equal(reads, 0);
});
run('N03-actual-ledger-activation-reconciliation', () => {
  const home = path.join(output, 'ledger'); fs.mkdirSync(home); const cache = path.join(home, 'cache'); fs.mkdirSync(cache);
  fs.writeFileSync(path.join(cache, 'file'), 'five!');
  const accounting = ledger([home], Date.now() + 10000);
  assert.equal(accounting.beginCache(cache).reservedCacheBytes, 134217728);
  assert.equal(accounting.cacheNeedsReconciliation(), true);
  assert.equal(accounting.reconcileCache().cachePhase, 'quiescent');
  assert.equal(accounting.cacheNeedsReconciliation(), false); assert.equal(accounting.cacheStatus().reservedBytes, 0);
});
run('N04-actual-ledger-anchor-symlink-refusal', () => {
  const home = path.join(output, 'link-ledger'); fs.mkdirSync(home); fs.mkdirSync(path.join(home, 'real'));
  fs.symlinkSync('real', path.join(home, 'cache'));
  const accounting = ledger([home], Date.now() + 10000); assert.throws(() => accounting.beginCache(path.join(home, 'cache')));
  assert.equal(accounting.cacheStatus().cachePhase, 'idle');
});
for (const row of seal.inputs) assert.equal(digest(fs.readFileSync(row.path)), row.sha256);
const result = { groups, pass: groups.filter(row => row.status === 'PASS').length, fail: groups.filter(row => row.status === 'FAIL').length,
  actualProduct: 0, npm: 0, workers: 0, churn: 0, scope: 'PURE synthetic IO and bounded owned-file DATA; no native npm peak proof', endedUTC: new Date().toISOString() };
fs.writeFileSync(path.join(output, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result)); process.exitCode = result.fail ? 1 : 0;
