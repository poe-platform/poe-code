import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const directory = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(directory, 'CONFIG.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const base = 'tests/shell/indexed-arrays-design-20260828';
const review = 'tests/shell/indexed-arrays-independent-20260828';
const manifestPath = `${base}/native-preseal-v1/MANIFEST.json`;
const sealPath = path.join(directory, 'SEAL.json');
const admissionPath = path.join(directory, 'ADMITTED.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };
const timestamp = () => new Date().toISOString();
const git = (...args) => execFileSync('/usr/bin/git', args, {
  cwd: config.workspace, env: { PATH: '', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  maxBuffer: 2000000, timeout: 10000,
});
const relative = absolute => path.relative(config.workspace, absolute);
const read = filename => fs.readFileSync(path.resolve(config.workspace, filename));
const json = filename => JSON.parse(read(filename).toString('utf8'));
const absent = filename => {
  try { fs.lstatSync(filename); throw new Error(`already exists: ${filename}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
};
const writeExclusive = (filename, value) => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const descriptor = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
};
const identity = filename => {
  const stat = fs.lstatSync(filename);
  requireCondition(!stat.isSymbolicLink(), `link: ${filename}`);
  requireCondition(stat.isFile() || stat.isDirectory(), `unsupported entry: ${filename}`);
  return { path: filename, realpath: fs.realpathSync(filename), dev: stat.dev, ino: stat.ino,
    mode: stat.mode & 0o777, kind: stat.isFile() ? 'file' : 'directory', bytes: stat.isFile() ? stat.size : 0,
    ...(stat.isFile() ? { sha256: hash(fs.readFileSync(filename)), nlink: stat.nlink } : {}) };
};
const same = (actual, expected, label) => requireCondition(JSON.stringify(actual) === JSON.stringify(expected), `identity drift: ${label}`);
const checkFile = (filename, expected) => {
  const value = identity(path.resolve(config.workspace, filename));
  requireCondition(value.kind === 'file' && value.bytes === expected.bytes && value.sha256 === expected.sha256, `hash/size drift: ${filename}`);
  if (expected.mode !== undefined) requireCondition(value.mode === expected.mode, `mode drift: ${filename}`);
  return value;
};
const tree = (root, excluded = new Set()) => {
  const result = [];
  const visit = current => {
    if (excluded.has(current)) return;
    const entry = identity(current);
    result.push(entry);
    if (entry.kind === 'directory') for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name));
  };
  visit(root);
  return result;
};
const protectedCensus = () => [
  ...tree(path.join(config.workspace, base), new Set(['native-observations-v1', 'addendum-v2'].map(name => path.join(config.workspace, base, name)))),
  ...tree(path.join(config.workspace, review)),
];
const authenticate = () => {
  requireCondition(process.cwd() === config.workspace && process.platform === 'darwin', 'workspace/platform mismatch');
  requireCondition(git('rev-parse', '--show-toplevel').toString().trim() === config.workspace, 'Git root mismatch');
  const manifest = json(manifestPath);
  requireCondition(hash(read(manifestPath)) === config.manifestSha256, 'manifest mismatch');
  requireCondition(read(manifestPath).equals(git('show', `${config.presealCommit}:${manifestPath}`)), 'committed manifest mismatch');
  for (const document of [...manifest.documents, ...manifest.preservedOriginals]) {
    checkFile(document.path, document);
    const revision = manifest.preservedOriginals.includes(document) ? config.originalCommit : config.presealCommit;
    requireCondition(read(document.path).equals(git('show', `${revision}:${document.path}`)), `committed document drift: ${document.path}`);
  }
  const reviewNames = git('ls-tree', '-r', '--name-only', config.reviewCommit, '--', review).toString().trim().split('\n');
  const actualReview = tree(path.join(config.workspace, review)).filter(entry => entry.kind === 'file').map(entry => relative(entry.path)).sort();
  same(actualReview, reviewNames.sort(), 'review new-entry census');
  for (const filename of reviewNames) requireCondition(read(filename).equals(git('show', `${config.reviewCommit}:${filename}`)), `review drift: ${filename}`);
  const boundFiles = [...manifest.preservedOriginals, ...manifest.documents].map(item => item.path).concat(manifestPath).sort();
  const actualDesign = protectedCensus().filter(entry => entry.kind === 'file' && entry.path.startsWith(path.join(config.workspace, base) + '/')).map(entry => relative(entry.path)).sort();
  same(actualDesign, boundFiles, 'design new-entry census');
  const binding = json(`${base}/addendum-v1/SOURCE-BINDING.json`);
  const sources = binding.sources.map(source => {
    const bytes = git('show', `${source.revision}:${source.path}`);
    requireCondition(hash(bytes) === source.sha256 && bytes.length === source.bytes, `source blob mismatch: ${source.path}`);
    return { ...source, blob: git('rev-parse', `${source.revision}:${source.path}`).toString().trim() };
  });
  const rows = json(`${base}/native-preseal-v1/ROWS.json`).rows;
  requireCondition(rows.length === config.rows && manifest.rows.length === config.rows, 'row count mismatch');
  let scriptBytes = 0;
  let nestedContexts = 0;
  rows.forEach((row, index) => {
    const expected = manifest.rows[index];
    const size = Buffer.byteLength(row.script);
    requireCondition(row.id === `N${String(index + 1).padStart(2, '0')}` && row.id === expected.id, 'row order mismatch');
    requireCondition(size <= config.scriptCap && size === expected.scriptBytes && hash(row.script) === expected.scriptSha256, `script mismatch: ${row.id}`);
    requireCondition(row.nativeexpected === null && expected.nativeexpected === null, 'native expectation forbidden');
    requireCondition(row.nestedChildContextsUpperBound === expected.nestedChildContextsUpperBound, 'context drift');
    scriptBytes += size;
    nestedContexts += row.nestedChildContextsUpperBound;
  });
  requireCondition(scriptBytes === config.scriptBytes && scriptBytes <= config.scriptCap && nestedContexts === config.nestedContexts, 'aggregate source/context bound');
  requireCondition(config.rows * config.closeMs === config.wallAdmissionMs && config.rows * config.rowBytes === config.totalBytes, 'admission bounds mismatch');
  const binary = checkFile(manifest.nativeIdentity.binary.path, manifest.nativeIdentity.binary);
  const manual = checkFile(manifest.nativeIdentity.manual.path, manifest.nativeIdentity.manual);
  requireCondition(binary.path === config.binary && binary.sha256 === config.binarySha256, 'binary config mismatch');
  return { manifestSha256: config.manifestSha256, binary, manual, sources, scriptBytes, nestedContexts, protectedCensus: protectedCensus(), rows };
};

if (process.argv[2] === 'prepare') {
  absent(sealPath);
  absent(admissionPath);
  const authentication = authenticate();
  const nonce = crypto.randomUUID();
  const fixture = `/private/tmp/indexed-arrays-preseal-v1-${nonce}`;
  const output = path.join(directory, `capture-${nonce}`);
  absent(fixture);
  absent(output);
  const supervisorFiles = ['supervisor.mjs', 'CONFIG.json', 'AUTHORIZATION.md'].map(name => identity(path.join(directory, name)));
  writeExclusive(sealPath, { schema: 'indexed-array-supervisor-seal-v1', createdAt: timestamp(),
    headAtPreparation: git('rev-parse', 'HEAD').toString().trim(), authorization: 'Current delegated user instruction; AUTHORIZATION.md preserves exact manifest GO, not a separate signature',
    supervisorFiles, fixture, output,
    env: { PATH: '', ENV: '', BASH_ENV: '', HOME: `${fixture}/home`, TMPDIR: `${fixture}/tmp`, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    argv: authentication.rows.map(row => ({ id: row.id, argv: ['--noprofile', '--norc', '-c', row.script, 'indexed-preseal-v1'], scriptSha256: hash(row.script) })),
    host: { platform: process.platform, arch: process.arch, release: os.release(), node: process.version, executable: process.execPath },
    authentication, tests: 0, productCalls: 0, nativeCalls: 0 });
  console.log(`PREPARED ${relative(sealPath)}; nativeCalls=0`);
} else if (process.argv[2] === 'observe') {
  const sealRevision = process.argv[3];
  requireCondition(/^[0-9a-f]{40}$/.test(sealRevision ?? ''), 'exact committed supervisor revision required');
  const seal = json(sealPath);
  for (const name of ['supervisor.mjs', 'CONFIG.json', 'AUTHORIZATION.md', 'SEAL.json']) {
    const filename = path.join(directory, name);
    requireCondition(read(filename).equals(git('show', `${sealRevision}:${relative(filename)}`)), `uncommitted supervisor: ${name}`);
  }
  for (const entry of seal.supervisorFiles) same(identity(entry.path), entry, entry.path);
  absent(admissionPath);
  const fresh = authenticate();
  same(fresh, seal.authentication, 'pre-spawn prerequisites and new-entry census');
  absent(seal.fixture);
  absent(seal.output);
  const startedAt = timestamp();
  const admitted = { sealRevision, sealSha256: hash(read(sealPath)), manifestSha256: config.manifestSha256,
    authorizationSha256: hash(read(path.join(directory, 'AUTHORIZATION.md'))), startedAt,
    output: seal.output, fixture: seal.fixture, onceOnly: true, admittedRowSlots: config.rows };
  writeExclusive(admissionPath, admitted);
  const receipts = new Map();
  const fixtureOwners = new Map();
  let outputIdentity;
  let active;
  let interrupted;
  let aggregateBytes = 0;
  let activeMs = 0;
  let cleanupPromise;
  const rows = [];
  const failures = [];
  const receipt = (name, value) => {
    const filename = path.join(seal.output, name);
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    requireCondition(receipts.size < config.receiptEntries && [...receipts.values()].reduce((sum, entry) => sum + entry.bytes, 0) + bytes.length <= config.receiptBytes, 'receipt bounds');
    same(identity(seal.output), outputIdentity, 'output root');
    writeExclusive(filename, bytes);
    receipts.set(filename, identity(filename));
  };
  const checkReceipts = () => {
    same(identity(seal.output), outputIdentity, 'output root');
    same(fs.readdirSync(seal.output).sort(), [...receipts.keys()].map(filename => path.basename(filename)).sort(), 'output new-entry census');
    for (const entry of receipts.values()) same(identity(entry.path), entry, entry.path);
    return [...receipts.values()];
  };
  const fixtureCensus = () => {
    const result = [];
    let bytes = 0;
    const visit = filename => {
      requireCondition(result.length < config.fixtureEntries, 'fixture entry bound');
      const stat = fs.lstatSync(filename);
      requireCondition(!stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()), `fixture link/type: ${filename}`);
      requireCondition(!stat.isFile() || stat.nlink === 1, `fixture hardlink: ${filename}`);
      bytes += stat.isFile() ? stat.size : 0;
      requireCondition(bytes <= config.fixtureBytes, 'fixture byte bound');
      const entry = identity(filename);
      const allowed = [seal.fixture, `${seal.fixture}/home`, `${seal.fixture}/tmp`, `${seal.fixture}/tmp/rhs.txt`];
      requireCondition(allowed.includes(filename), `unexpected fixture entry: ${filename}`);
      if (fixtureOwners.has(filename)) same(entry, fixtureOwners.get(filename), `fixture ownership: ${filename}`);
      result.push(entry);
      if (entry.kind === 'directory') for (const name of fs.readdirSync(filename).sort()) visit(path.join(filename, name));
    };
    visit(seal.fixture);
    return result;
  };
  const cleanup = () => cleanupPromise ??= (async () => {
    if (active) await active.completion;
    const before = fixtureOwners.size ? fixtureCensus() : [];
    for (const entry of before.filter(item => item.kind === 'file')) {
      requireCondition(fixtureOwners.has(entry.path), `unowned cleanup file: ${entry.path}`);
      same(identity(entry.path), entry, 'cleanup file');
      fs.unlinkSync(entry.path);
    }
    for (const filename of [`${seal.fixture}/home`, `${seal.fixture}/tmp`, seal.fixture]) {
      if (!fixtureOwners.has(filename)) continue;
      same(identity(filename), fixtureOwners.get(filename), 'cleanup directory');
      fs.rmdirSync(filename);
    }
    absent(seal.fixture);
    return { before, after: [], rootAbsent: true, broadDeletion: false, finishedAt: timestamp() };
  })();
  const onSignal = signal => {
    interrupted ??= signal;
    if (active) active.stop(`supervisor ${signal}`);
  };
  const interruptHandler = () => onSignal('SIGINT');
  const terminateHandler = () => onSignal('SIGTERM');
  process.on('SIGINT', interruptHandler);
  process.on('SIGTERM', terminateHandler);
  const runRow = row => {
    const start = performance.now();
    const result = { id: row.id, startedAt: timestamp(), scriptSha256: hash(row.script),
      binary: config.binary, argv: ['--noprofile', '--norc', '-c', row.script, 'indexed-preseal-v1'],
      env: seal.env, cwd: seal.fixture, stdin: 'empty /dev/null via ignore',
      spawnSucceeded: false, pid: null, pgid: null, exitCode: null, signal: null, errors: [],
      stdoutObservedBytes: 0, stderrObservedBytes: 0, groupSignals: [], groupChecks: [], stopReasons: [], groupCheckCount: 0,
      cleanupRegisteredBeforeSpawn: true };
    const chunks = { stdout: [], stderr: [] };
    let child;
    let closed = false;
    let rowObserved = 0;
    let rowRetained = 0;
    let hardExpired = false;
    const groupExists = () => {
      if (!result.spawnSucceeded) return false;
      const record = exists => {
        result.groupCheckCount += 1;
        result.lastGroupExists = exists;
        if (result.groupChecks.length < 256) result.groupChecks.push({ atMs: performance.now() - start, exists });
      };
      try { process.kill(-result.pgid, 0); record(true); return true; }
      catch (error) {
        if (error.code !== 'ESRCH') { result.errors.push(`group check: ${error.message}`); throw error; }
        record(false); return false;
      }
    };
    const signalGroup = signal => {
      if (!result.spawnSucceeded) return;
      try {
        if (!groupExists()) return;
        process.kill(-result.pgid, signal);
        if (result.groupSignals.length < 32) result.groupSignals.push({ signal, atMs: performance.now() - start });
      } catch (error) { if (error.code !== 'ESRCH') result.errors.push(`group signal: ${error.message}`); }
    };
    const stop = reason => {
      if (!result.stopReasons.includes(reason)) result.stopReasons.push(reason);
      signalGroup('SIGTERM');
    };
    let resolveCompletion;
    const completion = new Promise(resolve => { resolveCompletion = resolve; });
    active = { completion, stop };
    const termTimer = setTimeout(() => stop('row TERM deadline'), config.termMs);
    const killTimer = setTimeout(() => signalGroup('SIGKILL'), config.killMs);
    const hardTimer = setTimeout(() => { hardExpired = true; stop('row closure deadline'); signalGroup('SIGKILL'); }, config.closeMs);
    const finish = async () => {
      closed = true;
      try {
        if (groupExists()) {
          stop('group survived child stream closure');
          while (groupExists()) {
            if (performance.now() - start >= config.killMs) signalGroup('SIGKILL');
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
      } catch (error) { result.errors.push(error.message); }
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      clearTimeout(hardTimer);
      result.elapsedMs = performance.now() - start;
      result.closedAt = timestamp();
      result.observedClosureByDeadline = !hardExpired && result.elapsedMs <= config.closeMs;
      result.childCloseObserved = closed;
      result.childReaped = result.spawnSucceeded && result.exitObserved === true;
      result.groupAbsent = result.spawnSucceeded && result.lastGroupExists === false;
      result.stdoutBytes = Buffer.concat(chunks.stdout);
      result.stderrBytes = Buffer.concat(chunks.stderr);
      result.retainedBytes = rowRetained;
      activeMs += result.elapsedMs;
      active = undefined;
      resolveCompletion(result);
    };
    const capture = stream => chunk => {
      result[`${stream}ObservedBytes`] += chunk.length;
      rowObserved += chunk.length;
      const retain = Math.min(chunk.length, config.rowBytes - rowRetained, config.totalBytes - aggregateBytes);
      if (retain > 0) {
        chunks[stream].push(Buffer.from(chunk.subarray(0, retain)));
        rowRetained += retain;
        aggregateBytes += retain;
      }
      if (rowObserved > config.rowBytes || retain < chunk.length) stop('output bound');
    };
    try {
      child = spawn(config.binary, result.argv, { cwd: seal.fixture, env: seal.env, detached: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      child.on('error', error => { result.errors.push(`child error: ${error.message}`); stop('child error'); });
      child.on('spawn', () => {
        result.spawnSucceeded = true;
        result.pid = child.pid;
        result.pgid = child.pid;
        if (interrupted) stop(`supervisor ${interrupted}`);
      });
      child.on('exit', (code, signal) => { result.exitCode = code; result.signal = signal; result.exitObserved = true; result.exitedAt = timestamp(); });
      child.on('close', () => { void finish(); });
      for (const stream of ['stdout', 'stderr']) {
        child[stream].on('error', error => { result.errors.push(`${stream}: ${error.message}`); stop('stream error'); });
        child[stream].on('data', capture(stream));
      }
    } catch (error) { result.errors.push(`spawn throw: ${error.message}`); void finish(); }
    return completion;
  };
  let postAuthentication;
  let cleanupReceipt;
  try {
    requireCondition(!interrupted, 'interrupted before fixture creation');
    fs.mkdirSync(seal.output, { mode: 0o700 });
    outputIdentity = identity(seal.output);
    requireCondition(outputIdentity.realpath === seal.output && outputIdentity.mode === 0o700, 'output root identity');
    receipt('ADMISSION.json', admitted);
    for (const filename of [seal.fixture, `${seal.fixture}/home`, `${seal.fixture}/tmp`]) {
      fs.mkdirSync(filename, { mode: 0o700 });
      fixtureOwners.set(filename, identity(filename));
      requireCondition(fixtureOwners.get(filename).realpath === filename && fixtureOwners.get(filename).mode === 0o700, 'fixture root identity');
    }
    receipt('PREFLIGHT.json', { authentication: fresh, outputIdentity, fixture: fixtureCensus(), admittedBounds: config });
    for (const row of fresh.rows) {
      requireCondition(!interrupted, 'supervisor interrupted');
      requireCondition(activeMs + config.closeMs <= config.wallAdmissionMs, 'total native wall admission');
      same(identity(config.binary), fresh.binary, 'per-row binary');
      same(identity(fresh.manual.path), fresh.manual, 'per-row manual');
      same(protectedCensus(), fresh.protectedCensus, 'per-row sealed/new-entry census');
      for (const entry of seal.supervisorFiles) same(identity(entry.path), entry, 'supervisor integrity');
      checkReceipts();
      const before = fixtureCensus();
      receipt(`${row.id}-ADMISSION.json`, { id: row.id, at: timestamp(), binary: identity(config.binary), before, argv: seal.argv.find(item => item.id === row.id), env: seal.env });
      const result = await runRow(row);
      const stdout = result.stdoutBytes;
      const stderr = result.stderrBytes;
      delete result.stdoutBytes;
      delete result.stderrBytes;
      receipt(`${row.id}-stdout.bin`, stdout);
      receipt(`${row.id}-stderr.bin`, stderr);
      result.stdout = { bytes: stdout.length, sha256: hash(stdout) };
      result.stderr = { bytes: stderr.length, sha256: hash(stderr) };
      try {
        result.after = fixtureCensus();
        result.newEntries = result.after.filter(entry => !before.some(old => old.path === entry.path));
        for (const entry of result.newEntries) {
          requireCondition(row.id === 'N15' && entry.path === `${seal.fixture}/tmp/rhs.txt` && entry.kind === 'file', 'unauthorized fixture effect');
          fixtureOwners.set(entry.path, entry);
          receipt(`${row.id}-rhs.bin`, fs.readFileSync(entry.path));
        }
        for (const entry of before) same(identity(entry.path), entry, `post-row prior fixture: ${entry.path}`);
      } catch (error) { result.errors.push(error.message); }
      receipt(`${row.id}-RESULT.json`, result);
      rows.push(result);
      requireCondition(result.stopReasons.length === 0 && result.errors.length === 0 && result.observedClosureByDeadline && result.childReaped && result.groupAbsent, `row guard stop: ${row.id}`);
    }
  } catch (error) { failures.push(error.message); }
  finally {
    try { postAuthentication = authenticate(); same(postAuthentication, fresh, 'post identity and new-entry census'); }
    catch (error) { failures.push(`post integrity: ${error.message}`); }
    try { cleanupReceipt = await cleanup(); }
    catch (error) { failures.push(`cleanup: ${error.message}`); }
    process.removeListener('SIGINT', interruptHandler);
    process.removeListener('SIGTERM', terminateHandler);
  }
  if (outputIdentity) {
    try { checkReceipts(); }
    catch (error) { failures.push(`receipt integrity: ${error.message}`); }
    receipt('COMPLETION.json', { schema: 'indexed-array-native-observations-v1', sealRevision,
      manifestSha256: config.manifestSha256, authorization: admitted, startedAt, finishedAt: timestamp(),
      status: failures.length ? 'STOPPED_FAIL_CLOSED' : 'OBSERVED_NOT_SCORED', failures,
      launched: rows.filter(row => row.spawnSucceeded).length, rowReceipts: rows.length,
      remaining: fresh.rows.filter(row => !rows.some(result => result.id === row.id)).map(row => row.id),
      aggregateBytes, activeMs, postAuthentication, cleanup: cleanupReceipt,
      fixtureEffects: rows.flatMap(row => (row.newEntries ?? []).filter(entry => entry.kind === 'file')),
      receiptsBeforeCompletion: [...receipts.values()], tests: 0, productCalls: 0, productImports: 0,
      nativeExpectedValues: null, passDenominator: null,
      qualification: 'Pinned GNU 5.3 artifact on Darwin; not Linux, full Bash, async parent mutation, cancellation, resource acceptance or implementation approval' });
    checkReceipts();
  }
  console.log(JSON.stringify({ status: failures.length ? 'STOPPED_FAIL_CLOSED' : 'OBSERVED_NOT_SCORED', failures, rows: rows.length, aggregateBytes, output: seal.output }));
  process.exitCode = failures.length ? 1 : 0;
} else {
  throw new Error('Only prepare or once-only observe with exact seal commit is supported');
}
