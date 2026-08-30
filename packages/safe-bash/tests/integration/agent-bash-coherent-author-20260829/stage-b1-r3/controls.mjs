import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const [sealPath, expectedHash, expectedSize, outputPath, scratch] = process.argv.slice(2);
const hash = body => crypto.createHash('sha256').update(body).digest('hex');
function admit(filename, identity, ceiling) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, identity.bytes); assert.ok(stat.size <= ceiling);
  const body = fs.readFileSync(filename); assert.equal(body.length, stat.size); assert.equal(hash(body), identity.sha256); return body;
}
const seal = JSON.parse(admit(sealPath, { bytes: Number(expectedSize), sha256: expectedHash }, 1048576));
assert.equal(process.execPath, seal.node.path);
const executableStat = fs.lstatSync(seal.node.path);
assert.ok(executableStat.isFile() && !executableStat.isSymbolicLink());
assert.equal(executableStat.size, seal.node.bytes);
const executableDigest = crypto.createHash('sha256');
const executableDescriptor = fs.openSync(seal.node.path, 'r');
try {
  const chunk = Buffer.alloc(65536);
  let consumed = 0;
  while (consumed < seal.node.bytes) {
    const count = fs.readSync(executableDescriptor, chunk, 0, Math.min(chunk.length, seal.node.bytes - consumed), consumed);
    assert.ok(count > 0); executableDigest.update(chunk.subarray(0, count)); consumed += count;
  }
  assert.equal(fs.fstatSync(executableDescriptor).size, seal.node.bytes);
} finally { fs.closeSync(executableDescriptor); }
assert.equal(executableDigest.digest('hex'), seal.node.sha256);
const directory = path.dirname(fileURLToPath(import.meta.url));
for (const entry of seal.files) admit(path.join(directory, entry.path), entry, 1048576);
assert.equal(scratch, seal.scratch); assert.equal(fs.existsSync(scratch), false);
const { createLayoutHarness, layoutPaths } = await import('./layout.mjs');
const rows = [];
fs.mkdirSync(scratch);
try {
  const installed = path.join(scratch, 'installed'), moved = path.join(scratch, 'physically-moved');
  fs.mkdirSync(installed);
  const old = createLayoutHarness(installed, 'installed');
  const packageRoot = path.join(installed, 'node_modules/virtual-bash'); fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'sentinel'), 'ordinary inert package stand-in\n', { flag: 'wx' });
  const oldManifest = Buffer.from('{"files":[{"path":"installed-only"}]}\n');
  const oldTrace = Buffer.from('retained installed trace\n');
  fs.writeFileSync(old.manifest, oldManifest, { flag: 'wx' }); fs.writeFileSync(path.join(old.harness, 'trace'), oldTrace, { flag: 'wx' });
  const beforeStat = fs.statSync(path.join(packageRoot, 'sentinel'));
  fs.renameSync(installed, moved);
  assert.equal(fs.existsSync(installed), false); assert.equal(fs.statSync(path.join(moved, 'node_modules/virtual-bash/sentinel')).ino, beforeStat.ino);
  rows.push({ id: 'L01', result: 'PASS', scope: 'Actual owned inert directory rename, not package installation' });
  const fresh = createLayoutHarness(moved, 'physically-moved');
  fs.writeFileSync(fresh.manifest, '{"files":[]}\n', { flag: 'wx' });
  assert.deepEqual(fs.readFileSync(path.join(moved, 'harness-installed/load-manifest.json')), oldManifest);
  assert.deepEqual(fs.readFileSync(path.join(moved, 'harness-installed/trace')), oldTrace);
  rows.push({ id: 'L02', result: 'PASS', scope: 'Fresh exclusive manifest; installed manifest and trace unchanged' });
  assert.throws(() => createLayoutHarness(moved, 'physically-moved'), { code: 'EEXIST' });
  assert.throws(() => fs.writeFileSync(fresh.manifest, 'overwrite', { flag: 'wx' }), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(fresh.manifest, 'utf8'), '{"files":[]}\n');
  rows.push({ id: 'L03', result: 'PASS', scope: 'Repeated layout/manifest refuses rather than overwrites' });
  for (const layout of ['source-built', 'installed', 'physically-moved']) {
    const selected = layoutPaths(path.join(scratch, layout), layout);
    assert.equal(fileURLToPath(new URL('../load-manifest.json', pathToFileURL(path.join(selected.scripts, 'node-load-guard.mjs')))), selected.manifest);
    assert.equal(fileURLToPath(new URL('../node-policy.json', pathToFileURL(path.join(selected.scripts, 'node-policy.mjs')))), selected.policy);
  }
  assert.throws(() => layoutPaths(moved, '../installed')); assert.throws(() => layoutPaths('relative', 'installed'));
  rows.push({ id: 'L04', result: 'PASS', scope: 'Exact retained relative loader/policy resolution and finite layout domain; no hooks or Workers executed' });
} finally { fs.rmSync(scratch, { recursive: true }); }
assert.equal(fs.existsSync(scratch), false);
fs.writeFileSync(outputPath, JSON.stringify({ schema: 'B1-r3-layout-controls-v1', utc: new Date().toISOString(), pid: process.pid, rows, ownedScratchRemoved: true, productCalls: 0, Workers: 0, qualification: 'One harmless Node controller; actual fs on new owned inert fixtures only. No full runtime/engine/loader proof.' }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: rows.length, productCalls: 0, pid: process.pid, utc: new Date().toISOString() }));
