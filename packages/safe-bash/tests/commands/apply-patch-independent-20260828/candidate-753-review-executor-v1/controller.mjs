import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sha, json, describe, inventory, absent, ownEqual } from './common.mjs';
import { batchObjects, parseTree, treeHash, objectId } from './path-bytes.mjs';
import { referencePackage } from './package-data.mjs';
import { verifyComposition } from './composition.mjs';

const started = performance.now();
const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, '../../../..');
const review = path.dirname(own);
const runRoot = path.join(own, 'attempt-01');
assert.equal(fs.existsSync(runRoot), false, 'attempt collision STOP');
fs.mkdirSync(runRoot, { mode: 0o700 }); assert.equal(fs.realpathSync(runRoot), runRoot);
const runIdentity = fs.lstatSync(runRoot);
const journalPath = path.join(runRoot, 'OWNER-EVENTS.jsonl');
const journal = fs.openSync(journalPath, 'wx', 0o600);
const ownerStreams = Object.fromEntries(['stdout', 'stderr'].map(channel => [channel, fs.openSync(path.join(runRoot, `OWNER.${channel}.raw`), 'wx', 0o600)]));
const evidenceMembers = new Set(['OWNER-EVENTS.jsonl', 'OWNER.stdout.raw', 'OWNER.stderr.raw']);
const work = path.join(runRoot, 'work');
const clock = () => performance.now() - started;
let workIdentity; let active; let primarySelected = false; let primary; let seal; let runtimeCommit; let runtimeBindings; let guardLink;
let persisted = 0; let rawBytes = 0; let workCharged = 16 * 1024 * 1024; let spawned = 0; let peak = 1;
let ownerStreamsClosed = false; let ownerStreamBytes = 0;
const receipts = []; const completedJobs = []; const observations = [];
const [sourceCommit, sealHash] = process.argv.slice(2);
const fault = reason => ({ type: typeof reason, name: reason?.name ?? null, message: reason?.message ?? String(reason), code: reason?.code ?? null, stack: reason?.stack ?? null });
const select = reason => { if (!primarySelected) { primarySelected = true; primary = reason; } };
function writeAll(descriptor, bytes, reserve = 16384) {
  assert.ok(persisted + bytes.length + reserve <= 128 * 1024 * 1024, 'combined raw/observer/artifact capture STOP');
  let offset = 0;
  while (offset < bytes.length) { const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert.ok(written > 0); offset += written; persisted += written; }
}
function event(record) { writeAll(journal, Buffer.from(JSON.stringify({ elapsedMs: clock(), ...record }) + '\n')); fs.fsyncSync(journal); }
function emit(channel, record) {
  const bytes = Buffer.from(JSON.stringify(record) + '\n'); assert.ok(bytes.length <= 16384);
  if (!ownerStreamsClosed) { writeAll(ownerStreams[channel], bytes); fs.fsyncSync(ownerStreams[channel]); ownerStreamBytes += bytes.length; }
  process[channel].write(bytes);
}
function put(filename, body, capture = false) {
  const bytes = Buffer.isBuffer(body) ? body : typeof body === 'string' ? Buffer.from(body) : json(body);
  assert.ok(bytes.length <= 32 * 1024 * 1024, 'single publication cap');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  if (!capture) { workCharged += bytes.length; assert.ok(workCharged <= 512 * 1024 * 1024, 'working admission STOP'); }
  const descriptor = fs.openSync(filename, 'wx', 0o644);
  try { if (capture) writeAll(descriptor, bytes); else fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  assert.equal(describe(filename).sha256, sha(bytes));
  if (capture && filename.startsWith(runRoot + '/')) evidenceMembers.add(path.relative(runRoot, filename));
  return describe(filename);
}
function environment(extra = {}) {
  return Object.fromEntries(Object.entries({ __CF_USER_TEXT_ENCODING: '0x1F5:0x0:0x0', PATH: '/Users/kjopek/.nvm/versions/node/v22.22.2/bin:/usr/bin:/bin', HOME: path.join(work, 'home'), TMPDIR: path.join(work, 'tmp'), NO_COLOR: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', ...extra }).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}
function integrity(label) {
  assert.equal(sha(fs.readFileSync(path.join(own, 'PRESEAL.json'))), sealHash);
  for (const [name, expected] of Object.entries(seal.files)) assert.deepEqual(describe(path.join(own, name)), expected, name);
  const allowed = [...Object.keys(seal.files), 'PRESEAL.json', 'ROOT-GO.json', 'attempt-01', ...(runtimeCommit || fs.existsSync(path.join(own, 'BUILD-RECEIPT.json')) ? ['BUILD-RECEIPT.json', 'RUNTIME-SEAL.json'] : [])].sort();
  assert.deepEqual(fs.readdirSync(own).sort(), allowed, 'append-aware executor membership STOP');
  for (const [name, expected] of Object.entries(seal.sourceBindings)) assert.deepEqual(describe(path.join(repository, name)), expected, name);
  for (const tool of [seal.node, seal.git]) { const { path: filename, ...expected } = tool; assert.deepEqual(describe(filename), expected, filename); }
  for (const tool of seal.tools) assert.deepEqual(inventory(path.join(repository, tool.directory), 128 * 1024 * 1024), tool.entries, tool.directory);
  for (const [name, expected] of Object.entries(runtimeBindings ?? {})) assert.deepEqual(describe(path.join(own, name)), expected, name);
  event({ kind: 'integrity', label, executorAppendAware: true, externalNamedBindingsOnly: true });
}
async function child(plan, executable, args, cwd, input, extraEnv) {
  assert.equal(active, undefined, 'flat occupied lease STOP');
  assert.ok(!receipts.some(row => row.id === plan.id), 'no retries');
  assert.ok(spawned + 1 + 1 <= 70, 'all-owned process admission STOP');
  assert.ok(clock() + plan.timeoutMs + 32500 <= 6600000, 'remaining execution/cleanup budget STOP');
  assert.ok(persisted + plan.maxBytes + 16 * 1024 * 1024 <= 128 * 1024 * 1024, 'combined capture reserve STOP');
  const receipt = { id: plan.id, role: plan.role, executable, args, cwd, env: environment(extraEnv), timeoutMs: plan.timeoutMs, maxCombinedBytes: plan.maxBytes, pid: null, closeObserved: false, absent: false, code: null, signal: null, failure: null };
  const channels = {};
  for (const channel of ['stdout', 'stderr']) {
    const name = `${String(receipts.length + 1).padStart(2, '0')}-${plan.id}.${channel}.raw`;
    const descriptor = fs.openSync(path.join(runRoot, name), 'wx', 0o600); evidenceMembers.add(name);
    channels[channel] = { descriptor, name, chunks: [], bytes: 0, observedBytes: 0 };
  }
  active = receipt;
  event({ kind: 'capture-owner-enrolled-before-spawn', id: plan.id, ownerPid: process.pid, captureFiles: Object.values(channels).map(row => row.name) });
  let handle; let closeResolve; let hardResolve; let killTimer; let unknownTimer;
  const closed = new Promise(resolve => { closeResolve = resolve; }); const hard = new Promise(resolve => { hardResolve = resolve; });
  function stop(reason) {
    receipt.failure ??= fault(reason);
    if (handle?.pid && !receipt.closeObserved) {
      try { handle.kill('SIGTERM'); } catch (error) { receipt.termFailure = fault(error); }
      killTimer ??= setTimeout(() => { if (!receipt.closeObserved) try { handle.kill('SIGKILL'); } catch (error) { receipt.killFailure = fault(error); } }, 200);
    }
    unknownTimer ??= setTimeout(() => hardResolve(), 2500);
  }
  const timeout = setTimeout(() => stop(new Error('child timeout STOP')), plan.timeoutMs);
  function receive(channel, fragment) {
    channels[channel].observedBytes += fragment.length;
    try {
      assert.ok(channels.stdout.bytes + channels.stderr.bytes + fragment.length <= plan.maxBytes, 'child combined capture STOP');
      const owned = Buffer.from(fragment); writeAll(channels[channel].descriptor, owned);
      channels[channel].chunks.push(owned); channels[channel].bytes += owned.length; rawBytes += owned.length;
    } catch (error) { stop(error); }
  }
  try {
    handle = spawn(executable, args, { cwd, env: receipt.env, stdio: ['pipe', 'pipe', 'pipe'], detached: false });
    if (handle.pid) { receipt.pid = handle.pid; spawned++; peak = Math.max(peak, 2); }
    event({ kind: 'spawn', id: plan.id, pid: receipt.pid, allOwnedAdmitted: spawned + 1, totalPeak: peak });
    handle.on('error', stop); handle.stdin.on('error', stop); handle.stdout.on('error', stop); handle.stderr.on('error', stop);
    handle.stdout.on('data', bytes => receive('stdout', bytes)); handle.stderr.on('data', bytes => receive('stderr', bytes));
    handle.once('close', (code, signal) => { receipt.closeObserved = true; receipt.code = code; receipt.signal = signal; closeResolve(); });
    handle.stdin.end(input);
    await Promise.race([closed, hard]);
  } catch (reason) { stop(reason); if (handle) await Promise.race([closed, hard]); }
  finally {
    clearTimeout(timeout); clearTimeout(killTimer); clearTimeout(unknownTimer);
    for (const [channel, state] of Object.entries(channels)) {
      fs.fsyncSync(state.descriptor); fs.closeSync(state.descriptor);
      receipt[channel] = { path: state.name, ...describe(path.join(runRoot, state.name)), observedBytes: state.observedBytes };
      receipt[channel].lostBytes = state.observedBytes - receipt[channel].bytes;
      assert.ok(receipt[channel].lostBytes >= 0);
    }
    receipt.absent = receipt.closeObserved && absent(receipt.pid);
    if (receipt.absent) active = undefined;
    else { receipt.failure ??= fault(new Error('unknown child retirement STOP')); handle?.unref(); handle?.stdin.destroy(); handle?.stdout.destroy(); handle?.stderr.destroy(); }
    receipts.push(receipt); put(path.join(runRoot, `${String(receipts.length).padStart(2, '0')}-${plan.id}.receipt.json`), receipt, true);
  }
  assert.equal(receipt.failure, null, JSON.stringify(receipt.failure)); assert.equal(receipt.signal, null); assert.equal(receipt.absent, true);
  const stdout = Buffer.concat(channels.stdout.chunks); const stderr = Buffer.concat(channels.stderr.chunks);
  assert.equal(sha(stdout), receipt.stdout.sha256); assert.equal(sha(stderr), receipt.stderr.sha256);
  event({ kind: 'known-retirement', id: plan.id, code: receipt.code, pid: receipt.pid, combinedBytes: stdout.length + stderr.length });
  emit('stdout', { id: plan.id, code: receipt.code, bytes: stdout.length + stderr.length, closed: true, elapsedMs: clock() });
  return { ...receipt, stdout, stderr };
}
const gitPrefix = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'commit.gpgsign=false', '-c', 'core.abbrev=40', '--no-replace-objects'];
async function git(id, args, input, planned) {
  const run = await child(planned ?? { id, role: 'runtime-seal-git', timeoutMs: 30000, maxBytes: 16 * 1024 * 1024 }, seal.git.path, [...gitPrefix, ...args], repository, input);
  assert.equal(run.code, 0, run.stderr.toString()); return run.stdout;
}
function packageInventory(root) { return Object.fromEntries(Object.entries(inventory(root)).filter(([name]) => name === 'package.json' || name === 'README.md' || name.startsWith('dist/'))); }
function copyPackage(files, destination, changes = {}) {
  assert.equal(fs.existsSync(destination), false); fs.mkdirSync(destination, { recursive: true });
  for (const [name, bytes] of files) put(path.join(destination, name), Object.hasOwn(changes, name) ? changes[name] : bytes);
  return packageInventory(destination);
}
function wireConsumer(directory, product, mockJs) {
  fs.mkdirSync(directory, { recursive: true });
  for (const name of ['bootstrap.mjs', 'loader.mjs', 'dispatch.mjs', 'legacy.mjs', 's54.mjs']) put(path.join(directory, name), fs.readFileSync(path.join(own, name)));
  for (const name of ['ORIGINAL32-v1.json', 'SUPPLEMENT-v1.json']) put(path.join(directory, name), fs.readFileSync(path.join(review, 'matrix', name)));
  put(path.join(directory, 'author.mjs'), fs.readFileSync(path.join(repository, 'tests/commands/apply-patch-author-20260828/probe.mjs')));
  put(path.join(directory, 'CASES-v1.json'), fs.readFileSync(path.join(repository, 'tests/commands/apply-patch-author-20260828/CASES-v1.json')));
  const relative = './' + path.relative(directory, path.join(product, 'dist/fs/webdav/resource-id.js')).split(path.sep).join('/');
  const needle = '"../../../src/fs/webdav/resource-id.js"'; assert.equal(mockJs.split(needle).length, 2);
  put(path.join(directory, 'mock.mjs'), mockJs.replace(needle, JSON.stringify(relative)));
  put(path.join(directory, 'package.json'), { name: `independent-ap753-${path.basename(directory)}`, private: true, type: 'module' });
}
async function archiveWork() {
  if (!workIdentity || !fs.existsSync(work)) return null;
  const before = inventory(work); put(path.join(runRoot, 'WORK-MEMBERSHIP.json'), before, true);
  const name = 'WORK-CAPTURE.jsonl.gz'; const descriptor = fs.openSync(path.join(runRoot, name), 'wx', 0o600); evidenceMembers.add(name);
  async function* records() {
    for (const [name, entry] of Object.entries(before)) {
      if (entry.kind !== 'file') continue;
      const input = fs.openSync(path.join(work, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const chunk = Buffer.alloc(65536); let offset = 0;
      try { for (;;) { const length = fs.readSync(input, chunk, 0, chunk.length, null); if (!length) break; yield Buffer.from(JSON.stringify({ name, offset, total: entry.bytes, base64: chunk.subarray(0, length).toString('base64') }) + '\n'); offset += length; } assert.equal(offset, entry.bytes); }
      finally { fs.closeSync(input); }
    }
  }
  const sink = new Writable({ write(chunk, encoding, callback) { try { writeAll(descriptor, chunk); callback(); } catch (error) { callback(error); } } });
  try {
    await pipeline(Readable.from(records()), createGzip({ level: 6 }), sink, { signal: AbortSignal.timeout(Math.max(1, Math.min(30000, Math.floor(6600000 - clock() - 2000)))) });
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  assert.deepEqual(inventory(work), before);
  const identity = fs.lstatSync(work); assert.equal(identity.ino, workIdentity.ino); assert.equal(identity.dev, workIdentity.dev);
  fs.rmSync(work, { recursive: true }); assert.equal(fs.existsSync(work), false);
  return { files: Object.values(before).filter(entry => entry.kind === 'file').length, logicalBytes: Object.values(before).reduce((total, entry) => total + (entry.bytes ?? 0), 0), archive: describe(path.join(runRoot, name)), removed: true };
}

let cleanup;
try {
  event({ kind: 'outer-startup-capture', ownerPid: process.pid, sourceCommit, sealHash, environment: Object.fromEntries(Object.entries(process.env).sort()) });
  assert.match(sourceCommit, /^[0-9a-f]{40}$/); assert.match(sealHash, /^[0-9a-f]{64}$/);
  assert.equal(sha(fs.readFileSync(path.join(own, 'PRESEAL.json'))), sealHash); seal = JSON.parse(fs.readFileSync(path.join(own, 'PRESEAL.json')));
  assert.deepEqual(Object.fromEntries(Object.entries(process.env).sort()), seal.finitePlatformEnvironment);
  assert.equal(process.execPath, seal.node.path); assert.equal(process.version, 'v22.22.2');
  const grant = JSON.parse(fs.readFileSync(path.join(own, 'ROOT-GO.json')));
  assert.deepEqual(Object.keys(grant), ['binding', 'command', 'cwd', 'login', 'authority', 'historicalIntegrity']);
  assert.equal(typeof grant.authority, 'string'); assert.equal(typeof grant.historicalIntegrity, 'string');
  assert.ok(ownEqual(grant.binding, { authorization: 'ROOT AP753 ONE REVIEW', attempt: 1, candidate: seal.candidate, sealSha256: sealHash, sourceCommit }));
  assert.equal(grant.command, `exec -c ${seal.node.path} --no-warnings ${path.join(own, 'controller.mjs')} ${sourceCommit} ${sealHash}`);
  assert.equal(grant.login, false); assert.equal(grant.cwd, repository);
  integrity('before-first-child');
  fs.mkdirSync(work, { mode: 0o700 }); assert.equal(fs.realpathSync(work), work); workIdentity = fs.lstatSync(work);
  for (const name of ['home', 'tmp']) fs.mkdirSync(path.join(work, name));
  const binding = JSON.parse(fs.readFileSync(path.join(own, 'BINDINGS.json')));
  assert.equal(sha(JSON.stringify(binding.selectedInputs)), binding.selectedManifestSha256);
  const expectedPackage = JSON.parse(fs.readFileSync(path.join(own, 'PACKAGE-INVENTORY.json')));
  const source = path.join(work, 'source'); fs.mkdirSync(source);
  const requests = [...new Set([binding.candidate, sourceCommit, ...binding.selectedInputs.map(entry => entry.blob), ...binding.ancestorInputs.map(entry => entry.oid)])];
  const raw = await git('source-metadata', ['cat-file', '--batch'], requests.join('\n') + '\n', seal.jobs.find(job => job.id === 'source-metadata'));
  const objects = batchObjects(raw, requests);
  assert.equal(objects.get(binding.candidate).kind, 'commit'); assert.equal(sha(objects.get(binding.candidate).payload), binding.candidateCommitPayloadSha256);
  assert.equal(objects.get(sourceCommit).kind, 'commit');
  const presealRaw = await git('preseal-tree', ['ls-tree', '-rz', '--full-tree', sourceCommit, '--', path.relative(repository, own)]);
  const presealEntries = parseTree(presealRaw);
  const expectedOwn = [...Object.keys(seal.files), 'PRESEAL.json'].map(name => path.relative(repository, path.join(own, name))).sort();
  assert.deepEqual(presealEntries.map(entry => entry.path).sort(), expectedOwn);
  for (const entry of presealEntries) { assert.equal(entry.mode, '100644'); assert.equal(entry.blob, objectId('blob', fs.readFileSync(path.join(repository, entry.path)))); }
  const moduleRaw = await git('candidate-module-tree', ['ls-tree', '-rz', '--full-tree', binding.candidate, '--', 'src/commands/apply-patch']);
  const moduleEntries = parseTree(moduleRaw); const moduleInputs = binding.selectedInputs.filter(entry => entry.path.startsWith('src/commands/apply-patch/'));
  assert.equal(moduleEntries.length, 6);
  for (const entry of moduleEntries) { const expected = moduleInputs.find(row => row.path === entry.path); assert.ok(expected); assert.equal(entry.blob, expected.blob); assert.equal(entry.mode, expected.mode); }
  for (const entry of binding.ancestorInputs) { const object = objects.get(entry.oid); assert.equal(object.kind, 'tree'); assert.equal(sha(object.payload), entry.sha256); assert.equal(object.payload.toString('base64'), entry.rawBase64); }
  const baseInventory = Buffer.from(binding.baseSourceInventory.base64, 'base64'); assert.equal(sha(baseInventory), binding.baseSourceInventory.sha256); parseTree(baseInventory);
  for (const entry of binding.derivedTrees) { const bytes = Buffer.from(entry.rawBase64, 'base64'); assert.equal(objectId('tree', bytes), entry.oid); assert.equal(sha(bytes), entry.sha256); }
  assert.equal(binding.derivedTrees.at(-1).oid, seal.selectedTree);
  observations.push({ id: 'derived-composition', ...verifyComposition(binding) });
  assert.equal(treeHash(binding.selectedInputs.filter(entry => entry.path.startsWith('src/')).map(entry => ({ ...entry, path: entry.path.slice(4) }))), binding.derivedTrees.at(-2).oid);
  for (const entry of binding.selectedInputs) {
    assert.equal(Buffer.from(entry.path).toString('base64'), entry.pathBase64); assert.ok(!entry.path.split('/').includes('AGENTS.md'));
    const object = objects.get(entry.blob); assert.equal(object.kind, 'blob'); assert.equal(object.payload.length, entry.bytes); assert.equal(sha(object.payload), entry.sha256);
    put(path.join(source, entry.path), object.payload);
  }
  completedJobs.push('source-metadata');
  const guardRoot = path.join(work, 'guard'); fs.mkdirSync(guardRoot);
  for (const name of ['guard.mjs', 'loader.mjs', 'common.mjs']) put(path.join(guardRoot, name), fs.readFileSync(path.join(own, name)));
  put(path.join(guardRoot, 'package.json'), { name: 'independent-ap753-guard', type: 'module' });
  const inert = 'globalThis.guardEvaluations = (globalThis.guardEvaluations ?? 0) + 1; export const value = 1;\n';
  for (const name of ['positive.js', 'wrong-hash.js', 'wrong-mode.js', 'unbound.js']) put(path.join(guardRoot, name), inert);
  put(path.join(guardRoot, 'regular'), 'owned fixture only\n'); guardLink = path.join(guardRoot, 'link'); fs.symlinkSync('regular', guardLink);
  const guardManifest = Object.fromEntries(['positive.js', 'wrong-hash.js', 'wrong-mode.js'].map(name => [name, { kind: 'file', ...describe(path.join(guardRoot, name)) }]));
  guardManifest['wrong-hash.js'].sha256 = '0'.repeat(64); guardManifest['wrong-mode.js'].mode = 0o444;
  const guardJob = { consumer: guardRoot, graphs: [{ id: 'stub-only', product: guardRoot, manifest: guardManifest }], harness: {}, regular: describe(path.join(guardRoot, 'regular')), env: environment() };
  put(path.join(guardRoot, 'job.json'), guardJob);
  const guardPlan = seal.jobs.find(job => job.id === 'binding-negatives');
  const guardRun = await child(guardPlan, seal.node.path, ['--permission', `--allow-fs-read=${guardRoot}`, '--no-warnings', path.join(guardRoot, 'guard.mjs'), path.join(guardRoot, 'job.json')], guardRoot);
  assert.equal(guardRun.code, 0, guardRun.stderr.toString()); observations.push({ id: guardPlan.id, data: JSON.parse(guardRun.stdout) }); completedJobs.push(guardPlan.id);
  assert.equal(fs.readlinkSync(guardLink), 'regular'); fs.unlinkSync(guardLink); guardLink = undefined;
  const reference = referencePackage(fs.readFileSync(path.join(repository, 'tests/commands/apply-patch-author-20260828/s54-v2/captures/apply-patch-s54-v2-WB7vny.json.gz.base64')), binding.authorPackage, expectedPackage);
  const sourceBefore = inventory(source);
  put(path.join(work, 'build.mjs'), fs.readFileSync(path.join(own, 'build.mjs')));
  const mockInput = path.join(repository, 'tests/fs/webdav/mock.ts');
  const build = await child(seal.jobs.find(job => job.id === 'strict-build'), seal.node.path, [path.join(work, 'build.mjs'), source, path.join(repository, 'node_modules/typescript/lib/typescript.js'), path.join(repository, 'node_modules/@types'), mockInput, path.join(work, 'mock.mjs.data')], work);
  assert.equal(build.code, 0, build.stderr.toString()); completedJobs.push('strict-build');
  assert.deepEqual(Object.fromEntries(Object.entries(inventory(source)).filter(([name]) => !name.startsWith('dist/'))), sourceBefore);
  const actualPackage = packageInventory(source); assert.deepEqual(actualPackage, expectedPackage, 'fresh full882 must equal authenticated author reference member bytes and modes');
  const packageJson = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) assert.equal(Object.keys(packageJson[key] ?? {}).length, 0);
  const mockJs = fs.readFileSync(path.join(work, 'mock.mjs.data'), 'utf8');
  const consumers = {};
  const sourceConsumer = path.join(work, 'source-consumer'); wireConsumer(sourceConsumer, source, mockJs); consumers.source = { directory: sourceConsumer, product: source };
  for (const layout of ['installed', 'moved']) {
    const origin = path.join(work, layout === 'moved' ? 'relocation-origin' : 'installed'); const product = path.join(origin, 'node_modules/virtual-bash');
    copyPackage(reference.files, product); wireConsumer(origin, product, mockJs);
    if (layout === 'moved') { const destination = path.join(work, 'moved'); const before = inventory(origin); fs.renameSync(origin, destination); assert.equal(fs.existsSync(origin), false); assert.deepEqual(inventory(destination), before); consumers.moved = { directory: destination, product: path.join(destination, 'node_modules/virtual-bash'), originAbsent: origin }; }
    else consumers.installed = { directory: origin, product };
  }
  const frozenVariants = JSON.parse(fs.readFileSync(path.join(own, 'VARIANTS.json')));
  const graphs = [];
  for (const variant of frozenVariants) {
    const product = path.join(work, 'variants', variant.id); const manifest = copyPackage(reference.files, product, variant.changes);
    for (const [name, expected] of Object.entries(variant.bindings)) { const { kind, ...actual } = manifest[name]; assert.deepEqual(actual, expected); }
    graphs.push({ ...variant, changes: undefined, bindings: undefined, product, manifest });
  }
  const runtimeJobs = [];
  for (const planned of seal.jobs.filter(job => !['metadata', 'guard', 'build'].includes(job.role))) {
    const layout = planned.layout ?? 'source'; const consumer = consumers[layout];
    if (planned.role === 'type') {
      const internal = './' + path.relative(consumer.directory, path.join(consumer.product, 'dist/commands/apply-patch/index.js')).split(path.sep).join('/');
      const root = './' + path.relative(consumer.directory, path.join(consumer.product, 'dist/index.js')).split(path.sep).join('/');
      const positive = `import { createApplyPatchCommand, createApplyPatchCommands, applyPatchCommands } from ${JSON.stringify(internal)};\nconst command = createApplyPatchCommand(); const commands = createApplyPatchCommands(); const plugin = applyPatchCommands(); void [command, commands, plugin];\n`;
      const variants = { positive: [positive, 0], 'bad-value': [positive + 'createApplyPatchCommand({ limits: { maxPatchBytes: "wrong" } });\n', 2, 'TS2322'], 'bad-value-repair': [positive + 'createApplyPatchCommand();\n', 0], 'root-negative': [`import {createApplyPatchCommand} from ${JSON.stringify(root)}; void createApplyPatchCommand;\n`, 2, 'TS2305'], 'root-repair': [positive, 0] };
      const [body, code, diagnostic] = variants[planned.variant]; const filename = path.join(consumer.directory, `consumer-${layout}-${planned.variant}.mts`); put(filename, body);
      runtimeJobs.push({ ...planned, consumer, filename, code, diagnostic, binding: describe(filename) }); continue;
    }
    const fixtureRoot = path.join(consumer.directory, `fixtures-${planned.id}`); fs.mkdirSync(fixtureRoot);
    const selectedGraphs = [{ id: 'base', product: consumer.product, manifest: actualPackage }, ...(planned.role === 'original-mutant' ? graphs.filter(graph => graph.family === planned.mutant) : planned.role === 'instrumented-s54' ? graphs.filter(graph => graph.instrumented) : [])];
    const harness = Object.fromEntries(['bootstrap.mjs', 'loader.mjs', 'dispatch.mjs', 'legacy.mjs', 's54.mjs', 'author.mjs', 'mock.mjs', 'ORIGINAL32-v1.json', 'SUPPLEMENT-v1.json', 'CASES-v1.json', 'package.json'].map(name => [name, describe(path.join(consumer.directory, name))]));
    const job = { ...planned, schema: 'AP753-job-v1', layout, consumer: consumer.directory, product: consumer.product, fixtureRoot, graphs: selectedGraphs, harness, env: environment(), ...(planned.role === 'fixture-tail' ? { versioned: true, rows: JSON.parse(fs.readFileSync(path.join(own, 'VERSIONED-ROWS.json'))) } : {}) };
    const filename = path.join(consumer.directory, `job-${planned.id}.json`); put(filename, job);
    runtimeJobs.push({ ...planned, consumer, filename, job, binding: describe(filename) });
  }
  const sourceFrozen = inventory(source);
  const consumerInventories = Object.fromEntries(Object.entries(consumers).map(([layout, consumer]) => [layout, inventory(consumer.directory)]));
  const runtimeSeal = { schema: 'AP753-runtime-seal-v1', sourceCommit, presealSha256: sealHash, candidate: binding.candidate, sourceTree: binding.newSelectedDerivedTree, sourceBefore, sourceAfter: sourceFrozen, packageInventory: actualPackage, packageSha256: binding.authorPackage.tarballClaim.sha256, consumers, consumerInventories, jobs: runtimeJobs, graphBindings: graphs.map(({ product, manifest, id }) => ({ id, product, manifest })), productLoadsBeforeThisSeal: 0, movedOriginAbsent: consumers.moved.originAbsent };
  put(path.join(own, 'BUILD-RECEIPT.json'), { sourceCommit, candidate: binding.candidate, compiler: build.id, compilerStdout: build.stdout.toString(), declarations: Object.keys(actualPackage).filter(name => name.endsWith('.d.ts')), fileCount: 882, packageInventorySha256: sha(JSON.stringify(actualPackage)), independentTarRead: true, runtimeLoads: 0 }, true);
  put(path.join(own, 'RUNTIME-SEAL.json'), runtimeSeal, true);
  runtimeBindings = Object.fromEntries(seal.runtimeSealPaths.map(name => [name, describe(path.join(own, name))]));
  const runtimePaths = seal.runtimeSealPaths.map(name => path.relative(repository, path.join(own, name)));
  await git('runtime-add', ['add', '--', ...runtimePaths]);
  const commitOutput = await git('runtime-commit', ['commit', '--only', '-m', 'test: freeze apply-patch753 actual built review graphs', '--', ...runtimePaths]);
  const match = /^\[[^\n]* ([0-9a-f]{40})\]/m.exec(commitOutput.toString()); assert.ok(match, 'exact runtime commit receipt'); runtimeCommit = match[1];
  const treeRaw = await git('runtime-tree', ['ls-tree', '-rz', '--full-tree', runtimeCommit, '--', ...runtimePaths]);
  const entries = parseTree(treeRaw); assert.equal(entries.length, 2);
  for (const name of runtimePaths) { const entry = entries.find(row => row.path === name); assert.ok(entry); assert.equal(entry.mode, '100644'); assert.equal(entry.blob, objectId('blob', fs.readFileSync(path.join(repository, name)))); }
  const runtimeRequests = [runtimeCommit, ...entries.map(entry => entry.blob)]; const runtimeRaw = await git('runtime-objects', ['cat-file', '--batch'], runtimeRequests.join('\n') + '\n');
  const committed = batchObjects(runtimeRaw, runtimeRequests); assert.equal(committed.get(runtimeCommit).kind, 'commit');
  for (const entry of entries) assert.equal(sha(committed.get(entry.blob).payload), describe(path.join(repository, entry.path)).sha256);
  put(path.join(runRoot, 'RUNTIME-ADMISSION.json'), { runtimeCommit, paths: entries.map(({ pathBytes, ...entry }) => entry), presealSha256: sealHash, candidate: binding.candidate, productLoadsBefore: 0 }, true);
  integrity('committed-runtime-seal-before-loads');
  for (const planned of runtimeJobs) {
    assert.deepEqual(describe(planned.filename), planned.binding); assert.deepEqual(inventory(source), sourceFrozen);
    const before = inventory(planned.consumer.directory); const productBefore = packageInventory(planned.consumer.product);
    const layout = planned.layout ?? 'source';
    const fixtureNames = runtimeJobs.filter(row => row.job && row.consumer.directory === planned.consumer.directory).map(row => path.basename(row.job.fixtureRoot) + '/');
    const immutable = census => Object.fromEntries(Object.entries(census).filter(([name]) => !fixtureNames.some(prefix => name.startsWith(prefix))));
    assert.deepEqual(immutable(before), immutable(consumerInventories[layout]), 'committed consumer preguard');
    for (const [name, expected] of Object.entries(planned.job?.harness ?? {})) assert.deepEqual(describe(path.join(planned.consumer.directory, name)), expected, `bootstrap/harness preguard ${name}`);
    if (planned.consumer.originAbsent) assert.equal(fs.existsSync(planned.consumer.originAbsent), false);
    for (const graph of planned.job?.graphs ?? []) assert.deepEqual(packageInventory(graph.product), graph.manifest, `graph preguard ${graph.id}`);
    let run;
    if (planned.role === 'type') {
      run = await child(planned, seal.node.path, [path.join(repository, 'node_modules/typescript/bin/tsc'), '--noEmit', '--listFiles', '--strict', '--exactOptionalPropertyTypes', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--types', 'node', '--typeRoots', path.join(repository, 'node_modules/@types'), planned.filename], planned.consumer.directory);
      const paths = run.stdout.toString().split('\n').filter(line => line.startsWith(planned.consumer.product) && line.endsWith('.d.ts'));
      const required = planned.variant === 'root-negative' ? 'dist/index.d.ts' : 'dist/commands/apply-patch/index.d.ts';
      observations.push({ id: planned.id, role: 'type', code: run.code, expectedCode: planned.code, diagnostic: planned.diagnostic ?? null, pass: run.code === planned.code && (!planned.diagnostic || run.stdout.includes(planned.diagnostic)) && paths.includes(path.join(planned.consumer.product, required)), declarations: paths });
    } else {
      const reads = [...new Set([planned.consumer.directory, ...planned.job.graphs.map(graph => graph.product)])];
      run = await child(planned, seal.node.path, ['--permission', ...reads.map(root => `--allow-fs-read=${root}`), `--allow-fs-write=${planned.job.fixtureRoot}`, '--max-old-space-size=256', '--no-warnings', path.join(planned.consumer.directory, 'bootstrap.mjs'), planned.filename], planned.consumer.directory);
      assert.ok(run.code === 0 || run.code === 1, `unsafe product bootstrap/code ${run.code}: ${run.stderr.toString()}`);
      const records = run.stdout.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line)); const final = records.at(-1);
      assert.equal(final.kind, 'final'); assert.equal(final.job, planned.id); assert.equal(final.role, planned.role); assert.equal(final.complete, true); assert.equal(final.unhandled, 0);
      for (const name of ['index', 'apply', 'parser', 'matcher', 'shared', 'options']) assert.ok(final.loads.some(load => load.relative === `dist/commands/apply-patch/${name}.js`), name);
      observations.push({ id: planned.id, final });
    }
    assert.deepEqual(inventory(source), sourceFrozen); assert.deepEqual(packageInventory(planned.consumer.product), productBefore);
    assert.deepEqual(immutable(inventory(planned.consumer.directory)), immutable(consumerInventories[layout]), 'committed consumer postguard');
    for (const graph of planned.job?.graphs ?? []) assert.deepEqual(packageInventory(graph.product), graph.manifest, `graph postguard ${graph.id}`);
    const excludeFixture = name => !name.startsWith(`fixtures-${planned.id}/`);
    assert.deepEqual(Object.fromEntries(Object.entries(inventory(planned.consumer.directory)).filter(([name]) => excludeFixture(name))), Object.fromEntries(Object.entries(before).filter(([name]) => excludeFixture(name))));
    completedJobs.push(planned.id); integrity(`after-${planned.id}`);
  }
  assert.equal(completedJobs.length, 54); assert.equal(new Set(completedJobs).size, 54);
} catch (reason) { select(reason); try { event({ kind: 'STOP', reason: fault(reason), completedJobs }); } catch {} }
finally {
  try {
    if (active) throw new Error('unknown retirement: retain owned working tree');
    if (guardLink) {
      assert.equal(guardLink, path.join(work, 'guard/link')); assert.ok(fs.lstatSync(guardLink).isSymbolicLink()); assert.equal(fs.readlinkSync(guardLink), 'regular');
      put(path.join(runRoot, 'OUTER-LINK-RETIREMENT.json'), { path: guardLink, target: 'regular', regular: describe(path.join(work, 'guard/regular')) }, true);
      fs.unlinkSync(guardLink); guardLink = undefined;
    }
    cleanup = await archiveWork();
  }
  catch (reason) { select(reason); cleanup = { failed: fault(reason), scratchRetained: fs.existsSync(work) }; }
  try {
    if (seal) integrity('final');
    const outcome = { schema: 'AP753-review-outcome-v1', status: primarySelected ? 'HOLD' : 'COMPLETED_ASSERTIONS_REQUIRE_REVIEW', primary: primarySelected ? fault(primary) : null, sourceCommit, sealHash, runtimeCommit: runtimeCommit ?? null, candidate: seal?.candidate ?? null, completedJobs, plannedJobs: 54, observations, allOwnedAdmitted: spawned + 1, children: spawned, totalPeak: peak, targetFlatPeak: peak, combinedCapturedBytesBeforeOutcome: persisted, rawBytes, clockMs: clock(), cleanup, knownRetired: receipts.every(receipt => receipt.absent && receipt.closeObserved), active: active?.pid ?? null, receipts };
    put(path.join(runRoot, 'OUTCOME.json'), outcome, true);
    event({ kind: 'terminal', status: outcome.status, allOwnedAdmitted: spawned + 1, totalPeak: peak, targetFlatPeak: peak, completed: completedJobs.length, combinedCaptureBytes: persisted });
    emit('stdout', { status: outcome.status, completed: completedJobs.length, planned: 54, allOwnedAdmitted: spawned + 1, totalPeak: peak, rawBytes, ownerStreamBytesBeforeTerminal: ownerStreamBytes, combinedCaptureBytesBeforeTerminalAndIndex: persisted, elapsedMs: clock(), outcomeSha256: describe(path.join(runRoot, 'OUTCOME.json')).sha256, failure: outcome.primary });
    for (const descriptor of Object.values(ownerStreams)) { fs.fsyncSync(descriptor); fs.closeSync(descriptor); } ownerStreamsClosed = true;
    fs.fsyncSync(journal); fs.closeSync(journal);
    const current = fs.lstatSync(runRoot); assert.equal(current.ino, runIdentity.ino); assert.equal(current.dev, runIdentity.dev);
    const retainedScratch = fs.existsSync(work) ? { path: 'work', kind: 'retained-owned-scratch-not-capture', dev: workIdentity?.dev, ino: workIdentity?.ino, unsafe: true } : null;
    assert.deepEqual(fs.readdirSync(runRoot).sort(), [...evidenceMembers, ...(retainedScratch ? ['work'] : [])].sort());
    const members = Object.fromEntries([...evidenceMembers].sort().map(name => [name, describe(path.join(runRoot, name))]));
    put(path.join(runRoot, 'CAPTURE-MEMBERSHIP.json'), { schema: 'exact-regular-capture-membership-v1', members, retainedScratch, externalRecords: runtimeBindings ?? {}, totalBytes: Object.values(members).reduce((total, entry) => total + entry.bytes, 0), combinedAccountedBeforeIndex: persisted }, true);
  } catch (reason) { select(reason); emit('stderr', { status: 'TERMINAL_CAPTURE_FAILURE', reason: fault(reason), primary: fault(primary) }); }
  process.exitCode = primarySelected ? 1 : 0;
}
