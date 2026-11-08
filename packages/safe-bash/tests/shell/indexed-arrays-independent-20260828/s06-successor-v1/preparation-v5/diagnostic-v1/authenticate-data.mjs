import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const here = path.dirname(fileURLToPath(import.meta.url));
const preparation = path.dirname(here);
const own = path.resolve(preparation, '../..');
const release = path.join(preparation, 'release-ARRAY-S06-20260828-02');
const work = path.join(preparation, 'RUN-ARRAY-S06-20260828-02');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = filename => { assert.ok(fs.lstatSync(filename).isFile()); return fs.readFileSync(filename); };
const json = filename => JSON.parse(read(filename));
const bound = (filename, sha256) => { const bytes = read(filename); assert.equal(hash(bytes), sha256); return bytes; };
const index = JSON.parse(bound(path.join(release, 'CAPTURE-INDEX.json'), 'f7976df7cef3c0e747f0e998f1ee2b6dbaac7f2342f954fb6ab21f7364a8485e'));
bound(path.join(release, 'ACTUAL-AUDIT.json'), '22cadc1a3f146508e84f376320dcb926813af31483d29c0696b2696435668f10');
const archive = path.join(release, 'RECORDS.jsonl.gz');
bound(archive, '3dbb6dc3708156e0c895b04aacf78f508322b6b08336acff78a6aa53cd707a0c');
const records = path.join(work, 'records');
assert.deepEqual(fs.readdirSync(records).sort(), index.records.map(row => row.name).sort());
const decompressed = fs.createReadStream(archive).pipe(createGunzip());
let decodedBytes = 0, count = 0, rawBytes = 0;
decompressed.on('data', chunk => { decodedBytes += chunk.length; if (decodedBytes > 192 * 1024 * 1024) decompressed.destroy(new Error('DATA decoding bound')); });
for await (const line of createInterface({ input: decompressed, crlfDelay: Infinity })) {
  assert.ok(count < 437 && line.length <= 32 * 1024 * 1024);
  const row = JSON.parse(line), expected = index.records[count++];
  assert.equal(row.name, expected.name);
  const raw = Buffer.from(row.base64, 'base64');
  assert.equal(raw.length, expected.bytes); assert.equal(row.bytes, expected.bytes);
  assert.equal(hash(raw), expected.sha256); assert.equal(row.sha256, expected.sha256);
  const filename = path.join(records, row.name);
  assert.deepEqual(raw, read(filename)); assert.equal(fs.lstatSync(filename).mode & 0o777, row.mode);
  rawBytes += raw.length;
}
assert.equal(count, 437); assert.equal(rawBytes, 116980358);
const final = JSON.parse(bound(path.join(records, 'FINAL.json'), 'ada95ca1c33a02b198261642143e57352744300fce46fe8b7817226bc7982215'));
assert.deepEqual(fs.readdirSync(work).sort(), ['apps','artifacts','build','records','scratch','source','tools']);
function census(root) {
  const result = {}; let members = 0;
  assert.equal(fs.realpathSync(root), root);
  function visit(directory, depth) {
    assert.ok(depth <= 32);
    for (const name of fs.readdirSync(directory).sort()) {
      assert.ok(++members <= 20000); assert.notEqual(name, 'AGENTS.md');
      const filename = path.join(directory, name), stat = fs.lstatSync(filename), relative = path.relative(root, filename);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) { result[relative + '/'] = { directory: true, mode: stat.mode & 0o777 }; visit(filename, depth + 1); }
      else { assert.ok(stat.isFile()); result[relative] = { mode: stat.mode & 0o777, bytes: stat.size, sha256: hash(read(filename)) }; }
    }
  }
  visit(root, 0); return result;
}
const storage = [];
for (const tree of final.finalCensuses) {
  assert.equal(path.dirname(tree.root), work);
  const actual = census(tree.root); assert.deepEqual(actual, tree.entries);
  const entries = Object.values(actual);
  storage.push({ root: tree.root, directoryMode: fs.lstatSync(tree.root).mode & 0o777, files: entries.filter(row => !row.directory).length, directories: entries.filter(row => row.directory).length, bytes: entries.reduce((sum, row) => sum + (row.bytes ?? 0), 0), censusSha256: hash(Buffer.from(JSON.stringify(actual))), unknownOrChangedMembers: 0 });
}
storage.push({ root: records, directoryMode: fs.lstatSync(records).mode & 0o777, files: count, directories: 0, bytes: rawBytes, censusBinding: '437 archive entries; exact name/bytes/mode/hash equality', unknownOrChangedMembers: 0 });
const seal = JSON.parse(bound(path.join(preparation, 'SEAL.json'), '77a629c48547d75e791a5def6a0ac83bf3618d0861c7f3f6c9e5f0fb18cb2ae7'));
for (const role of seal.roles) {
  const filename = path.join(own, role.path), bytes = bound(filename, role.sha256);
  assert.equal(bytes.length, role.bytes); assert.equal(fs.lstatSync(filename).mode & 0o777, role.mode);
}
const scope = JSON.parse(bound(path.resolve(preparation, '../SCOPE-BINDING-v2.json'), seal.scopeSha256));
for (const entry of scope.selectedSource) {
  const filename = path.join(work, 'source', entry.path), bytes = bound(filename, entry.sha256);
  assert.equal(bytes.length, entry.bytes); assert.equal(fs.lstatSync(filename).mode & 0o777, parseInt(entry.mode, 8) & 0o777);
}
const layouts = [['source-build',6,7],['installed',13,14],['moved',20,21]].map(([layout, mechanical, operations]) => ({
  layout,
  rows: [mechanical, operations].flatMap(number => {
    const body = json(path.join(records, `body-${number}.json`));
    return body.verdict.observations.filter(row => ['M22','P04','P09','P10'].includes(row.id)).map(row => ({ ...row, rawRecord: `body-${number}.json`, note: 'settled/disposed are generic worker booleans; no unrecorded numeric cleanup count or primary reason inferred' }));
  }),
}));
const mutantDefinitions = json(path.resolve(preparation, '../preparation-v3/MUTANTS.json')).declarations;
const mutants = mutantDefinitions.map(definition => {
  const bodyFile = index.records.find(row => /^body-/.test(row.name) && json(path.join(records, row.name)).job.label === definition.id);
  const body = bodyFile ? json(path.join(records, bodyFile.name)) : undefined;
  return { id: definition.id, member: definition.member, originalSha256: definition.originalSha256, changedSha256: definition.changedSha256, requiredFailed: definition.requiredFailed, requiredPassed: definition.requiredPassed,
    actualLoaded: body?.verdict.loads.some(row => row.sha256 === definition.changedSha256) ?? false,
    activations: body?.verdict.activations ?? [], failed: body?.verdict.failed ?? [],
    observations: body?.verdict.observations.map(row => ({ id: row.id, pass: row.pass })) ?? [],
    qualifiedPredicate: body?.verdict.mutantKilled ?? false,
    disposition: body ? body.verdict.errors : final.phases.find(phase => phase.label === definition.id)?.blocked ?? 'not dispatched after guard stop' };
});
assert.equal(mutants.filter(row => row.actualLoaded).length, 10);
assert.equal(mutants.filter(row => row.activations.length).length, 9);
assert.equal(mutants.filter(row => row.qualifiedPredicate).length, 8);
const inspected = ['src/shell/runtime.ts','src/shell/shell.ts','src/shell/cleanup.ts','src/shell/arrays/state.ts','src/shell/arrays/ledger.ts','src/shell/arrays/bindings.ts','src/contracts/command.md'].map(name => scope.selectedSource.find(row => row.path === name));
assert.ok(inspected.every(Boolean));
const output = { classification: 'SOURCE/DATA authentication only; zero candidate/native/product execution and zero cleanup deletion', evidenceCommit: '14179c5eae195757ed5e83fe31a51971597700b6', archiveSha256: index.archive.sha256, archiveRecords: count, archiveRawBytes: rawBytes, decodedContainerBytes: decodedBytes, sealedRoles: seal.roles.length, selectedInputs: scope.selectedSource.length, rawRoot: work, rawRootMode: fs.lstatSync(work).mode & 0o777, totalRawBytes: storage.reduce((sum, row) => sum + row.bytes, 0), storage, inspected, layouts, mutants, terminal: { children: final.accounting.children.length, retired: final.accounting.children.filter(row => row.retired).length, active: final.accounting.active, faults: final.accounting.faults }, baselineMutationCountNotRescored: true };
fs.writeFileSync(path.join(here, 'DATA-AUTHENTICATION.json'), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ archiveRecords: count, rawBytes, ownedRawBytes: output.totalRawBytes, sourceInputs: scope.selectedSource.length, sealedRoles: seal.roles.length, loaded: 10, activated: 9, predicates: 8, newCandidateRuns: 0, removedFiles: 0 }));
