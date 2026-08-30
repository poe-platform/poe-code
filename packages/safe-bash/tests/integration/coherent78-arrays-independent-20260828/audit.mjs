import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { census, inventory, put, regular, sha, verify } from './common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../../..');
const work = path.join(here, 'RUN-COHERENT78-ARRAYS-20260828-01');
const evidence = path.join(here, 'evidence-v1');
const parse = filename => JSON.parse(regular(filename));
const sealBytes = regular(path.join(here, 'SEAL.json'));
assert.equal(sha(sealBytes), 'c9ad1b06247602063001f2b87f8e42d28751d3aaf47c606b718fb5d799cd38db');
const seal = JSON.parse(sealBytes);
const auth = parse(path.join(here, 'AUTHENTICATION.json'));
for (const role of seal.roles) {
  const filename = path.join(repository, role.path);
  const bytes = regular(filename);
  assert.equal(bytes.length, role.bytes);
  assert.equal(fs.lstatSync(filename).mode & 0o777, role.mode);
  assert.equal(sha(bytes), role.sha256);
}
assert.equal(sha(regular(auth.node.origin)), auth.node.sha256);
verify({ root: auth.sourceRoot, entries: auth.sourceCensus });
for (const tool of Object.values(auth.tools)) verify(tool);
const finalBytes = regular(path.join(work, 'records/FINAL.json'));
const final = JSON.parse(finalBytes);
const terminal = parse(path.join(evidence, 'TERMINAL.json'));
const announcement = JSON.parse(terminal.stdout);
assert.equal(announcement.receipt.sha256, sha(finalBytes));
assert.equal(announcement.receipt.path, path.join(work, 'records/FINAL.json'));
assert.equal(terminal.exitCode, announcement.unsafeStop ? 78 : announcement.accepted ? 0 : 1);
assert.equal(announcement.childrenRetired, true);
assert.equal(announcement.unsafeStop, false);
assert.equal(final.complete, true);
assert.equal(final.unsafeStop, false);
assert.equal(final.accounting.active, 0);
assert.equal(final.accounting.halted, false);
assert.deepEqual(final.accounting.faults, []);
assert.ok(announcement.elapsedBeforeAnnouncementMs < seal.policy.totalElapsedMsIncludingCleanup);
assert.equal(final.accounting.children.length, seal.expectedChildren);
assert.ok(final.accounting.children.every(child => child.retired && child.closeObserved && child.groupAbsent && child.supervisorSettled));
for (const tree of final.finalCensuses) verify(tree);
for (const input of auth.selectedSource) {
  const filename = path.join(work, 'source', input.path);
  const bytes = regular(filename);
  assert.equal(bytes.length, input.bytes);
  assert.equal(sha(bytes), input.sha256);
  assert.equal(fs.lstatSync(filename).mode & 0o777, parseInt(input.mode, 8) & 0o777);
}
const artifactEntries = census(path.join(work, 'artifacts'));
const actualTar = Object.keys(artifactEntries).filter(name => name.endsWith('.tgz'));
assert.equal(actualTar.length, 1);
const packageFiles = [path.join(here, 'PREPARED/candidate.tgz'), path.join(work, 'artifacts', actualTar[0])];
for (const filename of packageFiles) {
  const bytes = regular(filename);
  assert.equal(bytes.length, auth.packageBytes);
  assert.equal(sha(bytes), seal.packageSha256);
  assert.deepEqual(inventory(bytes), auth.packageEntries);
}
const recordRoot = path.join(work, 'records');
const before = census(recordRoot);
const rows = Object.entries(before);
assert.ok(rows.length <= 200);
assert.ok(rows.every(([name, row]) => !row.directory && /^[A-Za-z0-9_-]+\.json$/u.test(name)));
const recordBytes = rows.reduce((total, [, row]) => total + row.bytes, 0);
assert.ok(recordBytes <= seal.policy.maxPersistedEvidenceBytes);
for (const receipt of final.accounting.records) {
  assert.equal(before[receipt.name + '.json'].bytes, receipt.bytes);
  assert.equal(before[receipt.name + '.json'].sha256, receipt.sha256);
}
assert.equal(final.accounting.records.length + 1, rows.length);
const records = new Map(rows.map(([name]) => [name, parse(path.join(recordRoot, name))]));
const bodies = [...records].filter(([name]) => name.startsWith('body-')).map(([, value]) => value);
const children = [...records].filter(([name]) => name.startsWith('child-')).map(([, value]) => value);
assert.equal(children.length, final.accounting.children.length);
assert.ok(children.every(child => child.executable === auth.node.origin && child.fault === null && child.closeObserved && child.groupAbsent));
const summary = {
  kind: 'post-run SOURCE/DATA audit and lossless archive, no candidate execution',
  presealCommit: '1193d9c4ef8690c1433a579e301a41a8cbf3ee96',
  sealSha256: sha(sealBytes),
  candidate: seal.candidate,
  base: seal.base,
  array: seal.array,
  sourceInputs: auth.selectedSource.length,
  package: { sha256: seal.packageSha256, bytes: auth.packageBytes, members: Object.keys(auth.packageEntries).length, added: auth.added, changed: auth.changed, removed: auth.removed },
  terminal,
  layouts: {},
  guards: bodies.filter(body => body.negative).map(body => ({ label: body.label, refused: body.refused })),
  mutations: bodies.filter(body => body.activation).map(body => ({ label: body.label, accepted: body.accepted, activation: body.activation, observations: body.observations.map(row => ({ id: row.id, pass: row.pass })) })),
  restored: bodies.filter(body => body.label.endsWith('-restored')).map(body => ({ label: body.label, accepted: body.accepted, summary: body.summary })),
  declarationBindings: {},
  loadWitnesses: bodies.reduce((total, body) => total + (body.loads?.length ?? 0), 0),
  failures: final.accounting.failures,
  resources: { elapsedBeforeAnnouncementMs: announcement.elapsedBeforeAnnouncementMs, children: children.length, childCapturedBytes: children.reduce((total, child) => total + child.bytes, 0), childRoles: {}, recordBytes, records: rows.length, preparedBytes: seal.preparedBytes, retainedWorkingBytes: 0, allChildrenRetired: true },
  finalCensusRoots: final.finalCensuses.map(tree => ({ root: tree.root, entries: Object.keys(tree.entries).length })),
  archive: []
};
for (const child of children) summary.resources.childRoles[child.role] = (summary.resources.childRoles[child.role] ?? 0) + 1;
assert.equal(summary.resources.childCapturedBytes, final.accounting.captured);
for (const layout of ['source-build', 'installed', 'moved']) {
  const selected = bodies.filter(body => body.label.startsWith(layout + '-'));
  const typeRows = [...records].filter(([name]) => name.startsWith('types-' + layout + '-')).map(([, value]) => value);
  summary.layouts[layout] = {
    runtime: selected.map(body => ({ label: body.label, accepted: body.accepted, summary: body.summary, failures: body.observations.filter(row => !row.pass).map(row => ({ id: row.id, error: row.error, actual: row.actual })) })),
    types: typeRows.map(row => ({ group: row.group, cases: row.cases, accepted: row.accepted, code: row.code, errors: row.errors }))
  };
  summary.declarationBindings[layout] = [...new Set(typeRows.flatMap(row => row.declarations))].sort();
}
for (const [name, row] of rows) {
  const bytes = regular(path.join(recordRoot, name));
  const compressed = gzipSync(bytes, { level: 9 });
  const destination = path.join(evidence, 'records', name + '.gz');
  put(destination, compressed);
  const decoded = gunzipSync(regular(destination), { maxOutputLength: seal.policy.maxRecordBytes });
  assert.deepEqual(decoded, bytes);
  summary.archive.push({ path: name, ...row, archive: 'records/' + name + '.gz', compressedBytes: compressed.length, compressedSha256: sha(compressed) });
}
assert.deepEqual(census(recordRoot), before);
for (const tree of final.finalCensuses) verify(tree);
const retained = census(work);
summary.resources.retainedWorkingBytes = Object.values(retained).reduce((total, row) => total + (row.bytes ?? 0), 0);
summary.resources.retainedIncludingPreparedBytes = summary.resources.retainedWorkingBytes + seal.preparedBytes;
assert.ok(summary.resources.retainedIncludingPreparedBytes <= 512 * 1024 * 1024);
summary.archiveRoundTrip = { files: rows.length, bytes: recordBytes, rawRetained: true, deletion: false, censusBeforeAfterEqual: true };
put(path.join(evidence, 'AUDIT.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ verdict: announcement.accepted ? 'accepted' : 'HOLD', candidate: seal.candidate, children: children.length, records: rows.length, bytes: recordBytes, failures: summary.failures, mutations: summary.mutations.map(row => ({ label: row.label, accepted: row.accepted })), rawRetained: true }));
