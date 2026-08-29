import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const started = performance.now();
const own = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(own, '../../..');
const output = path.join(own, 'RUN-01');
fs.mkdirSync(output);
const startup = fs.openSync(path.join(output, 'startup.raw'), 'wx');
fs.writeSync(startup, JSON.stringify({ execPath: process.execPath, version: process.version, startedAt: new Date().toISOString() }) + '\n');
fs.closeSync(startup);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const result = { rows: [], children: [], status: 'ADMISSION', internalAttempts: 0, applicationBirths: 0, applicationExits: 0, captured: 0, productImports: 0, regexWorkers: 0 };
const save = () => fs.writeFileSync(path.join(output, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n');
save();
const checkTime = () => assert.ok(performance.now() - started < 120000, 'all-inclusive runtime subdeadline');
function regular(filename, limit = 2000000) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit);
  assert.equal(fs.realpathSync(filename), filename);
  return stat;
}
function streamHash(filename) {
  const before = regular(filename, 268435456), descriptor = fs.openSync(filename, 'r');
  const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
  let size = 0;
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.ino, before.ino); assert.equal(opened.dev, before.dev);
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      size += count; assert.ok(size <= before.size); hash.update(buffer.subarray(0, count));
    }
    const after = fs.fstatSync(descriptor);
    assert.equal(size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}
function census(directory) {
  const rows = [];
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
      const member = path.join(relative, name), target = path.join(directory, member), stat = fs.lstatSync(target);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) visit(member);
      else { regular(target); rows.push({ path: member, bytes: stat.size, mode: stat.mode & 511, sha256: streamHash(target) }); }
    }
  }
  visit('');
  return rows.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
let seal, authentication, author, fixtures, admit, policy, hashRegularFile;
function verifyInputs() {
  for (const row of [...authentication.members.map(row => ({ ...row, filename: path.join(repo, row.path) })), ...seal.files.map(row => ({ ...row, filename: path.join(own, row.path) }))]) {
    const stat = regular(row.filename);
    assert.equal(stat.size, row.bytes); assert.equal(stat.mode & 511, row.physicalMode ?? row.mode);
    assert.equal(streamHash(row.filename), row.sha256, row.filename);
  }
  assert.equal(streamHash(process.execPath), authentication.node.sha256);
}
async function record(id, action) {
  checkTime();
  try { const detail = await action(); result.rows.push({ id, pass: true, detail }); }
  catch (error) { result.rows.push({ id, pass: false, reason: String(error.stack ?? error) }); }
  save();
}
function options() { return { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } }; }
const cases = [
  { id: 'R01', caseId: 'P03', code: 0, workers: 0 },
  { id: 'R02', caseId: 'P08', code: 7, workers: 1 },
  { id: 'R03', caseId: 'P09', code: 0, workers: 1, noLoader: true },
  { id: 'N02', caseId: 'P03', code: 0, workers: 0, realPolicy: true },
  { id: 'N03', caseId: 'P04', code: 0, workers: 0, changedApplication: true },
  { id: 'N04', caseId: 'P03', code: 1, workers: 0, early: true },
  { id: 'N05', caseId: 'P04', code: 0, workers: 1 },
  { id: 'N08', caseId: 'P04', code: 0, workers: 0, realPolicy: true }
];
async function runCase(item) {
  checkTime(); verifyInputs();
  const directory = path.join(output, item.id), source = path.join(directory, 'source'), data = path.join(directory, 'data');
  fs.mkdirSync(directory); fs.mkdirSync(source); fs.mkdirSync(data);
  const novel = item.id.startsWith('N');
  const entries = [
    ['loader.mjs', item.early ? path.join(own, 'early-loader.mjs') : path.join(fixtures, 'tiny-loader.mjs')],
    ['bootstrap.mjs', item.realPolicy ? path.join(fixtures, 'resources.mjs') : path.join(fixtures, 'bootstrap.mjs')],
    ['worker-policy.mjs', path.join(fixtures, 'worker-policy.mjs')],
    ['consumer.mjs', novel ? path.join(own, 'novel-consumer.mjs') : path.join(fixtures, 'consumer-v2.mjs')],
    ['application.mjs', path.join(fixtures, item.caseId === 'P09' ? 'application-error.mjs' : 'application.mjs')]
  ];
  const files = entries.map(([name, origin]) => {
    regular(origin); const bytes = fs.readFileSync(origin), filename = path.join(source, name);
    fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o644 });
    return { path: filename, bytes: bytes.length, sha256: digest(bytes) };
  });
  if (item.changedApplication) fs.appendFileSync(path.join(source, 'application.mjs'), '\n');
  const sourceBefore = census(source);
  const specification = { caseId: item.caseId, root: directory, output: data, node: process.execPath, loader: path.join(source, 'loader.mjs'), bootstrap: path.join(source, 'bootstrap.mjs'), consumer: path.join(source, 'consumer.mjs'), manifestPath: path.join(data, 'manifest.json'), logPath: path.join(data, 'events.jsonl'), files };
  const manifest = { files, applicationEntry: path.join(source, 'application.mjs') };
  fs.writeFileSync(specification.manifestPath, JSON.stringify(manifest));
  const environment = { PATH: path.dirname(process.execPath), HOME: data, TMPDIR: data, LC_ALL: 'C', NO_COLOR: '1', CASE_ID: item.caseId, FIXTURE_MANIFEST: specification.manifestPath, FIXTURE_LOG: specification.logPath };
  let args = admit(specification, ['--test-reporter=tap', '--loader', specification.loader, specification.consumer], environment);
  if (item.noLoader) args = args.filter(value => value !== '--loader' && value !== specification.loader);
  if (novel) environment.NOVEL_ROLE = item.id;
  if (item.realPolicy) {
    environment.RESOURCE_LOG = specification.logPath;
    environment.RESOURCE_ALLOWANCE = item.id === 'N08' ? '1' : '0';
    environment.PUBLIC_BINDING = path.join(data, 'binding.json');
    fs.writeFileSync(environment.PUBLIC_BINDING, JSON.stringify({ root: source, inputs: [] }));
  }
  const dataBefore = census(data);
  const row = { id: item.id, args, environment, sourceBefore, dataBefore, closed: false, signals: [], internalAdmission: !item.noLoader };
  result.children.push(row);
  assert.ok(result.children.length <= 8);
  if (!item.noLoader) assert.ok(++result.internalAttempts <= 7);
  const descriptors = [fs.openSync(path.join(directory, 'stdout.raw'), 'wx'), fs.openSync(path.join(directory, 'stderr.raw'), 'wx')];
  let child, timer, rescue, captureError, spawnError, count = 0;
  try {
    child = spawn(process.execPath, args, { cwd: source, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    row.pid = child.pid;
    const closed = new Promise(resolve => {
      child.once('error', error => { spawnError = String(error); });
      child.once('exit', (code, signal) => { row.exitEvent = { code, signal }; });
      child.once('close', (code, signal) => { row.closed = true; row.code = code; row.signal = signal; resolve(); });
    });
    const stop = reason => {
      if (row.signals.length) return;
      row.stopReason = reason; row.signals.push('SIGTERM'); child.kill('SIGTERM');
      rescue = setTimeout(() => { if (!row.closed) { row.signals.push('SIGKILL'); child.kill('SIGKILL'); } }, 500);
    };
    for (const [index, stream] of [child.stdout, child.stderr].entries()) stream.on('data', bytes => {
      count += bytes.length; result.captured += bytes.length;
      if (count > 1048576 || result.captured > 16777216) return stop('capture cap');
      try { assert.equal(fs.writeSync(descriptors[index], bytes), bytes.length); }
      catch (error) { captureError = String(error); stop('capture persistence'); }
    });
    timer = setTimeout(() => stop('deadline'), Math.min(15000, 119000 - (performance.now() - started)));
    try { save(); } catch (error) { captureError = String(error); stop('receipt persistence'); }
    await closed;
  } finally {
    clearTimeout(timer); clearTimeout(rescue);
    for (const descriptor of descriptors) fs.closeSync(descriptor);
  }
  Object.assign(row, { captureBytes: count, captureError, spawnError });
  assert.ok(row.closed && !captureError && !spawnError && row.signal === null && row.signals.length === 0, 'safety/retirement STOP');
  assert.deepEqual(census(source), sourceBefore, 'source closure drift');
  for (const bound of dataBefore) assert.deepEqual(census(data).find(entry => entry.path === bound.path), bound);
  const dataAfter = census(data); assert.ok(dataAfter.every(entry => dataBefore.some(before => before.path === entry.path) || entry.path === 'events.jsonl'));
  const events = fs.existsSync(specification.logPath) ? fs.readFileSync(specification.logPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const births = events.filter(event => ['application-create', 'worker-create'].includes(event.kind));
  const exits = events.filter(event => ['application-exit', 'worker-exit'].includes(event.kind));
  result.applicationBirths += births.length; result.applicationExits += exits.length;
  assert.ok(result.applicationBirths <= 3);
  assert.equal(births.length, exits.length, 'unknown Worker retirement');
  assert.equal(new Set(births.map(event => event.id)).size, births.length);
  assert.equal(new Set(exits.map(event => event.id)).size, exits.length);
  assert.ok(births.every(birth => exits.some(exit => exit.id === birth.id && exit.live === 0)));
  Object.assign(row, { events, dataAfter, sourceAfter: census(source), stdout: streamHash(path.join(directory, 'stdout.raw')), stderr: streamHash(path.join(directory, 'stderr.raw')) });
  save(); verifyInputs();
  await record(item.id, () => {
    const out = fs.readFileSync(path.join(directory, 'stdout.raw'), 'utf8'), err = fs.readFileSync(path.join(directory, 'stderr.raw'), 'utf8');
    assert.equal(row.code, item.code); assert.equal(births.length, item.workers);
    assert.equal(events.filter(event => event.kind === 'loader-start').length, item.noLoader ? 0 : 1);
    const bootstrap = events.findIndex(event => event.kind === 'bootstrap'), consumer = events.findIndex(event => event.kind === 'consumer-start');
    if (item.early) { assert.equal(bootstrap, -1); assert.equal(consumer, -1); assert.equal(out, ''); assert.match(err, /EARLY_LOADER_SENTINEL/); }
    else {
      assert.ok(bootstrap >= 0 && consumer > bootstrap); assert.equal(JSON.parse(out.trim()).semantic, 'PASS');
      if (!item.noLoader) assert.ok(bootstrap > events.findIndex(event => event.kind === 'loader-start'));
      if (item.id === 'R02') {
        const refusal = events.findIndex(event => event.kind === 'six-option-refusals');
        assert.ok(refusal > consumer && refusal < events.findIndex(event => event.kind === 'application-create'));
        assert.equal(events[refusal].count, 6); assert.equal(policy.terminalVerdict(row.code, row.signal, 0, true, true), false);
      }
    }
    return { code: row.code, applicationBirths: births.length, applicationExitEvents: exits.length, internalStarts: item.noLoader ? 0 : 1, hostProcessClosed: row.closed, internalExitCensus: null };
  });
}
try {
  seal = JSON.parse(fs.readFileSync(path.join(own, 'EXECUTION-SEAL.json')));
  authentication = JSON.parse(fs.readFileSync(path.join(own, 'AUTHENTICATION.json')));
  assert.equal(digest(fs.readFileSync(path.join(own, 'AUTHENTICATION.json'))), seal.authenticationSha256);
  assert.equal(process.execPath, authentication.node.path); assert.equal(process.version, 'v22.22.2');
  assert.equal(authentication.commit, '7b2a72e98c50d43fe4d06ded0773ca857e5d233a');
  verifyInputs();
  author = path.join(repo, 'tests/integration/git-public-independent-20260829/internal-loader-repair-v1');
  fixtures = path.join(output, 'fixtures'); fs.mkdirSync(fixtures);
  const selected = ['admission.mjs', 'internal-loader-arguments.mjs', 'worker-policy.mjs', 'tiny-loader.mjs', 'bootstrap.mjs', 'consumer-v2.mjs', 'application.mjs', 'application-error.mjs', 'hash-regular-file.mjs'];
  for (const name of selected) fs.copyFileSync(path.join(author, name), path.join(fixtures, name), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(path.join(author, '../preparation-v3/resources.mjs'), path.join(fixtures, 'resources.mjs'), fs.constants.COPYFILE_EXCL);
  const fixturesBefore = census(fixtures);
  ({ admit } = await import(pathToFileURL(path.join(fixtures, 'admission.mjs'))));
  policy = await import(pathToFileURL(path.join(fixtures, 'worker-policy.mjs')));
  ({ hashRegularFile } = await import(pathToFileURL(path.join(fixtures, 'hash-regular-file.mjs'))));
  await record('H01', () => { const value = hashRegularFile(path.join(author, 'PLAN.json')); assert.equal(value.sha256, digest(fs.readFileSync(path.join(author, 'PLAN.json')))); assert.ok(value.largestRead <= 65536); return value; });
  await record('H02', () => { assert.throws(() => hashRegularFile(fixtures)); return { directoryRefused: true }; });
  await record('H03', () => { const value = hashRegularFile(process.execPath); assert.equal(value.sha256, authentication.node.sha256); assert.equal(value.bytesRead, authentication.node.bytes); assert.ok(value.largestRead <= 65536 && value.readCalls > 1); return value; });
  await record('N01', () => {
    const specification = { root: output, output, node: process.execPath, caseId: 'P03', loader: path.join(fixtures, 'tiny-loader.mjs'), bootstrap: path.join(fixtures, 'bootstrap.mjs'), consumer: path.join(fixtures, 'consumer-v2.mjs'), manifestPath: output + '/unused.json', logPath: output + '/unused.log', files: fixturesBefore.map(row => ({ ...row, path: path.join(fixtures, row.path) })) };
    const environment = { PATH: path.dirname(process.execPath), HOME: output, TMPDIR: output, LC_ALL: 'C', NO_COLOR: '1', CASE_ID: 'P03', FIXTURE_MANIFEST: specification.manifestPath, FIXTURE_LOG: specification.logPath };
    const args = ['--test-reporter=tap', '--loader', specification.loader, specification.consumer];
    assert.equal(admit(specification, args, environment).filter(value => value === '--allow-worker').length, 1);
    assert.throws(() => admit(specification, [args[0], args[1], specification.loader + '.wrong', args[3]], environment));
    assert.throws(() => admit(specification, [...args, '--eval'], environment));
    const holey = [...args]; delete holey[2]; assert.throws(() => admit(specification, holey, environment));
    let getter = 0; const accessor = [...args]; Object.defineProperty(accessor, '2', { get() { getter++; return args[2]; } });
    assert.throws(() => admit(specification, accessor, environment)); assert.equal(getter, 0);
    assert.throws(() => admit(specification, args, { ...environment, NODE_OPTIONS: '--allow-worker' }));
    assert.throws(() => admit({ ...specification, files: specification.files.filter(row => row.path !== specification.loader) }, args, environment));
    for (const target of [specification.loader, specification.bootstrap]) {
      const bytes = fs.readFileSync(target);
      try { fs.appendFileSync(target, '\n'); assert.throws(() => admit(specification, args, environment), /source identity|strictly equal/); }
      finally { fs.writeFileSync(target, bytes); }
    }
    return { positive: 1, refusals: 8, getterCalls: getter };
  });
  assert.deepEqual(census(fixtures), fixturesBefore);
  await record('N06', () => {
    assert.equal(policy.admitWorker('/fixed', '/fixed', vm.runInNewContext('({execArgv:[], resourceLimits:{maxOldGenerationSizeMb:128,stackSizeMb:4}})'), 0, 0, 1), true);
    assert.throws(() => policy.admitWorker('/other', '/fixed', options(), 0, 0, 1));
    let getter = 0;
    for (const value of [{ ...options(), eval: true }, { ...options(), execArgv: ['--loader', '/other'] }, { ...options(), resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 5 } }, { get execArgv() { getter++; return []; }, resourceLimits: options().resourceLimits }]) assert.throws(() => policy.admitWorker('/fixed', '/fixed', value, 0, 0, 1));
    for (const counts of [[32, 0, 32], [0, 2, 32], [0, 0, 33]]) assert.throws(() => policy.admitWorker('/fixed', '/fixed', options(), ...counts));
    assert.equal(getter, 0); assert.equal(policy.terminalVerdict(7, null, 0, true, true), false); assert.equal(policy.terminalVerdict(0, null, 1, true, true), false);
    return { crossRealmPositive: true, refusals: 8, getterCalls: getter, terminalNegatives: 2 };
  });
  await record('N07', () => {
    const read = fs.readSync, close = fs.closeSync, reason = Object.freeze({ sentinel: 'OWNED_READ_FAILURE' });
    let closes = 0, observed;
    try { fs.readSync = () => { throw reason; }; fs.closeSync = descriptor => { closes++; return close(descriptor); }; try { hashRegularFile(path.join(author, 'PLAN.json')); } catch (error) { observed = error; } }
    finally { fs.readSync = read; fs.closeSync = close; }
    assert.equal(observed, reason); assert.equal(closes, 1);
    return { exactReason: true, descriptorCloses: closes };
  });
  for (const item of cases) await runCase(item);
  assert.deepEqual(census(fixtures), fixturesBefore); verifyInputs();
  result.finalCensus = census(output);
  result.workingBytes = result.finalCensus.reduce((sum, row) => sum + row.bytes, 0);
  assert.ok(result.workingBytes < 16777216);
  result.status = result.rows.length === 14 && result.rows.every(row => row.pass) ? 'QUALIFIED_HARMLESS_ONLY' : 'ORDINARY_ASSERTION_HOLD';
} catch (error) { result.status = 'SAFETY_ADMISSION_INTEGRITY_OR_CLEANUP_HOLD'; result.fatal = String(error.stack ?? error); }
result.elapsedMs = performance.now() - started;
result.allChildrenClosed = result.children.every(row => row.closed);
result.independentInternalWorkerExitCensus = null;
save();
checkTime();
console.log(JSON.stringify({ status: result.status, pass: result.rows.filter(row => row.pass).length, fail: result.rows.filter(row => !row.pass).length, children: result.children.length, allChildrenClosed: result.allChildrenClosed, internalAttempts: result.internalAttempts, applicationBirths: result.applicationBirths, applicationExits: result.applicationExits, elapsedMs: result.elapsedMs }));
process.exitCode = result.status === 'QUALIFIED_HARMLESS_ONLY' && result.allChildrenClosed ? 0 : 1;
