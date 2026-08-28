import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sha, readJson, writeJson, inventory, directory, originalDirectory, repository, bounds, requireGrant, runtimeFiles, ids, requireCleanSafety, reserveWorkerStarts, settleWorkerStarts, terminalReceiptBytes, accountTerminal } from './admission.mjs';
import { authenticateArchive } from './source-auth.mjs';

const sealPath = path.join(directory, 'PREPARATION-SEAL-v3.json');
const arguments_ = process.argv.slice(2);
assert.deepEqual(arguments_, ['--grant', path.join(directory, 'GO.json'), '--budget', path.join(originalDirectory, 'PARENT-BUDGET.json')], 'EXACT_COMMAND_REQUIRED_NO_SETUP');
const sealBytes = fs.readFileSync(sealPath);
const grantBytes = fs.readFileSync(arguments_[1]);
const grant = JSON.parse(grantBytes);
requireGrant(grant, sealBytes);
assert.deepEqual([process.execPath, ...process.argv.slice(1)], grant.command, 'EXACT_EXECUTABLE_COMMAND_REQUIRED');
assert.equal(fs.realpathSync(process.cwd()), repository);
const seal = JSON.parse(sealBytes);
for (const row of seal.files) assert.equal(sha(fs.readFileSync(path.join(directory, row.path))), row.sha256, row.path);
const parentBudget = readJson(arguments_[3]);
assert.deepEqual(Object.keys(parentBudget).sort(), ['deadlineEpochMs', 'id', 'remaining', 'schema'].sort());
assert.equal(parentBudget.schema, 'exclusive-parent-reservation-v1');
assert.equal(parentBudget.id, 'priority-command-workflows-20260828/future-run-01');
assert.ok(Number.isSafeInteger(parentBudget.deadlineEpochMs));
assert.deepEqual(Object.keys(parentBudget.remaining).sort(), ['children', 'workerStarts', 'loaderThreads', 'captureBytes', 'scratchBytes'].sort());
for (const value of Object.values(parentBudget.remaining)) assert.ok(Number.isSafeInteger(value) && value >= 0);
const started = Date.now(), deadline = Math.min(parentBudget.deadlineEpochMs, started + bounds.windowMs);
assert.ok(deadline > started, 'PARENT_DEADLINE_EXPIRED');
const remaining = structuredClone(parentBudget.remaining);
const storageLimit = Math.min(bounds.scratchBytes, remaining.scratchBytes);
assert.ok(storageLimit > terminalReceiptBytes, 'TERMINAL_RESERVATION_REQUIRED');
const { raw, selected, bindings } = authenticateArchive();
const stored = readJson(path.join(directory, 'SOURCE-AUTH.json'));
assert.equal(stored.packet, grant.packet); assert.equal(stored.composition, grant.composition); assert.equal(stored.pass, true);
assert.equal(stored.selectedInputTableSha256, bindings.selected.selectedInputTableSha256);
assert.equal(stored.archiveSha256, bindings.archive.sha256);
assert.equal(fs.existsSync(grant.root), false, 'EXCLUSIVE_FRESH_ROOT_REQUIRED');
assert.ok(remaining.children >= 100 && remaining.workerStarts >= 372 && remaining.loaderThreads >= 97, 'INSUFFICIENT_RESERVED_PARENT_BUDGET');
const root = grant.root, tools = path.join(root, 'tools'), source = grant.layouts[0].appParent, outside = path.join(root, 'outside');
fs.mkdirSync(root);
for (const name of ['tools', 'source', 'outside', 'home', 'tmp', 'cache', 'receipts', 'admissions', 'logs', 'packs']) fs.mkdirSync(path.join(root, name));
for (const name of ['npmrc', 'global-npmrc']) fs.writeFileSync(path.join(root, name), '', { flag: 'wx' });
const evidence = { role: 'FUTURE_GRANTED_REAL_PUBLIC_API', packet: grant.packet, grantSha256: sha(grantBytes), parentBudget, started, commands: [], rows: [], failures: [], safetyStops: [], tools: {}, source: {}, workerReservations: [], resources: { childStarts: 0, productWorkerStarts: 0, loaderThreadStarts: 0, capturedBytes: 0 }, unexecuted: grant.layouts.flatMap(layout => ids.map(id => `${layout.name}:${id}`)) };
let protectedRoots = [], activeChild;
const copiedNode = path.join(tools, 'node');
const environment = { PATH: `${tools}:/usr/bin:/bin`, HOME: path.join(root, 'home'), TMPDIR: path.join(root, 'tmp'), npm_config_cache: path.join(root, 'cache'), npm_config_userconfig: path.join(root, 'npmrc'), npm_config_globalconfig: path.join(root, 'global-npmrc'), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', NO_COLOR: '1' };
const diskUsage = () => Object.values(inventory(root)).reduce((sum, row) => sum + (row.bytes ?? 0), 0);
const assertStorage = () => assert.ok(diskUsage() <= storageLimit - terminalReceiptBytes, 'SCRATCH_BOUND_WITH_TERMINAL_RESERVATION');
const writeReceipt = (filename, value) => {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  assert.ok(diskUsage() + bytes.length <= storageLimit - terminalReceiptBytes, 'RECEIPT_STORAGE_STOP');
  fs.writeFileSync(filename, bytes, { flag: 'wx' });
  assertStorage(); assert.ok(Date.now() < deadline, 'RECEIPT_DEADLINE_STOP');
};
const logsBytes = logs => logs.reduce((sum, name) => sum + (fs.existsSync(name) ? fs.statSync(name).size : 0), 0);
async function command(label, args, cwd, extraEnv = {}, { setup = false, loader = false, logs = [] } = {}) {
  assert.equal(activeChild, undefined, 'CONCURRENT_CHILD_REFUSED');
  assert.ok(remaining.children > 0 && evidence.resources.childStarts < bounds.children, 'CHILD_BOUND');
  assert.ok(Date.now() < deadline, 'WHOLE_TIME_BOUND'); assertStorage();
  const guards = protectedRoots.map(root => [root, inventory(root)]);
  remaining.children--; evidence.resources.childStarts++;
  if (loader) { assert.ok(remaining.loaderThreads > 0); remaining.loaderThreads--; evidence.resources.loaderThreadStarts++; assert.ok(evidence.resources.loaderThreadStarts <= bounds.loaderThreads); }
  const row = { number: evidence.resources.childStarts, label, executable: copiedNode, args, cwd, environmentRole: 'isolated-explicit-no-ambient', environment: { ...environment, ...extraEnv }, start: Date.now(), stdoutBase64: '', stderrBase64: '', loaderThreadsRequested: loader ? 1 : 0, exitObserved: false, closeObserved: false, emergency: false, errors: [] };
  const output = [], errors = [];
  let captured = 0;
  const child = spawn(copiedNode, args, { cwd, env: row.environment, stdio: ['ignore', 'pipe', 'pipe'] });
  activeChild = child; row.pid = child.pid ?? null;
  const kill = reason => { row.emergency = true; row.errors.push(reason); child.kill('SIGKILL'); };
  const capture = target => bytes => {
    const room = Math.max(0, Math.min(bounds.captureBytes, remaining.captureBytes) - captured);
    target.push(Buffer.from(bytes.subarray(0, room))); captured += Math.min(room, bytes.length);
    if (bytes.length > room) kill('CAPTURE_BOUND');
  };
  child.stdout.on('data', capture(output)); child.stderr.on('data', capture(errors));
  const timer = setTimeout(() => kill('CHILD_WALL_BOUND'), Math.max(1, Math.min(setup ? bounds.setupMs : bounds.runtimeMs, deadline - Date.now())));
  const monitor = setInterval(() => {
    try { assertStorage(); assert.ok(captured + logsBytes(logs) <= Math.min(bounds.captureBytes, remaining.captureBytes), 'CAPTURE_BOUND'); }
    catch (error) { kill(String(error)); }
  }, 100);
  child.on('error', error => row.errors.push(String(error)));
  child.on('exit', (status, signal) => { row.exitObserved = true; row.status = status; row.signal = signal; });
  await new Promise(resolve => child.once('close', (status, signal) => { row.closeObserved = true; row.status = status; row.signal = signal; resolve(); }));
  clearTimeout(timer); clearInterval(monitor); activeChild = undefined;
  row.end = Date.now(); row.stdoutBase64 = Buffer.concat(output).toString('base64'); row.stderrBase64 = Buffer.concat(errors).toString('base64');
  row.capturedBytes = captured + logsBytes(logs); remaining.captureBytes -= row.capturedBytes; evidence.resources.capturedBytes += row.capturedBytes;
  row.reaped = row.exitObserved && row.closeObserved;
  row.loaderThreadDisposition = loader ? 'Node-managed loader thread has no individual lifecycle receipt; reaped OS process establishes no surviving threads in that process, not a separate thread-exit observation' : 'not-requested';
  evidence.commands.push(row);
  writeReceipt(path.join(root, 'receipts', `${String(row.number).padStart(3, '0')}.json`), row);
  assert.equal(row.reaped, true, 'CHILD_UNREAPED_STOP'); assert.equal(row.signal, null, 'ABNORMAL_CHILD_STOP'); assert.equal(row.errors.length, 0, 'CHILD_ERROR_STOP');
  assert.ok(remaining.captureBytes >= 0 && row.capturedBytes <= bounds.captureBytes, 'CAPTURE_BOUND');
  for (const [root, before] of guards) assert.deepEqual(inventory(root), before, `APPEND_DETECTING_INTEGRITY:${root}`);
  assertStorage();
  for (const entry of seal.files) assert.equal(sha(fs.readFileSync(path.join(directory, entry.path))), entry.sha256, entry.path);
  return row;
}
const success = row => assert.equal(row.status, 0, row.label + ':' + Buffer.from(row.stderrBase64, 'base64'));
function toolRows(origin) {
  const rows = [];
  const walk = relative => {
    for (const name of fs.readdirSync(path.join(origin, relative)).sort()) {
      const key = relative ? `${relative}/${name}` : name, filename = path.join(origin, key), stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) rows.push([key, 'SYMLINK', fs.readlinkSync(filename)]);
      else if (stat.isDirectory()) walk(key);
      else { assert.ok(stat.isFile()); const bytes = fs.readFileSync(filename); rows.push([key, stat.mode & 511, bytes.length, sha(bytes)]); }
    }
  };
  walk(''); return rows;
}
function copyTool(name) {
  const pin = bindings.toolClosure.tools[name], origin = pin.origin, destination = path.join(tools, name);
  const rows = toolRows(origin); assert.deepEqual(rows, raw.tools[name].originalRows); assert.equal(sha(JSON.stringify(rows)), pin.sha256);
  for (const [relative, mode, bytes, digest] of rows) {
    if (mode === 'SYMLINK') { assert.ok(relative.includes('/.bin/')); assert.ok(fs.realpathSync(path.join(origin, relative)).startsWith(origin + '/')); continue; }
    const target = path.join(destination, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(origin, relative), target); fs.chmodSync(target, mode); assert.equal(sha(fs.readFileSync(target)), digest); assert.equal(fs.statSync(target).size, bytes);
  }
  assert.deepEqual(toolRows(destination), rows.filter(row => row[1] !== 'SYMLINK'));
  evidence.tools[name] = { origin, destination, originalRowsSha256: sha(JSON.stringify(rows)), copiedSha256: sha(JSON.stringify(toolRows(destination))) };
}
function copyRegular(origin, destination) {
  assert.equal(fs.existsSync(destination), false); fs.mkdirSync(destination, { recursive: true });
  for (const [relative, row] of Object.entries(inventory(origin))) {
    const target = path.join(destination, relative);
    if (row.kind === 'directory') fs.mkdirSync(target, { recursive: true, mode: row.mode });
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(origin, relative), target); fs.chmodSync(target, row.mode); }
  }
  assert.deepEqual(inventory(destination), inventory(origin));
}
function copyHarness(app) {
  for (const name of runtimeFiles) fs.copyFileSync(path.join(directory, name), path.join(app, name));
  for (const name of ['loader', 'guard']) {
    const receipt = bindings.receipts.find(row => row.path.endsWith(`/${name}.mjs.data`));
    const bytes = fs.readFileSync(path.join(repository, receipt.path)); assert.equal(sha(bytes), receipt.sha256);
    fs.writeFileSync(path.join(app, `${name}.mjs`), bytes, { flag: 'wx' });
  }
}
function admission(layout, tag) {
  const files = {};
  for (const [relative, row] of Object.entries(inventory(layout.product))) if (row.kind === 'file' && relative.startsWith('dist/') && relative.endsWith('.js')) files[path.join(layout.product, relative)] = { sha256: row.sha256, relative, role: 'product' };
  for (const name of [...runtimeFiles, 'guard.mjs']) files[path.join(layout.appParent, name)] = { sha256: sha(fs.readFileSync(path.join(layout.appParent, name))), relative: name, role: 'harness' };
  const admitted = { product: layout.product, root: layout.appParent, files };
  const filename = path.join(root, 'admissions', `${tag}.json`); writeJson(filename, admitted); return { filename, admitted };
}
const jsonLines = name => fs.existsSync(name) ? fs.readFileSync(name, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
try {
  for (const [relative, bytes] of selected) { const filename = path.join(source, relative); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 420 }); }
  assert.equal(sha(fs.readFileSync(bindings.toolClosure.tools.node.origin)), bindings.toolClosure.tools.node.sha256);
  fs.copyFileSync(bindings.toolClosure.tools.node.origin, copiedNode); fs.chmodSync(copiedNode, 493);
  for (const name of ['typescript', 'npm', '@types/node', 'undici-types']) copyTool(name);
  for (const name of ['@types/node', 'undici-types']) copyRegular(path.join(tools, name), path.join(source, 'node_modules', name));
  const guardPin = bindings.receipts.find(row => row.path.endsWith('/guard.mjs.data'));
  const guardBytes = fs.readFileSync(path.join(repository, guardPin.path)); assert.equal(sha(guardBytes), guardPin.sha256);
  const setupGuard = path.join(root, 'setup-guard.mjs'); fs.writeFileSync(setupGuard, guardBytes, { flag: 'wx' });
  protectedRoots = [tools];
  success(await command('fresh-build', ['--import', setupGuard, path.join(tools, 'typescript/bin/tsc'), '-p', path.join(source, 'tsconfig.build.json')], source, {}, { setup: true }));
  for (const [name, bytes] of selected) assert.deepEqual(fs.readFileSync(path.join(source, name)), bytes);
  assert.deepEqual(inventory(path.join(source, 'dist')), raw.source.emitted, 'FULL_EMITTED_EQUALITY');
  evidence.source.emittedSha256 = sha(JSON.stringify(inventory(path.join(source, 'dist'))));
  const packageJson = readJson(path.join(source, 'package.json'));
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) assert.deepEqual(Object.keys(packageJson[key] ?? {}), []);
  protectedRoots = [tools, source];
  const npm = path.join(tools, 'npm/bin/npm-cli.js');
  const pack = await command('full-npm-pack', ['--import', setupGuard, npm, 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', path.join(root, 'packs')], source, {}, { setup: true }); success(pack);
  const packed = JSON.parse(Buffer.from(pack.stdoutBase64, 'base64')); assert.equal(packed.length, 1); assert.equal(packed[0].files.length, 858);
  assert.equal(path.basename(packed[0].filename), packed[0].filename);
  const tarball = path.join(root, 'packs', packed[0].filename), tarBytes = fs.readFileSync(tarball);
  assert.equal(tarBytes.length, bindings.package.bytes); assert.equal(sha(tarBytes), grant.packageSha256);
  const consumer = grant.layouts[1].appParent; fs.mkdirSync(consumer); fs.writeFileSync(path.join(consumer, 'package.json'), '{"private":true,"type":"module"}\n', { flag: 'wx' });
  success(await command('genuine-offline-install', ['--import', setupGuard, npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], consumer, {}, { setup: true }));
  assert.deepEqual(inventory(grant.layouts[1].product), raw.fullInstalledBefore);
  copyHarness(source); copyHarness(consumer);
  protectedRoots = [tools, source, consumer];
  const initial = admission(grant.layouts[0], 'admission-base');
  const outsideEntry = path.join(outside, 'refused.mjs'); fs.writeFileSync(outsideEntry, 'throw new Error("ADMISSION_FAILED_TO_REFUSE");\n', { flag: 'wx' });
  for (const control of ['missing-entry', 'wrong-digest', 'sourcefallback', 'outside-file']) {
    const admitted = structuredClone(initial.admitted);
    let entry = path.join(source, 'runtime-entry.mjs');
    if (control === 'missing-entry') delete admitted.files[entry];
    if (control === 'wrong-digest') admitted.files[entry].sha256 = '0'.repeat(64);
    if (control === 'sourcefallback') entry = path.join(source, 'src/index.ts');
    if (control === 'outside-file') entry = outsideEntry;
    const name = path.join(root, 'admissions', control + '.json'); writeJson(name, admitted);
    const log = path.join(root, 'logs', control + '.jsonl');
    const result = await command(control, ['--loader', path.join(source, 'loader.mjs'), '--import', path.join(source, 'guard.mjs'), entry], outside, { ADMISSION: name, LOAD_LOG: log }, { loader: true, logs: [log] });
    assert.notEqual(result.status, 0); assert.equal(jsonLines(log).some(row => row.role === 'product'), false, 'ADMISSION_IMPORTED_PRODUCT');
    const diagnostic = Buffer.from(result.stderrBase64, 'base64').toString();
    assert.ok(diagnostic.includes(control === 'wrong-digest' ? 'LOAD_HASH_REFUSED' : control === 'sourcefallback' ? 'SOURCE_FALLBACK_REFUSED' : 'OUTSIDE_ADMISSION'), 'WRONG_REFUSAL');
  }
  for (const layout of grant.layouts) {
    if (layout.name === 'physically-moved') {
      const before = inventory(consumer); fs.renameSync(consumer, layout.appParent); assert.equal(fs.existsSync(consumer), false); assert.deepEqual(inventory(layout.appParent), before);
      protectedRoots = [tools, source, layout.appParent]; evidence.move = { original: consumer, moved: layout.appParent, oldAbsent: true };
    }
    const admitted = admission(layout, layout.name);
    for (const id of ids) {
      assert.ok(remaining.workerStarts >= bounds.workerStartsPerChild, 'WORKER_RESERVATION_EXHAUSTED');
      const tag = `${layout.name}-${id}`, log = path.join(root, 'logs', tag + '.parent.jsonl'), workerLog = path.join(root, 'logs', tag + '.worker.jsonl'), workerParentLog = path.join(root, 'logs', tag + '.worker-parent.jsonl');
      const config = path.join(root, 'admissions', tag + '.runtime.json');
      writeJson(config, { grant: arguments_[1], seal: sealPath, grantSha256: sha(grantBytes), layout: layout.name, id, specifier: layout.specifier, workerLog, workerParentLog, workerStartsRemaining: remaining.workerStarts, workerCaptureBytes: 262144 });
      const reservation = reserveWorkerStarts(remaining, tag);
      evidence.workerReservations.push(reservation);
      const result = await command(tag, ['--loader', path.join(layout.appParent, 'loader.mjs'), '--import', path.join(layout.appParent, 'guard.mjs'), path.join(layout.appParent, 'runtime-entry.mjs')], outside, { ADMISSION: admitted.filename, LOAD_LOG: log, RUN_CONFIGURATION: config }, { loader: true, logs: [log, workerLog, workerParentLog] });
      const parentLoads = jsonLines(log), childLoads = jsonLines(workerLog), workerEvents = jsonLines(workerParentLog);
      const starts = workerEvents.filter(row => row.action === 'start');
      assert.ok(starts.length <= bounds.workerStartsPerChild && remaining.workerStarts >= 0);
      const record = JSON.parse(Buffer.from(result.stdoutBase64, 'base64').toString().trim());
      evidence.rows.push({ layout: layout.name, id, result: record, parentLoads, childLoads, workerEvents });
      evidence.unexecuted.splice(evidence.unexecuted.indexOf(`${layout.name}:${id}`), 1);
      writeReceipt(path.join(root, 'receipts', tag + '.observed.json'), evidence.rows.at(-1));
      assert.equal(record.id, id); assert.equal(record.layout, layout.name);
      requireCleanSafety(record, childLoads);
      assert.equal(starts.length, record.workers.length, 'WORKER_ACCOUNTING_UNKNOWN_STOP');
      for (const start of starts) {
        const loaded = childLoads.filter(row => row.token === start.token && row.threadId === start.threadId && row.pid === start.pid);
        assert.equal(loaded.filter(row => row.event === 'preload').length, 1, 'MISSING_WORKER_PRELOAD_RECEIPT');
        const preload = loaded.find(row => row.event === 'preload');
        assert.deepEqual(preload.requested, start.requested); assert.deepEqual(preload.effective, start.effective);
        assert.equal(preload.resourceLimits.maxOldGenerationSizeMb, 128); assert.equal(preload.resourceLimits.stackSizeMb, 4);
        assert.ok(loaded.some(row => row.event === 'load' && row.url === start.entry && row.sha256 === bindings.runtimeAdmission.workerEntry.sha256), 'MISSING_ACTUAL_WORKER_ENTRY_LOAD');
        assert.equal(workerEvents.filter(row => row.action === 'exit' && row.token === start.token).length, 1, 'WORKER_EXIT_UNKNOWN_STOP');
      }
      for (const loaded of childLoads) assert.ok(starts.some(row => row.token === loaded.token && row.threadId === loaded.threadId && row.pid === loaded.pid), 'UNKNOWN_WORKER_LOAD_STOP');
      assert.ok(parentLoads.some(row => row.relative === 'dist/index.js'), 'NO_PUBLIC_API_LOAD');
      settleWorkerStarts(remaining, reservation, workerEvents, record.workers);
      if (!record.pass || result.status !== 0) evidence.failures.push({ layout: layout.name, id, status: result.status, failures: record.failures });
    }
  }
  assert.equal(evidence.resources.childStarts, 100); assert.equal(evidence.rows.length, 93);
} catch (error) { evidence.safetyStops.push({ message: String(error), stack: error?.stack }); process.exitCode = 1; }
finally {
  if (activeChild !== undefined) evidence.safetyStops.push({ code: 'SUPERVISOR_OWNED_CHILD_UNREAPED' });
  evidence.remainingParentBudget = remaining;
  evidence.resources.productWorkerStartsKnown = evidence.workerReservations.reduce((sum, row) => sum + (row.starts ?? 0), 0);
  evidence.resources.productWorkerStarts = evidence.workerReservations.some(row => row.accounting === 'unknown') ? null : evidence.resources.productWorkerStartsKnown;
  evidence.resources.workerStartsWithheld = evidence.workerReservations.filter(row => row.accounting === 'unknown').reduce((sum, row) => sum + row.charged, 0);
  evidence.allOwnedOsChildrenReaped = evidence.commands.every(row => row.reaped);
  const filename = path.join(root, 'RESULTS.json');
  evidence.terminalReceiptBytes = terminalReceiptBytes;
  evidence.terminalAccounting = 'Fixed-size terminal reservation; post-write logical storage and deadline sample; bounded STOP correction is receipt cleanup, not additional subjects. No quota/RSS/preemption claim.';
  accountTerminal(evidence, remaining, diskUsage() + terminalReceiptBytes, storageLimit, deadline, Date.now());
  const terminalBytes = () => {
    let bytes = Buffer.from(JSON.stringify(evidence, null, 2) + '\n');
    if (bytes.length > terminalReceiptBytes) {
      evidence.safetyStops.push({ code: 'TERMINAL_RECEIPT_BOUND_STOP' }); evidence.status = 'STOP';
      bytes = Buffer.from(JSON.stringify({ status: 'STOP', safetyStops: evidence.safetyStops, resources: evidence.resources, workerReservations: evidence.workerReservations, remainingParentBudget: remaining, retainedScratchBytes: evidence.retainedScratchBytes, allOwnedOsChildrenReaped: evidence.allOwnedOsChildrenReaped, detail: 'Per-command and per-case receipts retained separately; aggregate exceeded terminal bound.' }) + '\n');
    }
    assert.ok(bytes.length <= terminalReceiptBytes, 'TERMINAL_STOP_RECEIPT_BOUND');
    const padded = Buffer.alloc(terminalReceiptBytes, 32); bytes.copy(padded); return padded;
  };
  fs.writeFileSync(filename, terminalBytes(), { flag: 'wx' });
  accountTerminal(evidence, remaining, diskUsage(), storageLimit, deadline, Date.now());
  fs.writeFileSync(filename, terminalBytes());
  const priorStatus = evidence.status;
  accountTerminal(evidence, remaining, diskUsage(), storageLimit, deadline, Date.now());
  if (evidence.status !== priorStatus) fs.writeFileSync(filename, terminalBytes());
  if (evidence.status !== 'PASS') process.exitCode = 1;
  console.log(JSON.stringify({ status: evidence.status, executed: evidence.rows.length, unexecuted: evidence.unexecuted.length, children: evidence.resources.childStarts }));
}
