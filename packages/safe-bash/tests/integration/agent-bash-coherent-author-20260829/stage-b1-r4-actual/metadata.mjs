import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const repository = '/Users/kjopek/Workspace/safe-bash';
const base = path.join(repository, 'tests/integration/agent-bash-coherent-author-20260829');
const scope = import.meta.dirname;
const bindingRoot = path.join(base, 'stage-b1-r4-final-binding');
const work = '/private/tmp/safe-bash-coherent-b1-public15-20260829-r4';
const packetIdentity = { bytes: 29531, sha256: '3da56afc93588c0bdfa016d02341ed4d0e8e22cd3441d0ecea3f97651b97ccc1' };
const hash = body => crypto.createHash('sha256').update(body).digest('hex');
let bytesRead = 0;
function read(filename, expected, maximum = 131072) {
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.ok(stat.size <= maximum);
  if (expected) assert.equal(stat.size, expected.bytes);
  const body = fs.readFileSync(filename); assert.equal(body.length, stat.size);
  if (expected) assert.equal(hash(body), expected.sha256);
  bytesRead += body.length; assert.ok(bytesRead <= 33554432);
  return body;
}
function save(filename, value) { const body = Buffer.from(JSON.stringify(value, null, 2) + '\n'); assert.ok(body.length < 1048576); fs.writeFileSync(filename, body, { flag: 'wx' }); return { path: filename, bytes: body.length, sha256: hash(body) }; }
const packet = JSON.parse(read(path.join(bindingRoot, 'FINAL-BINDING.json'), packetIdentity));
const command = process.argv[2];
if (command === 'authorize') {
  const startedUTC = '2026-08-29T15:08:17.066Z';
  assert.ok(Date.now() < Date.parse(packet.latestStartUTC)); assert.ok(Date.now() + 1800000 <= Date.parse(packet.expiresUTC));
  for (const entry of [...packet.runtimeFiles, ...packet.publisherFiles, ...packet.preimportFiles]) read(entry.path, entry, 4194304);
  for (const entry of [packet.runtimePreseal, packet.publisherBinding, packet.publisherPreseal]) read(entry.path, entry);
  read(packet.product.package.path, packet.product.package, 1048576);
  const node = packet.node; const stat = fs.lstatSync(node.path); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, node.bytes);
  const descriptor = fs.openSync(node.path, 'r'); const digest = crypto.createHash('sha256');
  try { const chunk = Buffer.alloc(65536); let offset = 0; while (offset < stat.size) { const count = fs.readSync(descriptor, chunk, 0, Math.min(chunk.length, stat.size - offset), offset); assert.ok(count > 0); digest.update(chunk.subarray(0, count)); offset += count; } assert.equal(fs.fstatSync(descriptor).size, stat.size); } finally { fs.closeSync(descriptor); }
  assert.equal(digest.digest('hex'), node.sha256);
  const records = read(path.join(scope, 'review-tree.z'), undefined, 65536).toString('utf8').split('\0');
  let review;
  for (let index = 0; index + 1 < records.length; index += 2) {
    const header = records[index].split(' '), relative = records[index + 1];
    if (!relative.endsWith('/RECEIPT.json')) continue;
    const filename = path.join(repository, relative); const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 6208) continue;
    const body = read(filename, { bytes: 6208, sha256: '242621c6c21d00b37516d9fcc19433b86ca11fb7672229422794ed10afb4f89f' });
    const blob = crypto.createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex'); assert.equal(blob, header[3]);
    review = { path: filename, bytes: body.length, sha256: hash(body), blob, commit: 'b087e5ce19424bff913d73f0dd68b56973e8d7d5' };
  }
  assert.ok(review);
  for (const filename of packet.absentSlots) assert.equal(fs.existsSync(filename), false);
  const grant = { action: 'ROOT_B1_PUBLIC15_ACTUAL', authorization: 'ROOT-2026-08-29-B1-R4-PUBLIC15-ONE-ATTEMPT-b087e5ce', finalPacketSha256: packetIdentity.sha256, startedUTC, latestStartUTC: packet.latestStartUTC, expiresUTC: packet.expiresUTC, metadataHome: path.join(work, 'home'), rootMessage: 'Fresh ROOT ACTUAL B1-R4 GO referencing final-slot b087e5ce19424bff913d73f0dd68b56973e8d7d5 and binding5d8a638bb2320c1071d28d9aab1c1ed85e6a142e; ONE attempt, no retry or permissions expansion.', review, bounds: packet.bounds, qualification: 'Known-role functional profile; 1800s includes authorization/publication, earlier deadline wins. Initial shell and two synchronous builtin command-substitution slots conservatively charged, not full kernel census. Old8PASS2FAIL5UNRUN/pub78 preserved.' };
  const identity = save(packet.slots.rootGrantFile, grant);
  save(path.join(scope, 'AUTHORIZATION-RECEIPT.json'), { identity, review, utc: new Date().toISOString(), pid: process.pid, node: packet.node, package: packet.product.package, checkedRuntimePins: packet.runtimeFiles.length, allSlotsAbsentBeforeGrant: true, startedUTC, deadlineUTC: new Date(Date.parse(startedUTC) + 1800000).toISOString() });
  console.log(JSON.stringify({ grant: identity, pid: process.pid, utc: new Date().toISOString(), deadlineUTC: new Date(Date.parse(startedUTC) + 1800000).toISOString() }));
} else if (command === 'outcome') {
  const paths = ['RESULT.json', 'STOP.json', 'capture/events.jsonl', 'capture/01-workflow-source-built.stdout', 'capture/02-workflow-installed.stdout', 'capture/03-workflow-physically-moved.stdout'];
  const receipts = [], records = [];
  for (const relative of paths) {
    const filename = path.join(work, relative);
    if (!fs.existsSync(filename)) { receipts.push({ path: filename, state: 'ABSENT' }); continue; }
    const body = read(filename, undefined, 8388608); const identity = { path: filename, bytes: body.length, sha256: hash(body) };
    save(path.join(scope, 'read-' + relative.replaceAll('/', '_') + '.receipt.json'), identity); receipts.push(identity);
    if (relative.endsWith('.jsonl')) records.push({ path: relative, events: body.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) });
    else records.push({ path: relative, value: JSON.parse(body) });
  }
  save(path.join(scope, 'RAW-OUTCOME.json'), { utc: new Date().toISOString(), pid: process.pid, receipts, records, qualification: 'Raw partial/missing outcomes preserved; no retry/count inference.' });
  for (const row of records) {
    if (row.value?.rows) console.log(JSON.stringify({ path: row.path, rows: row.value.rows, passed: row.value.passed, failed: row.value.failed, observations: row.value.observations }));
    else if (row.events) console.log(JSON.stringify(row));
    else console.log(JSON.stringify({ path: row.path, keys: Object.keys(row.value), status: row.value.status, retirement: row.value.retirement, aggregate: row.value.aggregate?.map(entry => ({ layout: entry.layout, passed: entry.report.passed, failed: entry.report.failed, guestWorkerCreates: entry.guestWorkerCreates, guestWorkerExits: entry.guestWorkerExits, guestWorkerPeak: entry.guestWorkerPeak, pid: entry.pid })) }));
  }
  console.log(JSON.stringify({ utc: new Date().toISOString(), pid: process.pid }));
} else if (command === 'ledger') {
  const rows = JSON.parse(read(path.join(scope, 'PRIOR-ROLES.json'), { bytes: Number(process.argv[4]), sha256: process.argv[3] }, 65536));
  assert.ok(Array.isArray(rows) && rows.length <= 25);
  for (const row of rows) assert.ok(row.startObserved === true && row.exitObserved === true && row.closeObserved === true);
  const seen = new Set(rows.map(row => row.id)); assert.equal(seen.size, rows.length);
  const self = { id: `prepublication-metadata-${process.pid}`, role: 'prepublication-metadata', pid: process.pid, startedUTC: new Date().toISOString(), startObserved: true };
  for (const entry of [...packet.publisherFiles, ...packet.preimportFiles]) read(entry.path, entry);
  process.once('exit', code => {
    if (code !== 0) return;
    fs.closeSync(1); fs.closeSync(2);
    const row = { ...self, exitObserved: true, closeObserved: true, exitCode: code, qualification: 'Node exit callback and synchronous own raw FD closure; coordinator must additionally observe successful tool return before preimport. Not an independent kernel close trace.' };
    const ledger = { schema: 'B1-measured-known-role-ledger-v3', attemptAuthorization: 'ROOT-2026-08-29-B1-R4-PUBLIC15-ONE-ATTEMPT-b087e5ce', starts: [...rows, row] };
    const identity = save(packet.slots.ledgerPath, ledger);
    save(path.join(scope, 'LEDGER-RECEIPT.json'), { identity, knownStarts: ledger.starts.length, pid: process.pid, utc: new Date().toISOString() });
  });
  console.log(JSON.stringify({ pid: process.pid, priorKnownRoles: rows.length, utc: new Date().toISOString(), finalIdentityIn: path.join(scope, 'LEDGER-RECEIPT.json') }));
} else if (command === 'publication') {
  const finalPath = '/private/tmp/coherent-b1-publication-r4-20260829-results/FINAL.json';
  const body = read(finalPath, undefined, 1048576); const identity = { path: finalPath, bytes: body.length, sha256: hash(body) };
  save(path.join(scope, 'PUBLICATION-FINAL-RECEIPT.json'), identity);
  const final = JSON.parse(body); save(path.join(scope, 'PUBLICATION-FINAL.json'), final);
  const outcomeBody = read(path.join(scope, 'RAW-OUTCOME.json'), undefined, 8388608); const outcome = JSON.parse(outcomeBody);
  const matrix = outcome.records.filter(row => row.value?.rows).map(row => ({ layout: row.value.layout, rows: row.value.rows.map(entry => ({ id: entry.id, status: entry.status, phase: entry.facts?.phase ?? entry.phase ?? null, prepares: entry.prepares ?? entry.facts?.prepares ?? null })), passed: row.value.passed, failed: row.value.failed, workerCreated: row.value.observations.filter(event => event.kind === 'workerCreated').length, workerExit: row.value.observations.filter(event => event.kind === 'workerExit').length, workerRetired: row.value.observations.filter(event => event.kind === 'retired').length }));
  const summary = { schema: 'B1-r4-actual-handoff-v1', utc: new Date().toISOString(), pid: process.pid, matrix, publicationCommit: final.terminal?.commit, publicationStatus: final.terminal?.outcome, publicationResult: final.terminal?.result, knownStartsThroughPublisher: final.knownStartsThroughReceipt, accounting: final.accounting, qualifications: { oldAttemptUnchanged: true, B2StillRequired: true, fullCoherentAcceptance: false, knownRoleOnly: true, nestedLoadProof: false, GitPhysicalStorageUnobserved: true }, package: packet.product.package, sourceTree: packet.product.sourceTree };
  save(path.join(scope, 'HANDOFF.json'), summary);
  console.log(JSON.stringify(summary));
} else throw new Error('Unknown evidence-only metadata action');
