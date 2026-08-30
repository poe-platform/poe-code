import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const here = import.meta.dirname;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sealBytes = fs.readFileSync(path.join(here, 'CONTROL-PRESEAL.json'));
assert.equal(sha(sealBytes), process.argv[2]);
const seal = JSON.parse(sealBytes);
assert.ok(Date.now() < Date.parse(seal.deadline));
const work = process.argv[3];
assert.equal(work, seal.workRoot);
for (const row of seal.files) {
  const file = path.join(here, row.path), stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, row.bytes);
  assert.equal(sha(fs.readFileSync(file)), row.sha256);
}
const inputs = JSON.parse(fs.readFileSync(path.join(here, 'INPUTS.json')));
const source = JSON.parse(fs.readFileSync(path.join(here, 'SOURCE-INPUTS.json')));
function bytesAt(rows, suffix) {
  const matches = rows.filter(row => (row.path ?? row.spec).endsWith(suffix));
  assert.equal(matches.length, 1);
  const row = matches[0], bytes = Buffer.from(row.body, 'base64');
  assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256);
  return bytes;
}
const parse = suffix => JSON.parse(bytesAt(inputs, suffix));
const sourceJson = suffix => JSON.parse(bytesAt(source, suffix));
const inventory = parse('/evidence/WORK-INVENTORY.json');
assert.equal(inventory.root, work);
function safe(relative) {
  assert.ok(typeof relative === 'string' && relative && !relative.startsWith('/') && !relative.includes('\\') && !relative.includes('\0'));
  assert.ok(relative.split('/').every(part => part && part !== '.' && part !== '..' && part !== 'AGENTS.md'));
  return relative;
}
function hashFile(file, row) {
  const before = fs.lstatSync(file);
  assert.ok(before.isFile() && !before.isSymbolicLink()); assert.equal(before.size, row.bytes);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const buffer = Buffer.alloc(65536), hash = crypto.createHash('sha256');
  let position = 0;
  try {
    while (position < before.size) {
      const count = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, before.size - position), position);
      assert.ok(count > 0); hash.update(buffer.subarray(0, count)); position += count;
    }
    const after = fs.fstatSync(descriptor);
    assert.equal(after.ino, before.ino); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
  } finally { fs.closeSync(descriptor); }
  assert.equal(hash.digest('hex'), row.sha256);
  return position;
}
function census(root, expectedRows) {
  assert.equal(fs.realpathSync(root), root);
  const expected = new Map(expectedRows.map(row => [safe(row.path), row]));
  assert.equal(expected.size, expectedRows.length);
  const observed = [];
  let totalBytes = 0, regular = 0;
  function visit(relative = '') {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const key = relative ? relative + '/' + name : name, row = expected.get(key);
      assert.ok(row, 'unexpected entry ' + key);
      const file = path.join(root, key), stat = fs.lstatSync(file);
      if (stat.isDirectory()) { assert.equal(row.type, 'directory'); observed.push(key); visit(key); }
      else if (stat.isSymbolicLink()) { assert.equal(row.type, 'link'); assert.equal(fs.readlinkSync(file), row.target); observed.push(key); }
      else { assert.equal(row.type, 'file'); totalBytes += hashFile(file, row); regular++; observed.push(key); }
      assert.ok(totalBytes <= 33554432 && observed.length <= 5000);
    }
  }
  visit(); assert.equal(observed.length, expected.size);
  return Object.freeze({ root, entries: observed.length, regular, bytes: totalBytes, addedMissingChanged: 0 });
}
const firstCensus = census(work, inventory.entries);
assert.equal(firstCensus.bytes, inventory.bytes);
const workRows = new Map(inventory.entries.map(row => [row.path, row]));
function workBytes(relative) {
  const row = workRows.get(relative); assert.ok(row && row.type === 'file' && row.bytes <= 1048576);
  const file = path.join(work, safe(relative)); hashFile(file, row);
  const bytes = fs.readFileSync(file); assert.equal(sha(bytes), row.sha256); return bytes;
}
function jsonLines(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.ok(text.endsWith('\n'));
  return text.slice(0, -1).split('\n').map(line => { assert.ok(line); return JSON.parse(line); });
}
const ids = ['C01','C02','C03','C04','C05','C06','C07','C08','C09','C12','C13','C14','C17'];
const layouts = ['source-built','installed','physically-moved'];
const c17 = ['registered','diagnostic','cleanup-enter','release','cleanup-finished','settled'];
function validateReport(bytes, layout) {
  const framed = jsonLines(bytes); assert.equal(framed.length, 1);
  const report = framed[0];
  assert.deepEqual(Object.keys(report).sort(), ['schema','layout','rows','passed','failed','guestEngineCalls'].sort());
  assert.equal(report.schema, 'coherent-b0-result-v1'); assert.equal(report.layout, layout);
  assert.equal(report.passed, 13); assert.equal(report.failed, 0); assert.equal(report.guestEngineCalls, 0);
  assert.deepEqual(report.rows.map(row => row.id), ids);
  for (const row of report.rows) {
    assert.equal(row.status, 'PASS'); assert.equal(row.role, 'ENGINE_FREE_PRODUCT_PROFILE'); assert.equal(row.prepares, 0);
    assert.equal(row.shells, row.id === 'C01' ? 2 : 1);
    assert.deepEqual(row.cleanup, Array(row.shells).fill('fulfilled'));
    assert.deepEqual(row.events, row.id === 'C17' ? c17 : []);
  }
  return report;
}
function validateResources(events, pid) {
  assert.deepEqual(events, [{ kind: 'bootstrap', pid, allowance: 2 }, { kind: 'before-exit', created: 0, live: 0 }]);
}
function validateLoads(events, binding) {
  const allowed = new Map(binding.inputs.map(row => [path.join(binding.root, 'dist', row.path), row]));
  assert.ok(events.length > 0 && events.length < 1000);
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), ['file','sha256']);
    const row = allowed.get(event.file); assert.ok(row); assert.equal(event.sha256, row.sha256);
  }
  for (const name of ['index.js','shell/shell.js','shell/runtime.js']) assert.ok(events.some(row => row.file === path.join(binding.root, 'dist', name)));
  return { records: events.length, uniqueModules: new Set(events.map(row => row.file)).size };
}
const rawResult = parse('/evidence/raw/RESULT.json');
const summary = parse('/evidence/SUMMARY.json');
const rawManifest = parse('/evidence/RAW-MANIFEST.json');
for (const row of rawManifest) {
  const suffix = row.path.startsWith('/') ? '/evidence/' + path.basename(row.path) : '/evidence/raw/' + row.path;
  const bytes = bytesAt(inputs, suffix); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256);
}
assert.equal(rawResult.status, 'PASS'); assert.equal(rawResult.coherentAcceptance, false);
assert.equal(rawResult.sourceTree, '3adc676a0ab638c9788ef007e465931d65d2c6fe');
const members = sourceJson('/PACKAGE-MEMBERS.json'); assert.equal(members.length, 1014);
assert.equal(sha(workBytes('input/product.tgz')), '2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca');
const observations = [];
for (const [index, layout] of layouts.entries()) {
  const prefix = String(index + 1).padStart(2, '0') + '-workflow-' + layout;
  const raw = bytesAt(inputs, '/capture/' + prefix + '.stdout');
  const report = validateReport(raw, layout);
  assert.deepEqual(report, rawResult.aggregate[index].report);
  const location = layout === 'installed' ? 'physically-moved' : layout;
  const binding = JSON.parse(workBytes(location + '/binding-' + layout + '.json'));
  const request = JSON.parse(workBytes(location + '/request-' + layout + '.json'));
  assert.deepEqual(request.ids, ids); assert.equal(request.layout, layout);
  const resources = jsonLines(workBytes(location + '/resources-' + layout + '.jsonl'));
  validateResources(resources, rawResult.aggregate[index].pid);
  const loads = jsonLines(workBytes(location + '/loads-' + layout + '.jsonl'));
  const loaded = validateLoads(loads, binding);
  for (const member of members) {
    const actual = workRows.get(location + '/node_modules/virtual-bash/' + member.path);
    assert.ok(actual); assert.equal(actual.bytes, member.bytes); assert.equal(actual.sha256, member.sha256);
  }
  for (const name of ['workflows.mjs','runner.mjs','resources.mjs','loader.mjs','denials.mjs']) {
    const actual = workBytes(location + '/b0/' + name);
    assert.equal(sha(actual), sha(bytesAt(source, '/' + name)));
  }
  observations.push({ layout, pid: resources[0].pid, passed: report.passed, failed: report.failed, shells: report.rows.reduce((sum,row) => sum + row.shells, 0), fulfilled: report.rows.reduce((sum,row) => sum + row.cleanup.length, 0), regexWorkers: 0, loaderAdmission: 1, ...loaded });
}
function validateOwner(events) {
  const roles = ['offline-install', ...layouts.map(layout => 'workflow-' + layout)];
  let captured = 0, previousClose = -1;
  for (const [index, role] of roles.entries()) {
    const spawn = events.filter(row => row.role === role && row.spawned === true);
    const exit = events.filter(row => row.role === role && row.event === 'exit');
    const close = events.filter(row => row.role === role && row.event === 'close');
    assert.equal(spawn.length, 1); assert.equal(exit.length, 1); assert.equal(close.length, 1);
    assert.equal(spawn[0].pid, exit[0].pid); assert.equal(exit[0].pid, close[0].pid);
    assert.equal(exit[0].status, 0); assert.equal(close[0].status, 0); assert.equal(exit[0].signal, null); assert.equal(close[0].signal, null);
    assert.ok(spawn[0].elapsedMs > previousClose && exit[0].elapsedMs >= spawn[0].elapsedMs && close[0].elapsedMs >= exit[0].elapsedMs);
    previousClose = close[0].elapsedMs;
    assert.ok(close[0].elapsedMs - spawn[0].elapsedMs < (index === 0 ? 120000 : 420000));
    for (const stream of ['stdout','stderr']) {
      const raw = bytesAt(inputs, '/capture/' + String(index).padStart(2, '0') + '-' + role + '.' + stream);
      const stored = stream === 'stdout' ? 'storedStdout' : 'storedStderr';
      assert.equal(close[0][stream + 'Bytes'], raw.length); assert.equal(close[0][stored], raw.length); captured += raw.length;
    }
    if (index > 0) { assert.ok(spawn[0].args.includes('--loader')); assert.ok(spawn[0].args.includes('--allow-worker')); }
  }
  assert.equal(events.filter(row => row.signal === 'SIGTERM' || row.signal === 'SIGKILL').length, 0);
  const terminal = events.filter(row => row.finished === true); assert.equal(terminal.length, 1);
  assert.equal(terminal[0].children, 4); assert.equal(terminal[0].attemptedBytes, captured); assert.equal(terminal[0].storedBytes, captured);
  return captured;
}
const ownerEvents = jsonLines(bytesAt(inputs, '/evidence/raw/capture/events.jsonl'));
const captured = validateOwner(ownerEvents); assert.equal(captured, 8653);
assert.equal(rawResult.retirement.children, 4); assert.equal(rawResult.retirement.attemptedBytes, captured); assert.equal(rawResult.retirement.storedBytes, captured);
assert.deepEqual(rawResult.retirement.failures, []); assert.ok(rawResult.retirement.elapsedMs < 1620000);
assert.equal(observations.reduce((sum,row) => sum + row.fulfilled, 0), 42);
const tampers = [];
function reject(id, fn) { assert.throws(fn); tampers.push({ id, rejected: true }); }
const originalRaw = bytesAt(inputs, '/01-workflow-source-built.stdout');
reject('T01-extra-frame', () => validateReport(Buffer.concat([originalRaw, Buffer.from('{}\n')]), 'source-built'));
const encode = value => Buffer.from(JSON.stringify(value) + '\n');
let altered = JSON.parse(originalRaw); altered.rows[1].id = 'C01';
reject('T02-duplicate-id', () => validateReport(encode(altered), 'source-built'));
altered = JSON.parse(originalRaw); altered.rows[0].cleanup[0] = 'rejected';
reject('T03-false-cleanup', () => validateReport(encode(altered), 'source-built'));
altered = JSON.parse(originalRaw); altered.rows.at(-1).events.reverse();
reject('T04-C17-order', () => validateReport(encode(altered), 'source-built'));
let changedEvents = structuredClone(ownerEvents); changedEvents.find(row => row.event === 'close').storedStdout--;
reject('T05-stored-byte-lie', () => validateOwner(changedEvents));
changedEvents = ownerEvents.filter(row => !(row.event === 'close' && row.role === 'workflow-installed'));
reject('T06-missing-known-close', () => validateOwner(changedEvents));
reject('T07-zero-worker-with-live-one', () => validateResources([{ kind:'bootstrap',pid:1,allowance:2 },{ kind:'before-exit',created:0,live:1 }],1));
const binding = JSON.parse(workBytes('source-built/binding-source-built.json'));
const alteredLoads = jsonLines(workBytes('source-built/loads-source-built.jsonl')); alteredLoads[0].sha256 = '0'.repeat(64);
reject('T08-loaded-hash-mismatch', () => validateLoads(alteredLoads, binding));
const finalCensus = census(work, inventory.entries); assert.deepEqual(finalCensus, firstCensus);
assert.ok(Date.now() < Date.parse(seal.deadline));
const result = Object.freeze({ role: 'DATA_ONLY_NO_TARGET_IMPORT', at: new Date().toISOString(), observations, capturedBytes: captured, shellDisposeFulfillments: 42, semanticRows: 39, regexWorkers: 0, internalLoaderAdmissions: 3, individualLoaderExits: 'NOT_OBSERVED', firstCensus, finalCensus, tampers, productExecutions: 0, note: 'Rows attest bound assertions; individual Shell stdout/stderr bodies are not separately serialized in report rows.' });
fs.writeFileSync(path.join(here, 'AUDIT-RESULT.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ rows:39, disposals:42, tamperRejections:tampers.length, productExecutions:0 }));
