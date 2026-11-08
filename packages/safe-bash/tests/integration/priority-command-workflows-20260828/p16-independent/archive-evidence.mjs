import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { regular, put, sha, census } from './common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const seal = JSON.parse(regular(path.join(here, 'SEAL.json')));
const continuation = JSON.parse(regular(path.join(here, 'CONTINUATION-SEAL.json')));
const author = path.join(repo, seal.author);
const beforeAuthor = census(author);
assert.equal(author, seal.protectedAuthor.root);
assert.deepEqual(beforeAuthor, seal.protectedAuthor.entries);
const sources = ['RUN-P16-INDEPENDENT-01', 'RUN-P16-DATA-CONTINUATION-01'];
const entries = [];
for (const name of sources) {
  for (const [relative, row] of Object.entries(census(path.join(here, name)))) {
    const selectedPath = name + '/' + relative;
    entries.push(row.directory ? { path: selectedPath, ...row } : { path: selectedPath, ...row, base64: regular(path.join(here, selectedPath)).toString('base64') });
  }
}
for (const name of ['OUTER.stdout', 'OUTER.stderr', 'CONTINUATION-OUTER.stdout', 'CONTINUATION-OUTER.stderr']) {
  const bytes = regular(path.join(here, name));
  entries.push({ path: name, bytes: bytes.length, sha256: sha(bytes), mode: fs.lstatSync(path.join(here, name)).mode & 0o777, base64: bytes.toString('base64') });
}
const files = entries.filter(row => !row.directory);
assert.ok(files.length <= 100);
assert.ok(files.reduce((total, row) => total + row.bytes, 0) < 32 * 1024 * 1024);
for (const row of entries) assert.ok(!row.path.split('/').includes('AGENTS.md'));
const payload = Buffer.from(JSON.stringify({ schema: 1, qualification: 'unchanged raw evidence; no deletion/rescore; original exit78 and continuation exit1', entries }) + '\n');
const compressed = gzipSync(payload, { level: 9 });
assert.ok(payload.length < 64 * 1024 * 1024);
const roundtrip = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
assert.deepEqual(roundtrip, payload);
for (const row of JSON.parse(roundtrip).entries) {
  const filename = path.join(here, row.path);
  assert.equal(fs.lstatSync(filename).mode & 0o777, row.mode);
  if (row.directory) { assert.ok(fs.lstatSync(filename).isDirectory()); continue; }
  const bytes = Buffer.from(row.base64, 'base64');
  assert.equal(bytes.length, row.bytes);
  assert.equal(sha(bytes), row.sha256);
  assert.deepEqual(bytes, regular(filename));
}
assert.deepEqual(census(author), beforeAuthor);
const encoded = Buffer.from(compressed.toString('base64') + '\n');
put(path.join(here, 'RAW-EVIDENCE.json.gz.base64'), encoded);
const old = JSON.parse(regular(path.join(here, sources[0], 'records/FINAL.json')));
const next = JSON.parse(regular(path.join(here, sources[1], 'records/FINAL.json')));
assert.ok([...old.accounting.children, ...next.accounting.children].every(child => child.retired && child.closeObserved && child.groupAbsent && child.supervisorSettled));
const report = {
  schema: 1, writtenAt: new Date().toISOString(), archive: { path: 'RAW-EVIDENCE.json.gz.base64', bytes: encoded.length, sha256: sha(encoded), compressedSha256: sha(compressed), decodedBytes: payload.length, decodedSha256: sha(payload) },
  entries: entries.map(({ base64, ...row }) => row), files: files.length, directories: entries.length - files.length, rawBytes: files.reduce((total, row) => total + row.bytes, 0),
  rawDeleted: 0, authorCensusBeforeAfterIdentical: true, authorCensusSha256: sha(JSON.stringify(beforeAuthor)),
  preservedResults: [{ result: 'exit78; reviewer historical-document pin error', sha256: sha(regular(path.join(here, sources[0], 'records/FINAL.json'))) }, { result: 'exit1; DATA15/16; D13 reviewer source-location predicate', sha256: sha(regular(path.join(here, sources[1], 'records/FINAL.json'))) }],
  directSubjectChildren: 2, retiredSubjectChildren: 2, peakKnownSubjectChildren: 1, withTheirCoordinator: 2,
  capturedSubjectBytes: old.accounting.captured + next.accounting.captured,
  productImports: 0, reviewedSupervisorImports: 0, actualWorkerStarts: 0,
  roleNameQualification: 'generic controller role product/productWorkers means the one pure-helper OS process, NOT product imports or a Node Worker',
  resourceQualification: 'subject direct-child/group evidence only; no continuous census of transient descendants or agent inspection/publication tooling; no fully qualified all-owned-OS resource proof',
  originalAbsoluteDeadlineEpochMs: continuation.absoluteDeadlineEpochMs,
  publicationWithinOriginalWindow: Date.now() < continuation.absoluteDeadlineEpochMs,
};
put(path.join(here, 'ARCHIVE-RECEIPT.json'), Buffer.from(JSON.stringify(report, null, 2) + '\n'));
console.log(JSON.stringify({ ...report, entries: undefined }));
