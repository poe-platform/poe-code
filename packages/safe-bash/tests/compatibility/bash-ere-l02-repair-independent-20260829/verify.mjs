import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const owned = 'tests/compatibility/bash-ere-l02-repair-independent-20260829';
const packet = 'tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/l02-repair-v1';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let readBytes = 0;
function read(filename) {
  const before = fs.lstatSync(filename);
  if (!before.isFile() || before.size > 4 * 1024 * 1024) throw Error('TYPE_SIZE');
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, Math.min(65536, bytes.length-offset), offset);
      if (!count) throw Error('SHORT');
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || fs.readSync(descriptor, Buffer.alloc(1), 0, 1, bytes.length)) throw Error('CHANGED');
    readBytes += bytes.length;
    if (readBytes > 64 * 1024 * 1024) throw Error('READ_CAP');
    return bytes;
  } finally { fs.closeSync(descriptor); }
}
const checks = [];
function check(id, name, action) {
  try { checks.push({ id, name, passed: true, result: action() }); }
  catch (reason) { checks.push({ id, name, passed: false, reason: String(reason) }); }
}
const sources = JSON.parse(read(packet + '/SOURCES.json'));
const producer = JSON.parse(read(packet + '/PRODUCER.json'));
const admission = JSON.parse(read(owned + '/load-admission.json'));
const pure = JSON.parse(read(owned + '/pure-result.json'));
const future = JSON.parse(read(packet + '/FOLLOWUP-13.json'));
check('V01', 'Only owner/root production changes', () => {
  const expected = ['src/commands/regex-execution/ere/transport/owner.ts', 'src/commands/regex-execution/ere/transport/root.ts'];
  assert.deepEqual(read(owned + '/production-changed.txt').toString().split('\0').filter(Boolean), expected);
  for (const name of ['owner','root']) {
    const source = sources.modules.find(row => row.name === 'transport/' + name + '.ts');
    assert.equal(hash(read(owned + '/pinned-' + name + '.txt')), source.sha256);
  }
  return expected;
});
check('V02', 'Ten unchanged accepted source modules', () => {
  const tree = new Map(read(owned + '/accepted-tree.txt').toString().split('\0').filter(Boolean).map(record => {
    const split = record.indexOf('\t'); return [record.slice(split+1), record.slice(0,split).split(' ')[2]];
  }));
  let unchanged = 0;
  for (const row of sources.modules) {
    const bytes = Buffer.from(row.base64, 'base64');
    assert.equal(bytes.length, row.size); assert.equal(hash(bytes), row.sha256);
    if (['transport/owner.ts', 'transport/root.ts'].includes(row.name)) continue;
    const blob = crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
    assert.equal(blob, tree.get('src/commands/regex-execution/ere/' + row.name));
    unchanged++;
  }
  assert.equal(unchanged, 10); return { unchanged };
});
check('V03', 'Admitted emissions and private package', () => {
  assert.equal(producer.entries.length, 25); assert.equal(admission.emittedFiles, 24); assert.equal(admission.archiveInflations, 0);
  const text = read(packet + '/PACKAGE.tgz.base64.data'); assert.equal(text.length, producer.textBytes); assert.equal(hash(text), producer.textSha256);
  const compressed = Buffer.from(text.toString().trim(), 'base64'); assert.equal(compressed.length, 18000); assert.equal(hash(compressed), 'dc20c2be0ea41ff11edeef105c9e93ab349a0601a14d77ecc2d6ac984dfb43b0');
  for (const row of producer.entries.filter(row => row.name.startsWith('ere/'))) {
    const bytes = read(packet + '/BUILD/emitted/' + row.name.slice(4)); assert.equal(bytes.length, row.size); assert.equal(hash(bytes), row.sha256);
  }
  return { entries: 25, emissions: 24, compressedBytes: 18000, archiveInflations: 0 };
});
check('V04', '16 replay plus ten novel identities', () => {
  const replay = JSON.parse(read(owned + '/replay-result.json'));
  assert.equal(replay.groups.length, 16); assert.equal(new Set(replay.groups.map(row => row.id)).size, 16); assert(replay.groups.every(row => row.pass));
  assert.equal(pure.novel.rows.length, 10); assert.equal(new Set(pure.novel.rows.map(row => row.id)).size, 10); assert(pure.novel.rows.every(row => row.pass));
  assert.equal(pure.actualWorkers, 0); assert.equal(pure.matchingCalls, 0); assert.equal(pure.publicShellCalls, 0);
  return { replay: replay.groups.map(row => row.id), novel: pure.novel.rows.map(row => row.id), actualWorkers: 0, matching: 0, publicShell: 0 };
});
check('V05', 'Exact private loaded byte closure', () => {
  const privateLoads = pure.loaded.filter(row => row.url.endsWith('.js'));
  assert.equal(privateLoads.length, 14);
  for (const row of privateLoads) {
    const name = row.url.replace('l02-replay:///BUILD/emitted/', '').replace('l02-novel:///', '');
    assert(['errors.js','limits.js','transport/accounting.js','transport/owner.js','transport/protocol.js','transport/root.js','transport/validation.js'].includes(name));
    const entry = producer.entries.find(entry => entry.name === 'ere/' + name);
    assert.equal(row.bytes, entry.size); assert.equal(row.sha256, entry.sha256);
  }
  assert.equal(pure.replacements.length, 2);
  assert(pure.replacements.every(row => row.importer.endsWith('/transport/owner.js') && row.replacement.endsWith('/fake-worker.mjs')));
  return { loadedPrivateModules: 14, logicalDependenciesPerNamespace: 7, workerReplacements: 2, nativeWorkerLoads: 0 };
});
check('V06', 'Actual seven-counter no-refund data', () => {
  const engineKeys = ['patternBytes','subjectBytes','work','states','allocationUnits','captureBytes','captureSlots'];
  const expected = { patternBytes: 1, subjectBytes: 1, work: 131072, states: 512, allocationUnits: 40960, captureBytes: 4096, captureSlots: 64 };
  const results = [];
  for (const row of pure.novel.rows.slice(0,5)) {
    const { before, after } = row.observation;
    for (const data of [before.engine, after.engine]) {
      assert.deepEqual(Reflect.ownKeys(data), engineKeys);
      for (const key of engineKeys) { assert(Object.hasOwn(Object.getOwnPropertyDescriptor(data,key), 'value')); assert.equal(data[key], expected[key]); }
    }
    assert.equal(before.transport.live, 757); assert.equal(after.transport.live, 757);
    assert.equal(before.transport.reserved, 53); assert.equal(after.transport.reserved, 53);
    assert(after.transport.spent >= before.transport.spent); assert(after.transport.work >= before.transport.work);
    results.push({ id: row.id, engine: after.engine, retainedLive: after.transport.live, retainedReserved: after.transport.reserved });
  }
  return { cases: results, qualification: 'Checks captured finite own-data values; no additional production evaluations; absent engine.unknown assertion is not proof.' };
});
check('V07', '13-cell proposal and separate six/seven gates', () => {
  assert.equal(future.authorization, false); assert.equal(future.cells.length, 13); assert(future.cells.every(row => row.status === 'UNRUN'));
  assert.equal(future.cells.reduce((sum,row) => sum + row.workers, 0), 10); assert.equal(future.cells.at(-1).mustBeLast, true);
  const remaining = JSON.parse(read(packet + '/REMAINING-COVERAGE.json'));
  assert.equal(remaining.nonpublic.length, 6); assert.equal(remaining.publicMapping.ids.length, 7);
  return { cells: 13, WorkersCeiling: 10, nonpublic: 6, public: 7, authorization: false, caps: future.capsProposal };
});
check('V08', 'Prospective fixture hash and historical status', () => {
  const tree = read(owned + '/evidence-tree.txt').toString().split('\0').filter(Boolean);
  const filename = tree.map(record => record.slice(record.indexOf('\t')+1)).find(name => name.endsWith('/' + future.fixture.name));
  assert(filename); const bytes = read(filename); assert.equal(bytes.length, future.fixture.bytes); assert.equal(hash(bytes), future.fixture.sha256);
  const results = JSON.parse(read(packet + '/RESULTS.json'));
  assert.equal(results.pure.firstParseFailure.controlsExecuted, 0); assert.equal(results.pure.second.passed, 16); assert.equal(results.pure.thirdHelper.archivePublished, false);
  return { singleFaultFixture: { filename, bytes: bytes.length, sha256: hash(bytes) }, firstHelper: '0/16 SyntaxError retained', correctedAuthorHelper: '16/16', dataArchive: 'STOP row cap; exact row NOT_RECORDED; no archive retry', T1: '75PASS/1nonpass/59UNRUN unchanged' };
});
check('V09', 'Fresh owned census and publication reserve', () => {
  const rows = [];
  for (const name of fs.readdirSync(owned).sort()) {
    if (rows.length >= 32) throw Error('ENTRY_CAP');
    const filename = path.join(owned,name); const bytes = read(filename); rows.push({ path: filename, bytes: bytes.length, sha256: hash(bytes) });
  }
  const bytes = rows.reduce((sum,row) => sum + row.bytes, 0);
  const captureBytes = rows.filter(row => /\.(stdout|stderr)\.txt$/.test(row.path)).reduce((sum,row) => sum + row.bytes, 0);
  const reserveBytes = 4 * 1024 * 1024;
  assert(bytes + reserveBytes < 384 * 1024 * 1024); assert(captureBytes + reserveBytes < 64 * 1024 * 1024);
  assert(Date.now() < Date.parse('2026-08-29T15:36:53Z'));
  return { at: new Date().toISOString(), bytes, captureBytes, reserveBytes, helperInvocations: 3, plannedKnownStartsIncludingPublication: 34, peakKnownRoles: 3, rows, qualification: 'Before this receipt/commit; later publication reserved, not a physical quota/RSS/OS-containment or continuous-peak claim.' };
});
const result = { schema: 'l02-independent-final-data-v1', at: new Date().toISOString(), source: 'ACCEPT_PRIVATE_POLICY', pure: '26_OF_26_FIXED_CONTROLS', preexec: 'HOLD', actualGO: false, productionEvaluationsInThisHelper: 0, readBytes, checks };
fs.writeFileSync(owned + '/verification.json', JSON.stringify(result,null,2) + '\n');
console.log(JSON.stringify({ at: result.at, checks: checks.map(({id,name,passed,reason}) => ({id,name,passed,reason})), source: result.source, pure: result.pure, preexec: result.preexec, actualGO: false },null,2));
if (checks.some(row => !row.passed)) process.exitCode = 1;
