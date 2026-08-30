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
const preparation = path.dirname(here);
const own = path.resolve(preparation, '../..');
const work = path.join(preparation, 'RUN-ARRAY-S06-20260828-02');
const records = path.join(work, 'records');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const read = filename => {
  assert.ok(fs.lstatSync(filename).isFile(), 'regular evidence only');
  return fs.readFileSync(filename);
};
const json = filename => JSON.parse(read(filename));
const put = (name, value) => fs.writeFileSync(path.join(here, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const finalBytes = read(path.join(records, 'FINAL.json'));
assert.equal(digest(finalBytes), 'ada95ca1c33a02b198261642143e57352744300fce46fe8b7817226bc7982215');
const final = JSON.parse(finalBytes);
assert.equal(final.unsafeStop, true);
assert.equal(final.complete, false);
assert.equal(final.accounting.active, 0);
assert.equal(final.accounting.children.length, 349);
assert.ok(final.accounting.children.every(child => child.retired && child.closeObserved && child.groupAbsent && child.supervisorSettled));
const expectedRecords = final.accounting.records.map(entry => ({ ...entry, name: `${entry.name}.json` }));
expectedRecords.push({ name: 'FINAL.json', bytes: finalBytes.length, sha256: digest(finalBytes) });
assert.deepEqual(fs.readdirSync(records).sort(), expectedRecords.map(entry => entry.name).sort());
for (const entry of expectedRecords) {
  const bytes = read(path.join(records, entry.name));
  assert.equal(bytes.length, entry.bytes);
  assert.equal(digest(bytes), entry.sha256);
}
for (const child of final.accounting.children) assert.equal(digest(read(child.receipt.path)), child.receipt.sha256);
const children = final.accounting.children.map(child => json(child.receipt.path));
assert.equal(children.reduce((total, child) => total + child.bytes, 0), final.accounting.captured);
const source = json(path.resolve(preparation, '../SCOPE-BINDING-v2.json'));
const sealBytes = read(path.join(preparation, 'SEAL.json'));
assert.equal(digest(sealBytes), final.sealHash);
const seal = JSON.parse(sealBytes);
for (const role of seal.roles) {
  const filename = path.join(own, role.path);
  const bytes = read(filename);
  assert.equal(bytes.length, role.bytes);
  assert.equal(digest(bytes), role.sha256);
  assert.equal(fs.lstatSync(filename).mode & 0o777, role.mode);
}
for (const tool of [source.tools.node, seal.git]) assert.equal(digest(read(tool.path)), tool.sha256);
assert.equal(digest(read(path.join(here, 'grant.json'))), final.goHash);
for (const entry of source.selectedSource) {
  assert.notEqual(path.basename(entry.path), 'AGENTS.md');
  const filename = path.join(work, 'source', entry.path);
  assert.equal(digest(read(filename)), entry.sha256);
  assert.equal(fs.lstatSync(filename).size, entry.bytes);
  assert.equal(fs.lstatSync(filename).mode & 0o777, parseInt(entry.mode, 8) & 0o777);
}
assert.equal(digest(read(path.join(work, 'artifacts/virtual-bash-0.0.0.tgz'))), source.package.sha256);
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
      if (stat.isDirectory()) {
        entries[relative + '/'] = { directory: true, mode: stat.mode & 0o777 };
        visit(filename, depth + 1);
      } else {
        assert.ok(stat.isFile());
        entries[relative] = { mode: stat.mode & 0o777, bytes: stat.size, sha256: digest(read(filename)) };
      }
    }
  }
  visit(root, 0);
  return entries;
}
const storage = [];
for (const tree of final.finalCensuses) {
  assert.ok(tree.root.startsWith(work + '/'));
  const actual = census(tree.root);
  assert.deepEqual(actual, tree.entries);
  storage.push({ role: path.basename(tree.root), entries: Object.keys(actual).length, bytes: Object.values(actual).reduce((sum, entry) => sum + (entry.bytes ?? 0), 0) });
}
const bodies = expectedRecords.filter(entry => /^body-/.test(entry.name)).map(entry => {
  const body = json(path.join(records, entry.name)), verdict = body.verdict;
  return { record: entry.name, job: body.job, coherent: verdict.coherent, accepted: verdict.accepted, mutantKilled: verdict.mutantKilled, errors: verdict.errors, failed: verdict.failed, loads: verdict.loads, activations: verdict.activations, observations: verdict.observations.map(row => ({ id: row.id, pass: row.pass, category: row.category, ...(row.pass ? {} : { detail: row.detail }) })) };
});
const types = ['source-build', 'installed', 'moved'].map(layout => {
  const result = json(path.join(records, `types-${layout}.json`));
  return { layout, accepted: result.accepted, publicDeclarations: result.publicDeclarations, unapprovedAstChanges: result.unapprovedAstChanges, results: result.results.map(row => ({ id: row.id, accepted: row.accepted, code: row.run.code, pid: row.run.pid })) };
});
const archive = path.join(here, 'RECORDS.jsonl.gz');
async function* encoded() {
  for (const entry of expectedRecords) {
    const filename = path.join(records, entry.name), bytes = read(filename);
    yield JSON.stringify({ name: entry.name, mode: fs.lstatSync(filename).mode & 0o777, bytes: bytes.length, sha256: digest(bytes), base64: bytes.toString('base64') }) + '\n';
  }
}
await pipeline(Readable.from(encoded()), createGzip({ level: 9 }), fs.createWriteStream(archive, { flags: 'wx' }));
let recovered = 0;
const input = fs.createReadStream(archive).pipe(createGunzip());
for await (const line of createInterface({ input, crlfDelay: Infinity })) {
  const entry = JSON.parse(line), expected = expectedRecords[recovered++], bytes = Buffer.from(entry.base64, 'base64');
  assert.equal(entry.name, expected.name);
  assert.equal(entry.bytes, expected.bytes);
  assert.equal(digest(bytes), expected.sha256);
  assert.deepEqual(bytes, read(path.join(records, entry.name)));
  assert.equal(entry.mode, fs.lstatSync(path.join(records, entry.name)).mode & 0o777);
}
assert.equal(recovered, expectedRecords.length);
const recordBytes = expectedRecords.reduce((sum, entry) => sum + entry.bytes, 0);
put('CAPTURE-INDEX.json', { format: 'gzip of JSON lines; each line contains exact raw record base64, relative name, mode, byte length and SHA256; no product execution on decode', archive: { name: 'RECORDS.jsonl.gz', bytes: fs.statSync(archive).size, sha256: digest(read(archive)) }, rawRecordBytes: recordBytes, verifiedRoundTrips: recovered, records: expectedRecords });
put('ACTUAL-AUDIT.json', {
  qualification: 'post-run read/hash/census/capture audit only; no candidate replay or rescoring',
  finalSha256: digest(finalBytes), candidate: final.candidate, composition: final.composition, packageSha256: final.packageSha256,
  sourceInputsRechecked: source.selectedSource.length, sealedRolesRechecked: seal.roles.length, appendAwareCensusesRechecked: storage,
  totalRetainedRunBytes: recordBytes + storage.reduce((sum, role) => sum + role.bytes, 0),
  coordinatorExitCode: 78, accepted: false, unsafeStop: final.unsafeStop, complete: final.complete, error: final.error,
  children: { total: children.length, roles: Object.fromEntries(['git','tool','type','product'].map(role => [role, children.filter(child => child.role === role).length])), retired: final.accounting.children.filter(child => child.retired).length, activeAtFinal: final.accounting.active },
  capturedBytes: final.accounting.captured, gitCapturedBytes: final.accounting.gitBytes, elapsedBeforeFinalRecordMs: final.accounting.elapsedMs,
  phases: final.phases, types, bodies,
  qualificationCorrection: 'The preserved FINAL limitations include an inherited preparation-only zero-execution sentence. It is stale for this ACTUAL run; raw bytes are unchanged. This audit reports actual counts without altering that historical input.',
});
console.log(JSON.stringify({ recovered, recordBytes, archiveBytes: fs.statSync(archive).size, archiveSha256: digest(read(archive)), childRoles: Object.fromEntries(['git','tool','type','product'].map(role => [role, children.filter(child => child.role === role).length])), storage }));
