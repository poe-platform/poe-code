import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
export const writeJson = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
export const packet = '5d432becbe385eb323c10feecfa5e982bfd3b099';
export const composition = '8437e4eda904e1248c25eeef0d9d455b1d251495';
export const repository = '/Users/kjopek/Workspace/safe-bash';
export const directory = path.join(repository, 'tests/integration/priority-command-workflows-20260828');
export const runtimeFiles = ['admission.mjs', 'worker-observer.mjs', 'worker-preload.mjs', 'future-adapter.mjs', 'runtime-entry.mjs'];
export const ids = [...Array.from({ length: 24 }, (_, index) => `P${String(index + 1).padStart(2, '0')}`), ...Array.from({ length: 7 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`)];
export const bounds = Object.freeze({ children: 100, concurrentChildren: 1, runtimeMs: 20000, setupMs: 60000, captureBytes: 4194304, scratchBytes: 536870912, windowMs: 1200000, concurrentWorkers: 2, workerStartsPerChild: 4, workerStarts: 372, loaderThreads: 97, cleanupMs: 2000 });

export function exact(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
}

export function admitFile(url, files, loadedBytes) {
  assert.ok(url.startsWith('file:'), 'FORBIDDEN_IMPORT_SCHEME');
  const parsed = new URL(url);
  assert.equal(parsed.search + parsed.hash, '', 'URL_SUFFIX_REFUSED');
  const filename = fileURLToPath(parsed);
  assert.ok(!/\.(?:ts|mts|cts)$/u.test(filename), 'SOURCE_FALLBACK_REFUSED');
  const expected = files[filename];
  assert.ok(expected, `OUTSIDE_ADMISSION:${filename}`);
  assert.equal(fs.realpathSync(filename), filename, 'SYMLINK_IMPORT_REFUSED');
  assert.ok(fs.lstatSync(filename).isFile(), 'NONREGULAR_IMPORT_REFUSED');
  const bytes = loadedBytes === undefined ? fs.readFileSync(filename) : Buffer.from(loadedBytes);
  assert.equal(sha(bytes), expected.sha256, `LOAD_HASH_REFUSED:${filename}`);
  return { filename, sha256: expected.sha256, role: expected.role, relative: expected.relative, bytes: bytes.length };
}

export function inventory(root) {
  const output = {};
  const walk = relative => {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const key = relative ? `${relative}/${name}` : name;
      const filename = path.join(root, key), stat = fs.lstatSync(filename);
      assert.ok(!stat.isSymbolicLink(), `SYMLINK:${filename}`);
      if (stat.isDirectory()) { output[key + '/'] = { kind: 'directory', mode: stat.mode & 511 }; walk(key); }
      else { assert.ok(stat.isFile()); const bytes = fs.readFileSync(filename); output[key] = { kind: 'file', bytes: bytes.length, mode: stat.mode & 511, sha256: sha(bytes) }; }
    }
  };
  walk('');
  return output;
}

export function checkPacket(root = directory) {
  const manifest = readJson(path.join(root, 'MANIFEST.json'));
  for (const row of manifest.files) {
    const bytes = fs.readFileSync(path.join(root, row.path));
    assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256, row.path);
  }
  const cases = readJson(path.join(root, 'CASES.json'));
  const fixtures = readJson(path.join(root, 'FIXTURES.json'));
  exact([...cases.workflows, ...cases.controls].map(row => row.id), ids, 'FIXED31');
  exact(fixtures.rows.map(row => row.id), ids, 'FIXTURE31');
  return { cases, fixtures, manifest, bindings: readJson(path.join(root, 'BINDINGS.json')) };
}

export function expectedGrant(sealSha256) {
  const root = path.join(directory, 'future-run-01');
  return {
    schema: 'priority-execution-grant-v1', decision: 'GO', packet, preparationSealSha256: sealSha256,
    repository, root, composition, packageSha256: '6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e',
    command: ['/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', path.join(directory, 'future-supervisor.mjs'), '--grant', path.join(directory, 'GO.json'), '--budget', path.join(directory, 'PARENT-BUDGET.json')],
    layouts: [
      { name: 'source-build', appParent: path.join(root, 'source'), product: path.join(root, 'source'), specifier: './dist/index.js' },
      { name: 'offline-installed', appParent: path.join(root, 'consumer'), product: path.join(root, 'consumer/node_modules/virtual-bash'), specifier: 'virtual-bash' },
      { name: 'physically-moved', appParent: path.join(root, 'physically moved consumer'), product: path.join(root, 'physically moved consumer/node_modules/virtual-bash'), specifier: 'virtual-bash' },
    ],
    ids, bounds,
    instrumentation: 'worker-observer-v1: requested execArgv=[]; effective --import sealed worker-preload.mjs; synchronous same-thread load hooks; unchanged entry/module bytes; unchanged resourceLimits; NOT transparent execution',
    roles: ['immutable-data-reconstruction', 'build-once', 'offline-pack', 'offline-install', 'physical-rename', 'four-admission-controls', '93-real-public-api-calls', 'bounded-driver-cleanup'],
    forbidden: ['sourcefallback', 'dependency-install', 'native-oracle', 'comparator', 'private-runtime', 'network-services', 'XAN', 'arrays', 'YQ', 'live-HEAD', 'old-driver-replay'],
  };
}

export function requireGrant(grant, sealBytes) {
  exact(grant, expectedGrant(sha(sealBytes)), 'EXACT_ROOT_COMMAND_GRANT_REQUIRED');
}

export function validateRetirement(rows) {
  for (const row of rows) {
    assert.equal(row.exited, true, 'WORKER_UNREAPED_STOP');
    assert.equal(row.terminatePending, 0, 'TERMINATE_UNSETTLED_STOP');
    assert.equal(row.terminateErrors.length, 0, 'TERMINATE_ERROR_STOP');
    assert.ok(Number.isInteger(row.exitCode), 'UNKNOWN_EXIT_STOP');
    assert.equal(row.emergency, false, 'EMERGENCY_RETIREMENT_STOP');
  }
}

export function requireCleanSafety(record, childLoads = []) {
  exact(record.safetyStops, [], 'ADAPTER_SAFETY_STOP');
  exact(record.workerAdmissionRefusals, [], 'WORKER_ADMISSION_STOP');
  assert.equal(childLoads.some(row => row.event === 'admission-refused'), false, 'CHILD_LOAD_ADMISSION_STOP');
  for (const row of record.workers) assert.equal(row.childAdmissionRefused, false, 'CHILD_LOAD_ADMISSION_STOP');
  validateRetirement(record.workers);
}

export function reserveWorkerStarts(remaining, tag) {
  assert.ok(remaining.workerStarts >= bounds.workerStartsPerChild, 'WORKER_RESERVATION_EXHAUSTED');
  remaining.workerStarts -= bounds.workerStartsPerChild;
  return { tag, reserved: bounds.workerStartsPerChild, charged: bounds.workerStartsPerChild, accounting: 'unknown', attempts: null, starts: null };
}

export function settleWorkerStarts(remaining, reservation, events, rows) {
  assert.equal(reservation.accounting, 'unknown', 'DUPLICATE_WORKER_SETTLEMENT_STOP');
  const attempts = events.filter(row => row.action === 'constructor-attempt');
  const starts = events.filter(row => row.action === 'start');
  assert.ok(attempts.length <= reservation.reserved, 'WORKER_RESERVATION_EXCEEDED');
  assert.equal(new Set(attempts.map(row => row.token)).size, attempts.length, 'DUPLICATE_WORKER_ATTEMPT');
  exact(starts.map(row => row.token), attempts.map(row => row.token), 'UNKNOWN_WORKER_CONSTRUCTOR_STOP');
  exact(rows.map(row => row.token), starts.map(row => row.token), 'UNKNOWN_WORKER_ACCOUNTING_STOP');
  validateRetirement(rows);
  for (const start of starts) {
    const exits = events.filter(row => row.action === 'exit' && row.token === start.token);
    assert.equal(exits.length, 1, 'UNKNOWN_WORKER_EXIT_STOP');
    assert.equal(exits[0].code, rows.find(row => row.token === start.token).exitCode);
  }
  reservation.accounting = 'complete'; reservation.attempts = attempts.length; reservation.starts = starts.length; reservation.charged = attempts.length;
  remaining.workerStarts += reservation.reserved - reservation.charged;
}

export const terminalReceiptBytes = 16777216;

export function accountTerminal(evidence, remaining, retainedBytes, storageLimit, deadline, now) {
  for (const [code, refused] of [['FINAL_SCRATCH_STOP', retainedBytes > storageLimit], ['FINAL_DEADLINE_STOP', now >= deadline]]) {
    if (refused && !evidence.safetyStops.some(row => row.code === code)) evidence.safetyStops.push({ code });
  }
  evidence.retainedScratchBytes = retainedBytes;
  evidence.scratchBudgetExceeded = retainedBytes > storageLimit;
  remaining.scratchBytes = Math.max(0, evidence.parentBudget.remaining.scratchBytes - retainedBytes);
  evidence.finished = now;
  evidence.status = evidence.safetyStops.length ? 'STOP' : evidence.failures.length ? 'FAIL' : 'PASS';
}
