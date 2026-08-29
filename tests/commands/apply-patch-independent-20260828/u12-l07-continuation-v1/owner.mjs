import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { finished } from 'node:stream/promises';

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, '../../../..');
const run = path.join(own, 'attempt-01');
const work = path.join(run, 'work');
const started = performance.now();
const hash = value => createHash('sha256').update(value).digest('hex');
const evidence = [];
const receipts = [];
const archiveDescriptors = new Set();
const archiveStreams = [];
let active;
let combined = 0;
let primary = null;
let complete = false;
let workIdentity;
const eventFd = fs.openSync(path.join(run, 'EVENTS.jsonl'), 'ax', 0o600);
function writeAll(descriptor, bytes) {
  for (let offset = 0; offset < bytes.length;) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
}
function charge(amount) { combined += amount; assert.ok(combined <= 32 * 1024 * 1024 - 65536, 'COMBINED_CAPTURE_UNSAFE_STOP; 64KiB reserved outer raw'); }
function same(actual, expected, label = 'bounded exact structural comparison') { assert.ok(isDeepStrictEqual(actual, expected), label); }
function event(value) {
  const bytes = Buffer.from(JSON.stringify({ elapsedMs: performance.now() - started, ...value }) + '\n');
  charge(bytes.length); writeAll(eventFd, bytes); fs.fsyncSync(eventFd);
}
function regular(filename, maximum) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, filename);
  assert.equal(fs.realpathSync(filename), filename);
  return stat;
}
function readJson(filename, maximum = 16 * 1024 * 1024) {
  regular(filename, maximum); assert.ok(filename.endsWith('.json'));
  return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(fs.readFileSync(filename)));
}
async function description(filename, maximum = 128 * 1024 * 1024) {
  const stat = regular(filename, maximum), digest = createHash('sha256'); let length = 0;
  for await (const chunk of fs.createReadStream(filename)) { length += chunk.length; assert.ok(length <= maximum); digest.update(chunk); }
  assert.equal(length, stat.size);
  return { bytes: length, sha256: digest.digest('hex'), mode: stat.mode & 0o777 };
}
function put(filename, value, mode = 0o644, captured = false) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  assert.ok(bytes.length <= 4 * 1024 * 1024);
  if (captured) charge(bytes.length);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const descriptor = fs.openSync(filename, 'wx', mode);
  try { writeAll(descriptor, bytes); fs.fchmodSync(descriptor, mode); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
async function inventory(root) {
  const rows = {};
  async function visit(directory, prefix) {
    for (const name of fs.readdirSync(directory).sort()) {
      const filename = path.join(directory, name), relative = prefix + name, stat = fs.lstatSync(filename);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) { rows[relative + '/'] = { kind: 'directory', mode: stat.mode & 0o777 }; await visit(filename, relative + '/'); }
      else { assert.ok(stat.isFile()); rows[relative] = { kind: 'file', ...await description(filename) }; }
    }
  }
  await visit(root, '');
  assert.ok(Object.values(rows).reduce((total, row) => total + (row.bytes ?? 0), 0) <= 256 * 1024 * 1024);
  return rows;
}
async function child(job, node, environment) {
  assert.equal(active, undefined); assert.ok(receipts.length < 3);
  const channels = Object.fromEntries(['stdout', 'stderr'].map(name => {
    const filename = path.join(run, `${job.layout}.${name}.raw`);
    return [name, { filename, descriptor: fs.openSync(filename, 'wx', 0o600), bytes: 0, digest: createHash('sha256'), chunks: [] }];
  }));
  const args = ['--permission', `--allow-fs-read=${job.consumer}`, `--allow-fs-read=${job.product}`, '--max-old-space-size=256', '--no-warnings', path.join(job.consumer, 'bootstrap.mjs'), path.join(job.consumer, 'job.json'), job.jobHash];
  event({ kind: 'capture-enrolled-before-spawn', layout: job.layout, executable: node, args, env: environment });
  const processChild = spawn(node, args, { cwd: job.consumer, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  active = processChild;
  let failure;
  const timer = setTimeout(() => { failure ??= 'CHILD_TIMEOUT_UNSAFE_STOP'; processChild.kill('SIGKILL'); }, 100000);
  for (const name of ['stdout', 'stderr']) processChild[name].on('data', chunk => {
    const channel = channels[name];
    try {
      assert.ok(channels.stdout.bytes + channels.stderr.bytes + chunk.length <= 4 * 1024 * 1024, 'CHILD_CAPTURE_UNSAFE_STOP');
      charge(chunk.length); writeAll(channel.descriptor, chunk); channel.bytes += chunk.length; channel.digest.update(chunk); channel.chunks.push(Buffer.from(chunk));
    } catch (error) { failure ??= String(error); processChild.kill('SIGKILL'); }
  });
  processChild.on('error', error => { failure ??= String(error); });
  const termination = await new Promise(resolve => processChild.once('close', (code, signal) => resolve({ code, signal })));
  clearTimeout(timer);
  let absent = false;
  if (processChild.pid) try { process.kill(processChild.pid, 0); } catch (error) { absent = error.code === 'ESRCH'; }
  const receipt = { layout: job.layout, pid: processChild.pid ?? null, ...termination, closeObserved: true, absent, failure: failure ?? null, channels: {} };
  for (const [name, channel] of Object.entries(channels)) {
    fs.fsyncSync(channel.descriptor); fs.closeSync(channel.descriptor);
    receipt.channels[name] = { path: path.basename(channel.filename), bytes: channel.bytes, sha256: channel.digest.digest('hex') };
  }
  receipts.push(receipt); active = undefined; put(path.join(run, `${job.layout}.receipt.json`), receipt, 0o600, true);
  assert.ok(absent && failure === undefined && termination.code === 0 && termination.signal === null, 'RETIREMENT_OR_EXECUTION_UNSAFE_STOP');
  const records = new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(channels.stdout.chunks)).trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(channels.stderr.bytes, 0, 'unexpected worker stderr');
  const final = records.at(-1); assert.equal(final.kind, 'final'); assert.equal(final.complete, true); assert.equal(final.unhandled, 0);
  assert.deepEqual(records.slice(0, -1).map(row => row.id), job.cases);
  assert.ok(records.slice(0, -1).every(row => row.kind === 'case' && ['PASS', 'FAIL'].includes(row.status)));
  const productLoads = final.loads.filter(row => row.graph !== 'harness');
  assert.equal(productLoads.length, 216); assert.equal(new Set(productLoads.map(row => row.url)).size, 216);
  for (const row of productLoads) assert.ok(row.url.startsWith(pathToFileURL(job.product + '/').href));
  evidence.push({ layout: job.layout, records });
}

try {
  event({ kind: 'outer-startup', pid: process.pid });
  assert.equal(fs.realpathSync(run), run); assert.equal(process.argv.length, 3);
  regular(path.join(own, 'PRESEAL.json'), 65536);
  const sealBytes = fs.readFileSync(path.join(own, 'PRESEAL.json'));
  assert.equal(hash(sealBytes), process.argv[2]);
  const seal = readJson(path.join(own, 'PRESEAL.json'));
  assert.equal(process.execPath, seal.node.path); assert.equal(process.version, 'v22.22.2');
  same(Object.fromEntries(Object.entries(process.env).sort()), seal.environment);
  same(await description(seal.node.path), seal.node.binding);
  for (const [name, expected] of Object.entries(seal.inputs)) same(await description(path.join(repository, name)), expected, name);
  for (const [name, expected] of Object.entries(seal.files)) same(await description(path.join(own, name)), expected, name);
  const old = path.join(repository, seal.previousExecutor);
  const { readPacket } = await import(pathToFileURL(path.join(old, 'manifest.mjs')).href);
  const { authority } = await import(pathToFileURL(path.join(old, 'authority.mjs')).href);
  const runtime = readPacket(path.join(old, 'RUNTIME-SEAL.json'), authority);
  assert.equal(runtime.candidate, seal.candidate); assert.equal(runtime.sourceTree, seal.sourceTree); assert.equal(runtime.packageSha256, seal.packageSha256);
  const packageManifest = readJson(path.join(old, 'PACKAGE-INVENTORY.json'));
  same(packageManifest, runtime.packageInventory);
  assert.equal(Object.values(packageManifest).filter(row => row.kind === 'file').length, 882);
  const membership = readJson(path.join(old, 'attempt-01/WORK-MEMBERSHIP.json'));
  const sourceBindings = readJson(path.join(old, 'BINDINGS.json'));
  const metadata = fs.readFileSync(path.join(old, 'attempt-01/01-source-metadata.stdout.raw'));
  const sourceObjects = new Map();
  for (let offset = 0; offset < metadata.length;) {
    const newline = metadata.indexOf(10, offset); assert.ok(newline >= offset && newline - offset < 100);
    const match = /^([a-f0-9]{40}) (blob|tree|commit) (\d+)$/.exec(metadata.subarray(offset, newline).toString('ascii')); assert.ok(match);
    const end = newline + 1 + Number(match[3]); assert.equal(metadata[end], 10);
    const bytes = metadata.subarray(newline + 1, end);
    assert.equal(createHash('sha1').update(`${match[2]} ${bytes.length}\0`).update(bytes).digest('hex'), match[1]);
    sourceObjects.set(match[1], bytes); offset = end + 1;
  }
  assert.equal(sourceBindings.selectedInputs.length, 274);
  for (const row of sourceBindings.selectedInputs) { const bytes = sourceObjects.get(row.blob); assert.equal(bytes?.length, row.bytes); assert.equal(hash(bytes), row.sha256); }
  fs.mkdirSync(work, { mode: 0o700 }); workIdentity = fs.lstatSync(work);
  const roots = { source: path.join(work, 'source'), installed: path.join(work, 'installed/node_modules/virtual-bash'), moved: path.join(work, 'relocation-origin/node_modules/virtual-bash') };
  const prefixes = { source: 'source/', installed: 'installed/node_modules/virtual-bash/', moved: 'moved/node_modules/virtual-bash/' };
  const selected = new Map();
  for (const layout of seal.layouts) {
    fs.mkdirSync(roots[layout], { recursive: true });
    for (const [name, entry] of Object.entries(packageManifest)) {
      const destination = path.join(roots[layout], name);
      same(membership[prefixes[layout] + name], entry, 'archived exact package member');
      if (entry.kind === 'directory') { fs.mkdirSync(destination, { recursive: true }); fs.chmodSync(destination, entry.mode); }
      else { assert.equal(entry.kind, 'file'); selected.set(prefixes[layout] + name, { destination, entry }); if (entry.bytes === 0) put(destination, Buffer.alloc(0), entry.mode); }
    }
  }
  let current;
  const seen = new Set();
  function finish() {
    if (!current) return;
    assert.equal(current.offset, current.entry.bytes); assert.equal(current.digest.digest('hex'), current.entry.sha256);
    if (current.descriptor !== undefined) { fs.fchmodSync(current.descriptor, current.entry.mode); fs.closeSync(current.descriptor); archiveDescriptors.delete(current.descriptor); }
    current = undefined;
  }
  const compressed = fs.createReadStream(path.join(old, 'attempt-01/WORK-CAPTURE.jsonl.gz'));
  const gunzip = createGunzip(); compressed.on('error', error => gunzip.destroy(error)); compressed.pipe(gunzip);
  archiveStreams.push(compressed, gunzip);
  let pending = Buffer.alloc(0); let expanded = 0;
  for await (const chunk of gunzip) {
    assert.ok(performance.now() - started < 120000, 'archive admission deadline');
    expanded += chunk.length; assert.ok(expanded <= 210 * 1024 * 1024);
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      const newline = pending.indexOf(10); if (newline < 0) break;
      assert.ok(newline < 100000);
      const row = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(pending.subarray(0, newline)));
      pending = pending.subarray(newline + 1);
      assert.deepEqual(Object.keys(row), ['name', 'offset', 'total', 'base64']);
      const entry = membership[row.name]; assert.equal(entry?.kind, 'file'); assert.equal(row.total, entry.bytes);
      if (current?.name !== row.name) {
        finish(); assert.ok(!seen.has(row.name)); seen.add(row.name); assert.equal(row.offset, 0);
        const selectedEntry = selected.get(row.name);
        if (selectedEntry) fs.mkdirSync(path.dirname(selectedEntry.destination), { recursive: true });
        current = { name: row.name, entry, offset: 0, digest: createHash('sha256'), descriptor: selectedEntry ? fs.openSync(selectedEntry.destination, 'wx', entry.mode) : undefined };
        if (current.descriptor !== undefined) archiveDescriptors.add(current.descriptor);
      }
      const bytes = Buffer.from(row.base64, 'base64'); assert.equal(bytes.toString('base64'), row.base64); assert.ok(bytes.length > 0 && bytes.length <= 65536);
      assert.equal(row.offset, current.offset); assert.ok(current.offset + bytes.length <= entry.bytes);
      current.digest.update(bytes); current.offset += bytes.length;
      if (current.descriptor !== undefined) writeAll(current.descriptor, bytes);
    }
    assert.ok(pending.length < 100000);
  }
  assert.equal(pending.length, 0); finish();
  assert.equal(expanded, 209745917);
  assert.equal(seen.size, Object.values(membership).filter(entry => entry.kind === 'file' && entry.bytes > 0).length);
  const consumers = { source: path.join(work, 'source-consumer'), installed: path.join(work, 'installed'), moved: path.join(work, 'relocation-origin') };
  const jobs = [];
  for (const layout of seal.layouts) {
    const consumer = consumers[layout]; fs.mkdirSync(consumer, { recursive: true });
    for (const name of ['bootstrap.mjs', 'cases.mjs']) put(path.join(consumer, name), fs.readFileSync(path.join(own, name)));
    for (const name of ['loader.mjs', 'manifest.mjs']) put(path.join(consumer, name), fs.readFileSync(path.join(old, name)));
    put(path.join(consumer, 'package.json'), Buffer.from(seal.consumerPackages[layout]));
    if (layout === 'moved') {
      const before = await inventory(consumer); const destination = path.join(work, 'moved'); fs.renameSync(consumer, destination);
      assert.equal(fs.existsSync(consumer), false); same(await inventory(destination), before);
      consumers[layout] = destination; roots[layout] = path.join(destination, 'node_modules/virtual-bash');
    }
    same(await inventory(roots[layout]), packageManifest);
    const harness = {};
    for (const name of ['bootstrap.mjs', 'cases.mjs', 'loader.mjs', 'manifest.mjs', 'package.json']) harness[name] = await description(path.join(consumers[layout], name));
    const job = { schema: 'AP753-U12-L07-continuation-v1', layout, consumer: consumers[layout], product: roots[layout], graphs: [{ id: layout, product: roots[layout], manifest: packageManifest }], harness, env: seal.environment, cases: seal.cases[layout] };
    const jobFile = path.join(job.consumer, 'job.json'); put(jobFile, job); job.jobHash = (await description(jobFile)).sha256; jobs.push(job);
  }
  const before = await inventory(work);
  put(path.join(run, 'LOAD-SEAL.json'), { candidate: seal.candidate, sourceTree: seal.sourceTree, packageSha256: seal.packageSha256, sourceInputsVerified: 274, fullPackageFilesPerLayout: 882, expandedArchiveBytes: expanded, archiveFilesAuthenticated: seen.size, jobs: jobs.map(job => ({ layout: job.layout, consumer: job.consumer, product: job.product, jobHash: job.jobHash, harness: job.harness })), work: before, productLoads: 0 }, 0o600, true);
  for (const job of jobs) {
    assert.ok(performance.now() - started < 500000, 'remaining cleanup budget');
    await child(job, seal.node.path, seal.environment);
    same(await inventory(work), before, 'all owned files and new-entry postguard');
  }
  for (const [name, expected] of Object.entries(seal.inputs)) same(await description(path.join(repository, name)), expected, name);
  for (const [name, expected] of Object.entries(seal.files)) same(await description(path.join(own, name)), expected, name);
  complete = true;
} catch (error) { primary = error?.stack ?? String(error); }
finally {
  if (active) { active.kill('SIGKILL'); await new Promise(resolve => active.once('close', resolve)); active = undefined; }
  for (const stream of archiveStreams) stream.destroy();
  await Promise.allSettled(archiveStreams.map(stream => finished(stream)));
  for (const descriptor of archiveDescriptors) fs.closeSync(descriptor);
  archiveDescriptors.clear();
  let removed = false;
  if (workIdentity && fs.existsSync(work)) {
    const stat = fs.lstatSync(work); assert.equal(stat.ino, workIdentity.ino); assert.equal(stat.dev, workIdentity.dev);
    fs.rmSync(work, { recursive: true }); removed = !fs.existsSync(work);
  }
  const result = { schema: 'AP753-U12-L07-result-v1', complete, primary, evidence, receipts, ownedProcesses: 1 + receipts.length, peakTotal: receipts.length ? 2 : 1, knownRetired: receipts.every(row => row.closeObserved && row.absent), scratchRemoved: removed, combinedCaptureBeforeResult: combined, elapsedMs: performance.now() - started };
  put(path.join(run, 'RESULT.json'), result, 0o600, true);
  event({ kind: 'finished', complete, ownedProcesses: result.ownedProcesses, knownRetired: result.knownRetired, scratchRemoved: removed, combinedCapture: combined });
  fs.closeSync(eventFd);
  console.log(JSON.stringify({ complete, primary, cases: evidence.flatMap(row => row.records.filter(record => record.kind === 'case').map(record => ({ layout: row.layout, id: record.id, status: record.status }))), ownedProcesses: result.ownedProcesses, peakTotal: result.peakTotal, knownRetired: result.knownRetired, scratchRemoved: removed, combinedCapture: combined }));
  process.exitCode = complete ? 0 : 91;
}
