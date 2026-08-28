import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createGzip, createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';

const here = path.dirname(fileURLToPath(import.meta.url));
const continuation = path.dirname(here);
const own = path.resolve(continuation, '../..');
const work = path.join(continuation, 'RUN-ARRAY-TAIL-20260828-01');
const records = path.join(work, 'records');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const read = filename => {
  assert.equal(fs.realpathSync(filename), filename);
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.nlink, 1);
  assert.ok(stat.size <= 64 * 1024 * 1024);
  return fs.readFileSync(filename);
};
const json = filename => JSON.parse(read(filename));
const put = (name, value) => fs.writeFileSync(path.join(here, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
const terminal = json(path.join(here, 'ACTUAL-TERMINAL.json'));
assert.equal(terminal.coordinatorExitCode, 0);
assert.equal(terminal.terminal.accepted, true);
const finalBytes = read(path.join(records, 'FINAL.json'));
assert.equal(digest(finalBytes), terminal.terminal.receipt.sha256);
const final = JSON.parse(finalBytes);
assert.equal(final.complete, true);
assert.equal(final.unsafeStop, false);
assert.equal(final.eligibleAcceptance, true);
assert.equal(final.accounting.active, 0);
assert.equal(final.accounting.halted, false);
assert.deepEqual(final.accounting.faults, []);
assert.deepEqual(final.accounting.failures, []);
assert.equal(final.accounting.children.length, 22);
assert.ok(final.accounting.children.every(child => child.retired && child.closeObserved && child.groupAbsent && child.supervisorSettled));
const expectedRecords = final.accounting.records.map(entry => ({ ...entry, name: `${entry.name}.json`, mode: 0o644 }));
expectedRecords.push({ name: 'FINAL.json', mode: 0o644, bytes: finalBytes.length, sha256: digest(finalBytes) });
assert.deepEqual(fs.readdirSync(records).sort(), expectedRecords.map(entry => entry.name).sort());
for (const entry of expectedRecords) {
  assert.match(entry.name, /^[A-Za-z0-9_-]+\.json$/u);
  const filename = path.join(records, entry.name), bytes = read(filename);
  assert.equal(bytes.length, entry.bytes);
  assert.equal(digest(bytes), entry.sha256);
  assert.equal(fs.lstatSync(filename).mode & 0o777, entry.mode);
}
const children = final.accounting.children.map(child => {
  assert.equal(digest(read(child.receipt.path)), child.receipt.sha256);
  return json(child.receipt.path);
});
assert.equal(children.reduce((sum, child) => sum + child.bytes, 0), final.accounting.captured);
assert.ok(children.every(child => child.role === 'product' && child.closeObserved && child.groupAbsent && !child.signal && !child.fault && !child.spawnError));
const scope = json(path.resolve(continuation, '../SCOPE-BINDING-v2.json'));
const sealBytes = read(path.join(continuation, 'SEAL.json'));
assert.equal(digest(sealBytes), final.sealHash);
const seal = JSON.parse(sealBytes);
assert.equal(final.candidate, scope.product);
assert.equal(final.composition, scope.selectedComposition);
assert.equal(final.packageSha256, scope.package.sha256);
assert.equal(digest(read(path.join(here, 'grant.json'))), final.grantHash);
for (const role of seal.roles) {
  const filename = path.join(own, role.path), bytes = read(filename);
  assert.equal(bytes.length, role.bytes);
  assert.equal(digest(bytes), role.sha256);
  assert.equal(fs.lstatSync(filename).mode & 0o777, role.mode);
}
const toolStat = fs.lstatSync(scope.tools.node.path);
assert.ok(toolStat.isFile() && !toolStat.isSymbolicLink());
assert.equal(fs.realpathSync(scope.tools.node.path), scope.tools.node.path);
assert.equal(toolStat.size, 112989184);
const toolHash = createHash('sha256');
let toolBytes = 0;
for await (const toolChunk of fs.createReadStream(scope.tools.node.path, { highWaterMark: 65536 })) {
  toolBytes += toolChunk.length;
  assert.ok(toolBytes <= toolStat.size);
  toolHash.update(toolChunk);
}
assert.equal(toolBytes, toolStat.size);
assert.equal(toolHash.digest('hex'), scope.tools.node.sha256);
assert.ok(children.every(child => child.executable === scope.tools.node.path));
for (const entry of scope.selectedSource) {
  assert.notEqual(path.basename(entry.path), 'AGENTS.md');
  const filename = path.join(work, 'source', entry.path), bytes = read(filename);
  assert.equal(digest(bytes), entry.sha256);
  assert.equal(bytes.length, entry.bytes);
  assert.equal(fs.lstatSync(filename).mode & 0o777, parseInt(entry.mode, 8) & 0o777);
}
assert.equal(digest(read(path.join(work, 'artifacts/original.tgz'))), scope.package.sha256);
function census(root) {
  assert.equal(fs.realpathSync(root), root);
  const entries = {};
  let count = 0;
  function visit(directory, depth) {
    assert.ok(depth <= 32);
    for (const name of fs.readdirSync(directory).sort()) {
      assert.ok(++count <= 20000);
      assert.notEqual(name, 'AGENTS.md');
      const filename = path.join(directory, name), stat = fs.lstatSync(filename), relative = path.relative(root, filename);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) { entries[relative + '/'] = { directory: true, mode: stat.mode & 0o777 }; visit(filename, depth + 1); }
      else entries[relative] = { mode: stat.mode & 0o777, bytes: stat.size, sha256: digest(read(filename)) };
    }
  }
  visit(root, 0);
  return entries;
}
const storage = final.finalCensuses.map(tree => {
  assert.ok(tree.root.startsWith(work + '/'));
  const actual = census(tree.root);
  assert.deepEqual(actual, tree.entries);
  return { role: path.basename(tree.root), entries: Object.keys(actual).length, bytes: Object.values(actual).reduce((sum, entry) => sum + (entry.bytes ?? 0), 0) };
});
assert.equal(fs.existsSync(path.join(work, 'apps/installed-reused-app')), false);
const bodies = final.phases.map(phase => {
  assert.equal(digest(read(phase.receipt.path)), phase.receipt.sha256);
  const body = json(phase.receipt.path), verdict = body.verdict;
  assert.equal(verdict.coherent, true);
  return { record: path.basename(phase.receipt.path), job: body.job, coherent: verdict.coherent, accepted: verdict.accepted, mutantKilled: verdict.mutantKilled, phaseSpecificity: verdict.phaseSpecificity, failed: verdict.failed, loadCount: verdict.loads.length, loads: verdict.loads, activations: verdict.activations, observations: verdict.observations };
});
assert.equal(bodies.length, 22);
const mutants = bodies.filter(body => body.job.label.startsWith('U'));
assert.deepEqual(mutants.map(body => body.job.label), ['U08', 'U09', 'U11', 'U12', 'U13-S06']);
assert.ok(mutants.every(body => body.mutantKilled && body.activations.length === 1 && body.activations[0].hits > 0));
const normal = bodies.filter(body => !body.job.label.startsWith('U'));
assert.ok(normal.every(body => body.accepted && body.observations.every(row => row.pass)));
const observations = bodies.flatMap(body => body.observations);
assert.equal(observations.length, 52);
const layouts = ['source-build', 'installed', 'moved'];
const admissions = layouts.map(layout => ({ layout, rows: json(path.join(records, `admission-${layout}.json`)) }));
assert.ok(admissions.every(group => group.rows.length === 8 && group.rows.every(row => row.refused)));
const priorTypes = layouts.map(layout => {
  const filename = path.join(work, 'prior', `types-${layout}.json`), bytes = read(filename), prior = JSON.parse(bytes);
  assert.equal(prior.candidate, scope.product);
  assert.equal(prior.packageSha256, scope.package.sha256);
  assert.equal(prior.results.length, 10);
  assert.ok(prior.results.every(row => row.accepted));
  return { layout, sha256: digest(bytes), bytes: bytes.length, cases: prior.results.length, qualification: 'Prior actual v5 receipt reused unchanged; zero new compiler executions' };
});
const oldRelease = path.resolve(continuation, '../preparation-v5/release-ARRAY-S06-20260828-02');
for (const [name, expected] of [['RECORDS.jsonl.gz', seal.archiveHash], ['CAPTURE-INDEX.json', seal.indexHash]]) assert.equal(digest(read(path.join(oldRelease, name))), expected);
assert.deepEqual(fs.readdirSync(path.resolve(continuation, '../preparation-v5/RUN-ARRAY-S06-20260828-02/records')), []);
const archive = path.join(here, 'RECORDS.jsonl.gz');
async function* encoded() {
  for (const entry of expectedRecords) yield JSON.stringify({ ...entry, base64: read(path.join(records, entry.name)).toString('base64') }) + '\n';
}
await pipeline(Readable.from(encoded()), createGzip({ level: 9 }), fs.createWriteStream(archive, { flags: 'wx', mode: 0o644 }));
let recovered = 0, expanded = 0;
const input = fs.createReadStream(archive).pipe(createGunzip());
input.on('data', bytes => { expanded += bytes.length; if (expanded > 64 * 1024 * 1024) input.destroy(new Error('evidence decoding bound')); });
try {
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    assert.ok(recovered < expectedRecords.length);
    const entry = JSON.parse(line), expected = expectedRecords[recovered++], bytes = Buffer.from(entry.base64, 'base64');
    const { base64, ...metadata } = entry;
    assert.deepEqual(metadata, expected);
    assert.equal(bytes.length, expected.bytes);
    assert.equal(digest(bytes), expected.sha256);
    assert.deepEqual(bytes, read(path.join(records, entry.name)));
  }
} finally { input.destroy(); }
assert.equal(recovered, expectedRecords.length);
const recordBytes = expectedRecords.reduce((sum, entry) => sum + entry.bytes, 0);
const archiveMetadata = { name: 'RECORDS.jsonl.gz', bytes: fs.statSync(archive).size, sha256: digest(read(archive)) };
put('CAPTURE-INDEX.json', { format: 'Lossless gzip JSONL: exact raw record base64/name/mode/bytes/SHA256; no product imports on decode', archive: archiveMetadata, rawRecordBytes: recordBytes, verifiedRoundTrips: recovered, records: expectedRecords });
put('ACTUAL-AUDIT.json', {
  qualification: 'Post-run DATA/hash/census audit only. No candidate replay, new compiler, build, install, native execution, or old-result rescore.',
  candidate: final.candidate, composition: final.composition, packageSha256: final.packageSha256, sealHash: final.sealHash, grantHash: final.grantHash,
  finalSha256: digest(finalBytes), coordinatorExitCode: terminal.coordinatorExitCode, affectedTailAccepted: final.eligibleAcceptance, complete: final.complete, unsafeStop: final.unsafeStop,
  elapsedBeforeAnnouncementMs: terminal.terminal.elapsedBeforeAnnouncementMs,
  children: { total: children.length, product: children.length, retired: final.accounting.children.filter(child => child.retired).length, activeAtFinal: final.accounting.active, codes: children.map(child => child.code), firstStarted: children[0].started, lastFinished: children.at(-1).finished },
  childCapturedBytes: final.accounting.captured, recordBytes, storage, retainedRunBytes: recordBytes + storage.reduce((sum, role) => sum + role.bytes, 0),
  sourceInputsRechecked: scope.selectedSource.length, sealedRolesRechecked: seal.roles.length, originalArchiveAndIndexUnchanged: true,
  totalObservations: observations.length, unchangedCandidateObservations: normal.flatMap(body => body.observations).length, mutantObservations: mutants.flatMap(body => body.observations).length,
  loadedMutants: mutants.length, activatedMutants: mutants.length, killedMutants: mutants.length,
  loadEvents: bodies.reduce((sum, body) => sum + body.loadCount, 0), admissions, priorTypes, bodies, archive: archiveMetadata,
  preserved: '14179c5e HOLD and original10 loaded/9 activated/8 kill outcomes remain immutable. M21 SOURCE ONLY; M03/M07/M14/M15/M20 mixed. This tail is not whole-array acceptance.'
});
console.log(JSON.stringify({ recovered, recordBytes, archive: archiveMetadata, children: children.length, observations: observations.length, loaded: mutants.length, activated: mutants.length, killed: mutants.length, loadEvents: bodies.reduce((sum, body) => sum + body.loadCount, 0), storage }));
