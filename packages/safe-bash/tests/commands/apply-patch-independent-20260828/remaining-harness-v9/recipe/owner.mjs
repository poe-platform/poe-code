import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { deflateSync } from 'node:zlib';

const started = performance.now();
const startedAt = new Date().toISOString();
const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, '../../../../..');
const requestedOutput = path.join(own, 'attempt-01');
assert.equal(fs.existsSync(requestedOutput), false, 'attempt collision STOP');
fs.mkdirSync(requestedOutput, { mode: 0o700 });
const output = fs.realpathSync(requestedOutput);
assert.equal(output, requestedOutput, 'canonical bound root mismatch STOP');
const outputIdentity = fs.lstatSync(output);
const journal = fs.openSync(path.join(output, 'OWNER-EVENTS.jsonl'), 'wx', 0o600);
const members = new Set(['OWNER-EVENTS.jsonl']);
const receipts = [];
const results = [];
const dataResults = [];
let persistedBytes = 0;
let rawBytes = 0;
let actualChildren = 0;
let peak = 1;
let active;
let stopped = null;
let cleanup = null;
let seal;
let main;
let mainHash;
let workIdentity;
let inventory;
let scratchWrittenBytes = 0;
let discoveryQualified = false;
let startupRefusalQualified = false;
const [sourceCommit, presealSha256] = process.argv.slice(2);
const elapsed = () => performance.now() - started;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fault(reason) { return { name: reason?.name ?? 'unknown', message: reason?.message ?? String(reason), code: reason?.code ?? null, stack: reason?.stack ?? null }; }
function writeAll(descriptor, bytes) {
  assert.ok(persistedBytes + bytes.length <= 2097152, 'persisted capture bound STOP');
  let offset = 0;
  while (offset < bytes.length) {
    const length = fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
    assert.ok(length > 0);
    offset += length;
    persistedBytes += length;
  }
}
function event(value) {
  writeAll(journal, Buffer.from(JSON.stringify({ elapsedMs: elapsed(), ...value }) + '\n'));
  fs.fsyncSync(journal);
}
function put(name, value) {
  assert.equal(members.has(name), false, 'evidence collision');
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const descriptor = fs.openSync(path.join(output, name), 'wx', 0o600);
  members.add(name);
  try { writeAll(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  assert.equal(sha256(fs.readFileSync(path.join(output, name))), sha256(bytes));
  return sha256(bytes);
}
function describe(filename) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `regular binding ${filename}`);
  assert.ok(stat.size <= 128 * 1024 * 1024);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const digest = crypto.createHash('sha256');
  const chunk = Buffer.alloc(65536);
  let bytes = 0;
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.ino, stat.ino);
    assert.equal(opened.dev, stat.dev);
    for (;;) {
      const length = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (!length) break;
      bytes += length;
      assert.ok(bytes <= stat.size);
      digest.update(chunk.subarray(0, length));
    }
    assert.equal(bytes, stat.size);
  } finally { fs.closeSync(descriptor); }
  return { bytes, mode: stat.mode & 0o777, sha256: digest.digest('hex') };
}
function integrity(label) {
  const ownNames = Object.keys(seal.files).concat('DISCOVERY-PRESEAL.json', 'attempt-01').sort();
  assert.deepEqual(fs.readdirSync(own).sort(), ownNames, 'own append-aware source membership');
  assert.equal(sha256(fs.readFileSync(path.join(own, 'DISCOVERY-PRESEAL.json'))), presealSha256);
  for (const [name, binding] of Object.entries(seal.files)) assert.deepEqual(describe(path.join(own, name)), binding, name);
  for (const [name, binding] of Object.entries(seal.sourceBindings)) assert.deepEqual(describe(path.join(repository, name)), binding, name);
  for (const tool of Object.values(seal.tools)) assert.deepEqual(describe(tool.path), tool.binding, tool.path);
  if (mainHash) assert.equal(sha256(fs.readFileSync(path.join(output, 'MAIN-PRESEAL.json'))), mainHash);
  event({ kind: 'integrity', label, ownAppendAware: true, historicalScope: 'named bindings only; no new-entry census of foreign trees' });
}
function reserve() {
  assert.equal(active, undefined, 'occupied child lease');
  assert.ok(elapsed() < seal.bounds.admissionCutoffMs, 'admission deadline STOP');
  assert.ok(actualChildren < seal.bounds.fixedChildren && actualChildren < seal.bounds.maximumChildren, 'child quota STOP');
}
async function child(plan, env, nested = false) {
  reserve();
  const sequence = receipts.length + 1;
  assert.equal(plan.id, ['D00', 'START-POSITIVE', 'START-REFUSAL', 'START-FS-REFUSAL', 'G01', 'P01'][sequence - 1]);
  const receipt = { sequence, id: plan.id, executable: plan.executable, args: plan.args, env, cwd: output, registeredAtMs: elapsed(), pid: null, closeObserved: false, absent: false, code: null, signal: null, fault: null, stdout: null, stderr: null };
  active = receipt;
  receipts.push(receipt);
  const channels = {};
  for (const channel of ['stdout', 'stderr']) {
    const filename = `${String(sequence).padStart(2, '0')}-${plan.id}.${channel}.raw`;
    const descriptor = fs.openSync(path.join(output, filename), 'wx', 0o600);
    members.add(filename);
    channels[channel] = { filename, descriptor, chunks: [], bytes: 0 };
  }
  event({ kind: 'capture-and-lease-registered-before-spawn', sequence, id: plan.id, rawFiles: Object.values(channels).map(channel => channel.filename) });
  let handle;
  let closeResolve;
  let hardResolve;
  let killTimer;
  let unknownTimer;
  let released = false;
  let stdoutLineOffset = 0;
  const closed = new Promise(resolve => { closeResolve = resolve; });
  const hard = new Promise(resolve => { hardResolve = resolve; });
  function stop(reason) {
    receipt.fault ??= fault(reason);
    if (handle?.pid && !receipt.closeObserved) {
      try { handle.kill('SIGTERM'); } catch (error) { receipt.termFailure = fault(error); }
      killTimer ??= setTimeout(() => {
        if (!receipt.closeObserved) {
          try { handle.kill('SIGKILL'); } catch (error) { receipt.killFailure = fault(error); }
        }
      }, 200);
    }
    unknownTimer ??= setTimeout(() => hardResolve('unknown'), 2500);
  }
  function onData(channel, fragment) {
    try {
      assert.ok(channels.stdout.bytes + channels.stderr.bytes + fragment.length <= seal.bounds.perChildRawBytes, 'raw capture admission STOP');
      const owned = Buffer.from(fragment);
      writeAll(channels[channel].descriptor, owned);
      channels[channel].chunks.push(owned);
      channels[channel].bytes += owned.length;
      rawBytes += owned.length;
      if (nested && channel === 'stdout') {
        const text = Buffer.concat(channels.stdout.chunks).toString('utf8');
        for (;;) {
          const newline = text.indexOf('\n', stdoutLineOffset);
          if (newline < 0) break;
          const record = JSON.parse(text.slice(stdoutLineOffset, newline));
          stdoutLineOffset = newline + 1;
          if (record.kind !== 'nested-refused') continue;
          assert.equal(released, false);
          assert.equal(record.pid, receipt.pid);
          assert.equal(record.ppid, process.pid);
          assert.equal(record.code, 'ERR_ACCESS_DENIED');
          assert.equal(record.permission, 'ChildProcess');
          assert.throws(() => reserve(), /occupied child lease/);
          receipt.occupiedLeaseRefused = true;
          receipt.nestedDenial = record;
          event({ kind: 'occupied-lease-refused-before-spawn', id: plan.id, pid: receipt.pid });
          released = true;
          handle.stdin.end('release\n');
        }
      }
    } catch (reason) { stop(reason); }
  }
  const timeout = setTimeout(() => stop(new Error('child timeout STOP')), seal.bounds.childTimeoutMs);
  try {
    handle = spawn(plan.executable, plan.args, { cwd: output, env, stdio: ['pipe', 'pipe', 'pipe'], detached: false });
    if (handle.pid) {
      receipt.pid = handle.pid;
      actualChildren++;
      peak = Math.max(peak, 2);
    }
    event({ kind: 'spawn', sequence, id: plan.id, pid: receipt.pid, ownerPid: process.pid, actualChildren, peak });
    handle.on('error', stop);
    handle.stdin.on('error', stop);
    handle.stdout.on('error', stop);
    handle.stderr.on('error', stop);
    handle.stdout.on('data', fragment => onData('stdout', fragment));
    handle.stderr.on('data', fragment => onData('stderr', fragment));
    handle.once('close', (code, signal) => {
      receipt.closeObserved = true;
      receipt.code = code;
      receipt.signal = signal;
      receipt.closedAtMs = elapsed();
      closeResolve('closed');
    });
    if (!nested) handle.stdin.end();
    await Promise.race([closed, hard]);
  } catch (reason) {
    stop(reason);
    if (handle) await Promise.race([closed, hard]);
  } finally {
    clearTimeout(timeout);
    clearTimeout(killTimer);
    clearTimeout(unknownTimer);
    for (const [channel, state] of Object.entries(channels)) {
      fs.fsyncSync(state.descriptor);
      fs.closeSync(state.descriptor);
      const bytes = Buffer.concat(state.chunks);
      receipt[channel] = { file: state.filename, bytes: bytes.length, sha256: sha256(bytes) };
      assert.equal(describe(path.join(output, state.filename)).sha256, receipt[channel].sha256);
    }
    if (receipt.closeObserved && receipt.pid !== null) {
      try { process.kill(receipt.pid, 0); receipt.fault ??= fault(new Error('PID still present after close STOP')); }
      catch (reason) {
        if (reason.code === 'ESRCH') receipt.absent = true;
        else receipt.fault ??= fault(reason);
      }
    }
    if (receipt.closeObserved && receipt.absent) active = undefined;
    else {
      receipt.fault ??= fault(new Error('unknown retirement STOP'));
      handle?.unref();
      handle?.stdin.destroy();
      handle?.stdout.destroy();
      handle?.stderr.destroy();
    }
    put(`${String(sequence).padStart(2, '0')}-${plan.id}.receipt.json`, receipt);
    event({ kind: 'retired', id: plan.id, pid: receipt.pid, closeObserved: receipt.closeObserved, absent: receipt.absent, code: receipt.code, fault: receipt.fault });
  }
  assert.equal(receipt.fault, null, JSON.stringify(receipt.fault));
  assert.equal(receipt.code, plan.expectedExit ?? 0);
  assert.equal(receipt.signal, null);
  return { receipt, stdout: Buffer.concat(channels.stdout.chunks), stderr: Buffer.concat(channels.stderr.chunks) };
}
function records(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.ok(text.endsWith('\n'));
  return text.slice(0, -1).split('\n').map(line => JSON.parse(line));
}
function startup(record, receipt, stage, expectedEnv) {
  assert.deepEqual(Object.keys(record).sort(), ['env', 'kind', 'pid', 'ppid', 'stage']);
  assert.equal(record.kind, 'startup-env');
  assert.equal(record.stage, stage);
  assert.equal(record.pid, receipt.pid);
  assert.equal(record.ppid, process.pid);
  assert.deepEqual(record.env, expectedEnv);
}
function workPut(filename, value, mode = 0o600) {
  const bytes = Buffer.from(value);
  assert.ok(scratchWrittenBytes + bytes.length <= 1048576, 'scratch write admission');
  fs.writeFileSync(filename, bytes, { flag: 'wx', mode });
  scratchWrittenBytes += bytes.length;
}
event({ kind: 'outer-capture-ready', ownerPid: process.pid, ownerPpid: process.ppid, startedAt, sourceCommit, presealSha256 });
try {
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(presealSha256, /^[a-f0-9]{64}$/);
  const sealBytes = fs.readFileSync(path.join(own, 'DISCOVERY-PRESEAL.json'));
  assert.equal(sha256(sealBytes), presealSha256);
  seal = JSON.parse(sealBytes);
  assert.equal(output, seal.boundRunRoot);
  assert.deepEqual(process.execArgv, ['--no-warnings']);
  assert.equal(main, undefined);
  assert.equal(process.platform, 'darwin');
  assert.equal(process.version, seal.nodeVersion);
  assert.equal(process.execPath, seal.tools.node.path);
  integrity('pre-discovery');
  ({ inventory } = await import('./primitives.mjs'));
  const observed = Object.fromEntries(Object.keys(process.env).sort().map(key => [key, process.env[key]]));
  put('OWNER-ENV-DISCOVERY.json', { route: 'current owner Node process.env API; not prior evidence or raw pipe', env: observed });
  assert.deepEqual(Object.keys(observed), ['__CF_USER_TEXT_ENCODING'], 'unbound extra env STOP');
  assert.equal(typeof observed.__CF_USER_TEXT_ENCODING, 'string');
  assert.ok(Buffer.byteLength(observed.__CF_USER_TEXT_ENCODING) >= 1 && Buffer.byteLength(observed.__CF_USER_TEXT_ENCODING) <= 256);
  const discovery = await child(seal.discovery, observed);
  assert.equal(discovery.stderr.length, 0);
  const discoveryRecords = records(discovery.stdout);
  assert.equal(discoveryRecords.length, 1);
  startup(discoveryRecords[0], discovery.receipt, 'discovery', observed);
  discoveryQualified = true;
  main = structuredClone(seal.mainTemplate);
  main.nodeEnv = discoveryRecords[0].env;
  main.intentionalRefusalExpectedEnv = { __CF_USER_TEXT_ENCODING: `${main.nodeEnv.__CF_USER_TEXT_ENCODING}!V6-INTENTIONAL-MISMATCH` };
  for (const plan of main.children) plan.env = { ...(plan.env ?? {}), ...main.nodeEnv };
  Object.assign(main, { sourceCommit, discoveryPresealSha256: presealSha256, discoveryStdoutSha256: discovery.receipt.stdout.sha256 });
  mainHash = put('MAIN-PRESEAL.json', main);
  const directoryDescriptor = fs.openSync(output, 'r');
  try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
  event({ kind: 'main-preseal-frozen-before-controls', sha256: mainHash, nodeEnv: main.nodeEnv });
  integrity('main-pre-controls');
  const work = path.join(output, 'work');
  fs.mkdirSync(work, { mode: 0o700 });
  workIdentity = fs.lstatSync(work);
  assert.equal(main.positiveWork, path.join(work, 'positive'));
  assert.deepEqual(main.fixturePreparation, {"directory":"/Users/kjopek/Workspace/safe-bash/tests/commands/apply-patch-independent-20260828/remaining-harness-v9/recipe/attempt-01/work/positive/refusals","bodyBase64":"SU5FUlQgQ09OVFJPTCBURVhUIE9OTFk6IHBvc2l0aXZlCg==","bodySha256":"78a9ab677743cead7950080fa8977115f3b08d5ee6c93b178c5ad5f84e486c0b","mode":420,"regularNames":["link-target","alias-source"],"symlink":{"name":"symlink","target":"link-target"},"hardlink":{"name":"alias","source":"alias-source"}});
  const fixture = main.fixturePreparation;
  const fixtureBytes = Buffer.from(fixture.bodyBase64, 'base64');
  assert.equal(sha256(fixtureBytes), fixture.bodySha256);
  assert.equal(fixture.directory, path.join(main.positiveWork, 'refusals'));
  fs.mkdirSync(main.positiveWork, { mode: 0o700 });
  fs.mkdirSync(fixture.directory, { mode: 0o700 });
  assert.equal(fs.realpathSync(fixture.directory), fixture.directory);
  for (const name of fixture.regularNames) workPut(path.join(fixture.directory, name), fixtureBytes, fixture.mode);
  const linkCharge = Buffer.byteLength(fixture.symlink.target);
  assert.ok(scratchWrittenBytes + linkCharge <= seal.bounds.tightenedScratchBytes);
  scratchWrittenBytes += linkCharge;
  fs.symlinkSync(fixture.symlink.target, path.join(fixture.directory, fixture.symlink.name));
  fs.linkSync(path.join(fixture.directory, fixture.hardlink.source), path.join(fixture.directory, fixture.hardlink.name));
  assert.equal(fs.readlinkSync(path.join(fixture.directory, fixture.symlink.name)), fixture.symlink.target);
  assert.equal(fs.realpathSync(path.join(fixture.directory, fixture.symlink.name)), path.join(fixture.directory, 'link-target'));
  const fixtureInventory = inventory(fixture.directory);
  event({ kind: 'owned-link-fixtures-precreated-before-positive-child', preparation: fixture, inventory: fixtureInventory });
  const positive = await child(main.children[0], main.children[0].env);
  const positiveRecords = records(positive.stdout);
  for (const record of positiveRecords) {
    if (record.kind === 'control') results.push(record);
    if (record.kind === 'data') dataResults.push(record);
  }
  assert.equal(positive.stderr.length, 0);
  startup(positiveRecords[0], positive.receipt, 'positive', main.nodeEnv);
  assert.deepEqual(positiveRecords.map(record => record.kind), ['startup-env', 'control', 'control', 'control', 'control', 'data', 'data', 'data', 'data', 'positive-complete']);
  assert.deepEqual(results.map(record => record.id), main.controls.slice(0, 4));
  assert.deepEqual(dataResults.map(record => record.id), main.dataChecks);
  scratchWrittenBytes += positiveRecords.at(-1).detail.writtenBytes;
  const refused = await child(main.children[1], main.children[1].env);
  const refusedRecords = records(refused.stdout);
  assert.equal(refusedRecords.length, 1);
  startup(refusedRecords[0], refused.receipt, 'refusal', main.nodeEnv);
  assert.ok(refused.stderr.includes(Buffer.from('V6_INTENTIONAL_STARTUP_REFUSAL')));
  assert.ok(refused.stderr.includes(Buffer.from('ERR_ASSERTION')));
  startupRefusalQualified = true;
  event({ kind: 'intentional-startup-refusal-qualified', rawStdout: refused.receipt.stdout, rawStderr: refused.receipt.stderr, exit: refused.receipt.code, noDataImport: true });
  const filesystemRefused = await child(main.children[2], main.children[2].env);
  const filesystemRecords = records(filesystemRefused.stdout);
  assert.equal(filesystemRecords.length, 1);
  startup(filesystemRecords[0], filesystemRefused.receipt, 'fs-refusal', main.nodeEnv);
  assert.ok(filesystemRefused.stderr.includes(Buffer.from('FileSystemWrite')));
  assert.ok(filesystemRefused.stderr.includes(Buffer.from(main.startupDeniedPath)));
  assert.equal(fs.existsSync(main.startupDeniedPath), false);
  event({ kind: 'startup-filesystem-refusal-qualified', receipt: filesystemRefused.receipt });
  const input = JSON.parse(fs.readFileSync(main.inputs));
  const gitRoot = path.join(work, 'metadata.git');
  for (const directory of ['metadata.git', 'metadata.git/objects', 'metadata.git/refs', 'empty', 'home', 'tmp']) fs.mkdirSync(path.join(work, directory));
  workPut(path.join(gitRoot, 'HEAD'), 'ref: refs/heads/control\n');
  workPut(path.join(gitRoot, 'config'), '[core]\n\trepositoryformatversion = 0\n\tbare = true\n');
  function object(kind, payload) {
    const bytes = Buffer.concat([Buffer.from(`${kind} ${payload.length}\0`), payload]);
    const digest = crypto.createHash('sha1').update(bytes).digest('hex');
    const directory = path.join(gitRoot, 'objects', digest.slice(0, 2));
    if (!fs.existsSync(directory)) fs.mkdirSync(directory);
    workPut(path.join(directory, digest.slice(2)), deflateSync(bytes));
    return digest;
  }
  const blob = object('blob', Buffer.from(input.gitBlob));
  const tree = object('tree', Buffer.concat(input.gitPaths.map(name => Buffer.concat([Buffer.from(`100644 ${name}\0`), Buffer.from(blob, 'hex')]))));
  const commit = object('commit', Buffer.from(`tree ${tree}\n${input.gitCommitTail}`));
  assert.equal(commit, main.gitFixture.commit);
  const gitBefore = inventory(work);
  const git = await child(main.children[3], main.children[3].env);
  assert.equal(git.stderr.length, 0);
  assert.equal(git.stdout.toString('base64'), main.gitFixture.expectedStdoutBase64);
  assert.equal(sha256(git.stdout), main.gitFixture.expectedStdoutSha256);
  assert.deepEqual(inventory(work), gitBefore);
  results.push({ kind: 'control', id: 'G01', detail: { exactNulBytes: git.stdout.length, sha256: sha256(git.stdout), isolatedOnly: true } });
  const nested = await child(main.children[4], main.children[4].env, true);
  assert.equal(nested.stderr.length, 0);
  const nestedRecords = records(nested.stdout);
  assert.equal(nestedRecords.length, 3);
  startup(nestedRecords[0], nested.receipt, 'nested', main.nodeEnv);
  assert.deepEqual(nestedRecords[2], { kind: 'released', pid: nested.receipt.pid, ppid: process.pid });
  assert.equal(nested.receipt.occupiedLeaseRefused, true);
  results.push({ kind: 'control', id: 'P01', detail: { denial: nested.receipt.nestedDenial, occupiedLeaseRefused: true, closeObserved: true, absent: true } });
  assert.deepEqual(results.map(record => record.id), main.controls);
  assert.equal(actualChildren, 6);
  integrity('post-controls');
} catch (reason) {
  stopped = fault(reason);
  event({ kind: 'STOP', reason: stopped });
} finally {
  try {
    assert.ok(elapsed() < 300000, 'total deadline including cleanup STOP');
    assert.equal(active, undefined, 'unknown retirement; preserve scratch');
    const work = path.join(output, 'work');
    if (fs.existsSync(work)) {
      const stat = fs.lstatSync(work);
      assert.equal(stat.ino, workIdentity.ino);
      assert.equal(stat.dev, workIdentity.dev);
      const workInventory = inventory(work);
      put('WORK-INVENTORY.json', workInventory);
      fs.rmSync(work, { recursive: true });
      cleanup = { removed: !fs.existsSync(work), bytes: workInventory.bytes, entries: workInventory.entries.length, inventorySha256: sha256(JSON.stringify(workInventory)), identityChecked: true };
    } else cleanup = { removed: true, neverCreated: true };
    if (seal) integrity('post-cleanup');
    assert.ok(elapsed() < 300000, 'cleanup deadline STOP');
  } catch (reason) { cleanup = { failure: fault(reason), scratchPreserved: fs.existsSync(path.join(output, 'work')) }; stopped ??= fault(reason); }
  event({ kind: 'finalized', stopped, cleanup, actualChildren, peak });
  fs.fsyncSync(journal);
  fs.closeSync(journal);
  const knownNames = [...members].sort();
  const actualNames = fs.readdirSync(output).filter(name => name !== 'work').sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(knownNames)) stopped ??= fault(new Error('unexpected output entry STOP'));
  const membership = Object.fromEntries(knownNames.map(name => [name, describe(path.join(output, name))]));
  put('RAW-MEMBERSHIP.json', { classification: 'actual pipe files and in-process receipts; no transcription', files: membership, exactOutputNamesBeforeThisFile: actualNames, excludes: ['RAW-MEMBERSHIP.json', 'OUTCOME.json'], scratchPreserved: fs.existsSync(path.join(output, 'work')) });
  const finalStat = fs.lstatSync(output);
  assert.equal(finalStat.ino, outputIdentity.ino);
  assert.equal(finalStat.dev, outputIdentity.dev);
  const outcome = { schema: 'remaining-harness-v9-source-data-outcome', sourceCommit, presealSha256, mainPresealSha256: mainHash ?? null, startedAt, elapsedMs: elapsed(), ownerPid: process.pid, ownerPpid: process.ppid, stopped,
    discoveryQualified, startupRefusalQualified, results, dataResults, unrunControls: ['R01', 'R02', 'R03', 'B01', 'G01', 'P01'].filter(id => !results.some(result => result.id === id)),
    actualChildren, spawnAttempts: receipts.length, peakAllOwnedProcesses: peak, peakQualification: 'finite inspected routes, direct handles and Node PID/PPID handshakes; not global process census', rawBytes, persistedBytesBeforeOutcome: persistedBytes, scratchWrittenBytes, receipts, cleanup,
    sourcePostguards: 'own source append-aware plus named historical bindings/tools; foreign new entries not censused', productExecutions: 0, candidateImports: 0, remaining43JobsExecuted: 0, productFixtureTailExecuted: 0, admission: 'NONE; different review and root GO required' };
  put('OUTCOME.json', outcome);
  process.stdout.write(JSON.stringify({ stopped, controls: results.length, dataChecks: dataResults.length, discoveryQualified, startupRefusalQualified, actualChildren, peak, rawBytes, persistedBytes, elapsedMs: elapsed(), cleanup }) + '\n');
  process.exitCode = stopped ? 1 : 0;
  if (active !== undefined) process.exit(process.exitCode);
}
