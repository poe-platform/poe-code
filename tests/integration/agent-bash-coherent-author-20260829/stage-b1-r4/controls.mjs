import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root = '/Users/kjopek/Workspace/safe-bash';
const scope = import.meta.dirname;
const hash = body => crypto.createHash('sha256').update(body).digest('hex');
function admit(filename, identity) {
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, identity.bytes); assert.ok(stat.size <= 262144);
  const body = fs.readFileSync(filename); assert.equal(body.length, identity.bytes); assert.equal(hash(body), identity.sha256); return body;
}
const [sealFile, expectedHash, expectedSize, output] = process.argv.slice(2);
const seal = JSON.parse(admit(sealFile, { bytes: Number(expectedSize), sha256: expectedHash }));
const contents = new Map(); for (const entry of seal.files) contents.set(entry.path, admit(path.join(scope, entry.path), entry));
const { captureFailure } = await import('./failure.mjs');
const rows = [];
const check = (id, callback) => { callback(); rows.push({ id, status: 'PASS', role: 'PURE_SOURCE_DATA_NOT_PRODUCT' }); };
const original = admit(path.join(root, seal.oldFixture.source), seal.oldFixture).toString();
const revised = contents.get('workflows.mjs').toString();
check('D01', () => {
  const marker = "    } else if (id === 'C18') {", tail = '\n    }\n    facts.status';
  assert.equal(original.slice(0, original.indexOf(marker)), revised.slice(0, revised.indexOf(marker)));
  assert.equal(original.slice(original.indexOf(tail, original.indexOf(marker))), revised.slice(revised.indexOf(tail, revised.indexOf(marker))));
});
check('D02', () => {
  assert.ok(revised.indexOf("const registered = collided.commands.get('node')") < revised.indexOf('collided.use({ name: collisionPlugin.name'));
  for (const literal of ['assert.equal(result.reason, setupFailure)', 'assert.equal(setupFailures, 1)', 'assert.equal(collided.commands.get(\'node\'), registered)', 'throw reason;']) assert.ok(revised.includes(literal));
});
check('D03', () => {
  for (const literal of ["assert.equal(disposed.kind, 'return')", 'options.replace = false; options.provider = null; options.grants.stdoutWrite = false;', 'await expect(shell, "node -p \'8\'", \'8\\n\'); assert.equal(prepares, 1)']) assert.ok(revised.includes(literal));
});
check('D04', () => {
  for (const value of [0, false, undefined, null, '', -0]) {
    const captured = captureFailure(new Error('wrapper', { cause: value }), 'collision-exec'); assert.equal(captured.primaryPresent, true); assert.equal(captured.causePresent, true);
    assert.equal(captured.cause.type, value === null ? 'null' : typeof value);
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') assert.ok(Object.is(captured.cause.value, value));
  }
  assert.equal(captureFailure(new Error('no cause')).causePresent, false);
});
check('D05', () => {
  let touched = 0; const value = Object.defineProperties({}, { message: { get() { touched++; throw 0; } }, cause: { get() { touched++; throw false; } } });
  assert.equal(captureFailure(value).cause.type, 'ACCESSOR_UNREAD'); assert.equal(touched, 0);
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { touched++; throw 0; } }); assert.equal(captureFailure(proxy).reason.opaqueProxy, true); assert.equal(touched, 0);
});
check('D06', () => {
  const error = new Error('x'.repeat(4096), { cause: 'y'.repeat(4096) }); error.actual = { secret: 'not traversed' };
  const captured = captureFailure(error, 'z'.repeat(4096)); assert.equal(captured.reason.message.length, 256); assert.equal(captured.cause.value.length, 256); assert.equal(captured.phase.length, 80);
  assert.ok(JSON.stringify(captured).length < 1024); assert.equal(Object.hasOwn(captured.reason, 'stack'), false); assert.equal(Object.hasOwn(captured.reason, 'actual'), false);
});
check('D07', () => {
  const run = contents.get('run.mjs').toString(); assert.ok(run.includes("from '../stage-b1-r3/layout.mjs'")); assert.ok(run.includes('createLayoutHarness(consumer, layout)'));
  assert.ok(run.includes('fs.renameSync(install, consumer)')); assert.ok(run.includes("path.join(harness, 'load-manifest.json')"));
});
check('D08', () => {
  const old = JSON.parse(admit(path.join(root, seal.oldPublication.path), seal.oldPublication));
  const publication = JSON.parse(contents.get('PUBLICATION-BINDING.json'));
  assert.deepEqual(publication.workerProfile, old.workerProfile); assert.deepEqual(publication.package, old.package); assert.equal(publication.rootActualAuthority, false);
  for (const key of ['work','evidence','publication']) assert.notEqual(publication.outputs[key], old.outputs[key]);
  const oldPolicy = old.files.find(row => row.path.endsWith('/policy.mjs')); assert.deepEqual(contents.get('policy.mjs'), admit(path.join(root, oldPolicy.path), oldPolicy));
  const oldPublisher = old.files.find(row => row.path.endsWith('/publish.mjs'));
  assert.equal(contents.get('publish.mjs').toString(), admit(path.join(root, oldPublisher.path), oldPublisher).toString().replaceAll('stage-b1-publication-v2', 'stage-b1-r4'));
});
fs.writeFileSync(output, JSON.stringify({ schema: 'B1-r4-DATA-results-v1', rows, productCalls: 0, Workers: 0, pid: process.pid, utc: new Date().toISOString(), qualification: 'No product fixture execution. Source invariants and actual bounded serializer only; publisher/runtime lifecycle inherited, not rerun.' }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: rows.length, pid: process.pid, utc: new Date().toISOString() }));
