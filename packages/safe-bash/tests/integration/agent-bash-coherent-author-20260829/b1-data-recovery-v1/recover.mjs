import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const repo = '/Users/kjopek/Workspace/safe-bash';
const scope = 'tests/integration/agent-bash-coherent-author-20260829/b1-data-recovery-v1';
const output = path.join(repo, scope);
const finalPath = path.join(repo, 'tests/integration/agent-bash-coherent-author-20260829/b1-r6-window-v2/FINAL.json');
const finalHash = '89f3c55c91dc664a94df815ef23d5ddbbe6fb7376a1ef5a8e490255c475dd72b';
const maximum = 1048576, aggregateMaximum = 67108864, reserve = 16777216;
const sourceRecords = [], missing = [], directories = [];
let written = 0, filesWritten = 0;
const started = Date.now();
const deadline = started + 300000;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function clock() { assert(Date.now() < deadline, 'recovery stage deadline'); }
function put(filename, bytes, mode = 0o600) {
  clock(); assert(filesWritten + 1 <= 512); assert(written + bytes.length <= aggregateMaximum - reserve, 'recovery data leaves16MiB publication tail');
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, mode);
  try { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert(count > 0); offset += count; } fs.fchmodSync(descriptor, mode); }
  finally { fs.closeSync(descriptor); }
  written += bytes.length; filesWritten++;
}
const json = (filename, value) => put(filename, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
async function identity(filename, expected) {
  clock(); assert(path.isAbsolute(filename) && path.normalize(filename) === filename); assert.notEqual(path.basename(filename), 'AGENTS.md');
  const stat = fs.lstatSync(filename); assert(stat.isFile() && !stat.isSymbolicLink(), 'regular nonsymlink only');
  assert.equal(fs.realpathSync(filename), filename, 'physical source pathname');
  if (expected) assert.equal(stat.size, expected.bytes);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename, { highWaterMark: 65536 })) { clock(); hash.update(chunk); }
  const result = { path: filename, bytes: stat.size, sha256: hash.digest('hex'), mode: stat.mode & 0o7777, dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, origin: { finalSha256: finalHash, locator: filename } };
  const after = fs.lstatSync(filename); assert.equal(after.ino, stat.ino); assert.equal(after.size, stat.size); assert.equal(after.mode, stat.mode); assert.equal(after.mtimeMs, stat.mtimeMs);
  if (expected) assert.equal(result.sha256, expected.sha256);
  if (stat.size > maximum) { json(path.join(output, 'OVERSIZE-STOP.json'), { status: 'COPY_STOP_NO_TRUNCATION', result }); throw new Error('source exceeds1MiB; stat/hash retained only'); }
  return result;
}
async function bytesFor(record) {
  const current = await identity(record.path, record); assert.deepEqual(current, Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'role')));
  const bytes = fs.readFileSync(record.path); assert.equal(bytes.length, record.bytes); assert.equal(digest(bytes), record.sha256); return bytes;
}
function combine(records) {
  const unique = new Map();
  for (const row of records) {
    if (unique.has(row.path)) assert.deepEqual(row, unique.get(row.path), 'conflicting identity for same source path');
    else unique.set(row.path, row);
  }
  return [...unique.values()];
}
async function add(filename, role, expected, optional = false) {
  try { const record = await identity(filename, expected); sourceRecords.push({ ...record, role }); return record; }
  catch (error) { if (optional && error?.code === 'ENOENT') { missing.push({ path: filename, role, status: 'ABSENT_NOT_ZERO_OR_CLEANUP_PROOF' }); return null; } throw error; }
}
async function prepare() {
  const final = await add(finalPath, 'executed-FINAL', { bytes: 25661, sha256: finalHash });
  const packet = JSON.parse(await bytesFor(final));
  for (const filename of packet.outerCaptureSlots) await add(filename, 'original-outer-capture');
  for (const [name, filename] of Object.entries(packet.slots)) await add(filename, `original-admin-${name}`, undefined, true);
  const result = await add(path.join(packet.runtimeRoot, 'RESULT.json'), 'original-runtime-result', { bytes: 33587, sha256: 'b434a5e57c190854f4996c4f2eebd4a6c76044afa68ab3d6f8ba10f25c0e26b5' });
  for (const directory of [packet.captureRoot, path.join(packet.runtimeRoot, 'capture')]) {
    const stat = fs.lstatSync(directory); assert(stat.isDirectory() && !stat.isSymbolicLink()); assert.equal(fs.realpathSync(directory), directory);
    const names = fs.readdirSync(directory).sort(); assert(names.length <= 64);
    directories.push({ path: directory, names });
    for (const name of names) {
      assert(/^(?:events\.jsonl|[0-9A-Za-z_-]+\.(?:stdout|stderr))$/.test(name), 'unexpected capture directory member');
      await add(path.join(directory, name), 'fixed-capture-directory-member');
    }
  }
  for (const layout of ['source-built', 'installed', 'physically-moved']) {
    const location = layout === 'installed' ? 'physically-moved' : layout;
    for (const suffix of ['workers.jsonl', 'request.json', 'members.json', 'engine-receipt.json']) {
      await add(path.join(packet.runtimeRoot, location, `${layout}-${suffix}`), `layout-${layout}-${suffix}`);
    }
  }
  const runtimePreseal = await add(packet.runtimePreseal.path, 'runtime-preseal-authority', packet.runtimePreseal);
  const parsedPreseal = JSON.parse(await bytesFor(runtimePreseal)); assert.equal(parsedPreseal.workRoot, packet.runtimeRoot);
  const helper = await identity(path.join(output, 'recover.mjs'));
  const sourceBytes = sourceRecords.reduce((sum, row) => sum + row.bytes, 0);
  assert(sourceRecords.length <= 128 && sourceBytes < 16 * 1024 * 1024);
  const seal = { schema: 'B1_SEPARATE_DATA_RECOVERY_V1', sourceRecords, missing, directories, helper,
    sourceBytes, sourceFiles: sourceRecords.length, startedUTC: new Date(started).toISOString(),
    controls: ['D01-identical-reference-union','D02-conflicting-identity','D03-byte-and-mode-preservation','D04-collision-safe-names','D05-provenance-mismatch','D06-symlink-refusal'],
    maximumSourceBytes: maximum, maximumFiles: 512, maximumAggregateBytes: aggregateMaximum, publicationTailReservedBytes: reserve,
    executionDeadlineUTC: new Date(started + 480000).toISOString(),
    policy: 'DATA recovery only; original publisher HOLD and packet unchanged; no replay or old acceptance. Git internal physical storage trusted/unobserved. Startup and final publication streams require reserved-tail postcheck.' };
  const body = Buffer.from(JSON.stringify(seal, null, 2) + '\n'); put(path.join(output, 'PRESEAL.json'), body);
  console.log(JSON.stringify({ status: 'PREPARED_DATA_ONLY', presealBytes: body.length, presealSha256: digest(body), sourceFiles: seal.sourceFiles, sourceBytes, missing, pid: process.pid, noChildSpawns: true, endedUTC: new Date().toISOString() }));
}
async function execute(sealHash) {
  const sealIdentity = await identity(path.join(output, 'PRESEAL.json')); assert.equal(sealIdentity.sha256, sealHash);
  const seal = JSON.parse(await bytesFor(sealIdentity)); assert(Date.now() < Date.parse(seal.executionDeadlineUTC));
  assert.deepEqual(await identity(seal.helper.path), seal.helper);
  const groups = [];
  const sample = { path: '/private/tmp/synthetic/source', bytes: 3, sha256: 'a'.repeat(64), mode: 0o600, origin: { locator: '/private/tmp/synthetic/source', finalSha256: finalHash }, dev: 1, ino: 2, mtimeMs: 3 };
  const control = async (id, action) => { await action(); groups.push({ id, status: 'PASS' }); };
  await control('D01-identical-reference-union', () => assert.equal(combine([sample, structuredClone(sample)]).length, 1));
  await control('D02-conflicting-identity', () => { for (const change of [{ bytes: 4 }, { sha256: 'b'.repeat(64) }, { mode: 0o644 }, { origin: { locator: '/other', finalSha256: finalHash } }]) assert.throws(() => combine([sample, { ...sample, ...change }])); });
  const fixtures = path.join(output, 'control-data'); fs.mkdirSync(fixtures);
  await control('D03-byte-and-mode-preservation', async () => {
    for (const [index, bytes, mode] of [[0, Buffer.from([0, 255, 10, 13]), 0o640], [1, Buffer.alloc(0), 0o600]]) {
      const source = path.join(fixtures, `source-${index}`); put(source, bytes, mode); const record = await identity(source);
      const copy = path.join(fixtures, `copy-${index}`); put(copy, await bytesFor(record), record.mode);
      assert.deepEqual(fs.readFileSync(copy), bytes); assert.equal(fs.lstatSync(copy).mode & 0o7777, mode);
    }
  });
  await control('D04-collision-safe-names', () => { const names = ['/x/copy','/x/copy.source.json','/y/copy'].map(name => digest(Buffer.from(name))); assert.equal(new Set(names).size, 3); });
  await control('D05-provenance-mismatch', () => { assert.throws(() => combine([sample, { ...sample, ino: 3 }])); assert.throws(() => combine([sample, { ...sample, origin: { ...sample.origin, finalSha256: 'b'.repeat(64) } }])); });
  await control('D06-symlink-refusal', async () => { const link = path.join(fixtures, 'symlink'); fs.symlinkSync('source-0', link); try { await assert.rejects(identity(link), /regular nonsymlink/); } finally { fs.unlinkSync(link); } });
  const manifest = [];
  for (const record of combine(seal.sourceRecords)) {
    const bytes = await bytesFor(record); const key = digest(Buffer.from(record.path));
    const dataPath = `data/${key}.raw`, identityPath = `identities/${key}.json`;
    put(path.join(output, dataPath), bytes, record.mode);
    const receipt = { source: record, dataPath, identityPath, copiedBytes: bytes.length, copiedMode: record.mode, copiedSha256: digest(bytes) };
    json(path.join(output, identityPath), receipt); manifest.push(receipt);
    assert.equal(fs.lstatSync(path.join(output, dataPath)).mode & 0o7777, record.mode);
    assert.equal(digest(fs.readFileSync(path.join(output, dataPath))), record.sha256);
  }
  for (const record of seal.sourceRecords) assert.deepEqual(await identity(record.path), Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'role')));
  for (const directory of seal.directories) assert.deepEqual(fs.readdirSync(directory.path).sort(), directory.names);
  const resultRecord = manifest.find(row => row.source.role === 'original-runtime-result');
  const result = JSON.parse(fs.readFileSync(path.join(output, resultRecord.dataPath)));
  const matrix = result.aggregate.map(row => ({ layout: row.layout, rows: row.report.rows.map(cell => ({ id: cell.id, status: cell.status })), passed: row.report.passed, failed: row.report.failed, workerCreates: row.guestWorkerCreates, workerExits: row.guestWorkerExits, workerPeak: row.guestWorkerPeak, workerExitCodes: row.events.filter(event => event.kind === 'node-worker-exit').map(event => event.code), regexWorkers: row.regexWorkers, internalLoaderThreads: row.internalLoaderThreads }));
  assert.equal(matrix.length, 3); assert.equal(matrix.reduce((sum, row) => sum + row.passed, 0), 15);
  const runtimeEvents = manifest.find(row => row.source.path.endsWith('/capture/events.jsonl') && row.source.path.includes('coherent-b1-r5-runtime'));
  assert(runtimeEvents);
  const events = fs.readFileSync(path.join(output, runtimeEvents.dataPath), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const retirements = events.filter(row => Object.hasOwn(row, 'unknown'));
  assert.equal(retirements.length, 4); assert(retirements.every(row => row.exited && row.closed && row.unknown === false));
  const stopRecord = manifest.find(row => row.source.path === '/private/tmp/coherent-b1-r5-admin/STOP.json'); assert(stopRecord);
  const stop = JSON.parse(fs.readFileSync(path.join(output, stopRecord.dataPath)));
  const preimport = stop.snapshot.starts.find(row => row.role === 'publication-preimport'); assert.equal(preimport.exitCode, 78); assert.equal(preimport.closeCode, 78);
  const rejectionRecord = manifest.find(row => row.source.path.endsWith('/capture/publication-preimport.stderr'));
  assert(fs.readFileSync(path.join(output, rejectionRecord.dataPath), 'utf8').includes('Identity duplicate path'));
  const outcomes = { kind: 'RECOVERED_DATA_NOT_CAMPAIGN_ACCEPTANCE', groups, matrix, runtimeRetirement: result.retirement, recordedRetirements: retirements, preimport, originalKnownStarts: stop.snapshot.knownStarts,
    originalOuterExit: 78, publicationStatus: 'HOLD_DUPLICATE_IDENTITY_UNCHANGED', childStreamEOF: 'UNOBSERVED_FOR_RUNTIME_CHILDREN', workerExitCodes: 'literal1_retained', providerFinalization: 'C16 controlled release, not opaque preemption', noRerun: true };
  json(path.join(output, 'OUTCOMES.json'), outcomes);
  const manifestBody = Buffer.from(JSON.stringify({ schema: 'B1_RECOVERED_DATA_MANIFEST_V1', finalSha256: finalHash, sources: manifest, absent: seal.missing, originalSourcesPostchecked: seal.sourceRecords.length, noOriginalModeChanges: true }, null, 2) + '\n');
  put(path.join(output, 'MANIFEST.json'), manifestBody);
  put(path.join(output, 'ROOT-POLICY.md'), Buffer.from('# Separate DATA recovery\n\nROOT authorized this new evidence copy only. Original FINAL89f3c55c and failed publication remain unchanged. Exact identical source references may collapse only in this new manifest after origin/size/hash/mode identity equality; conflict refuses. No reinterpretation of the old publisher as PASS. No product/runtime/Worker/compiler/npm/native replay. All copies are regular nonsymlink exact bytes and source modes. Raw Worker exit1, runtime stream EOF UNOBSERVED, controlled provider release and known-role-only retirement remain qualified. Git internal physical storage is excluded as trusted/unobserved. Recovery startup/Git/postpublication streams use reserved bounded tail, not a claim of kernel write interception or zero post-census bytes.\n'));
  put(path.join(output, 'HANDOFF.md'), Buffer.from(`# B1 separate DATA recovery\n\nPreserved ${manifest.length} exact source files, six DATA controls PASS, runtime15PASS across3layouts and15Worker create/exit records. Original publication HOLD duplicate identity, preimport78, outer78 unchanged. MANIFEST SHA256 ${digest(manifestBody)}. No runtime/oldpublisher replay; see OUTCOMES.json and ROOT-POLICY.md for retained qualifications. Publication-tail stream sealing is a separate final step; this producer cannot attest its own exit.\n`));
  console.log(JSON.stringify({ status: 'DATA_RECOVERY_COMPLETE_NOT_CAMPAIGN_PASS', manifestSha256: digest(manifestBody), manifestBytes: manifestBody.length, filesCopied: manifest.length, sourceBytes: manifest.reduce((sum, row) => sum + row.source.bytes, 0), groups, written, filesWritten, reservedTailBytes: reserve, pid: process.pid, noChildSpawns: true, endedUTC: new Date().toISOString() }));
}
try {
  if (process.argv[2] === 'prepare') await prepare();
  else { assert.equal(process.argv[2], 'recover'); await execute(process.argv[3]); }
} catch (error) {
  const record = { status: 'RECOVERY_STOP', primaryPresent: true, message: String(error?.stack ?? error), written, filesWritten, sourceRecords, missing, endedUTC: new Date().toISOString() };
  json(path.join(output, `STOP-${process.argv[2]}.json`), record); console.error(JSON.stringify(record)); process.exitCode = 78;
}
