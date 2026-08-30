import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const capture = path.join(root, 'capture');
const primaryFd = fs.openSync(path.join(capture, 'review.events.jsonl'), 'wx');
const report = {owner: {pid: process.pid, enteredAt: Date.now()}, results: [], children: [], productImports: 0, productCalls: 0, safetyStop: false};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function event(value) { fs.writeSync(primaryFd, JSON.stringify(value) + '\n'); }
function read(filename, pin) {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, pin.bytes);
  assert(stat.size <= 2097152);
  const bytes = fs.readFileSync(filename);
  assert.equal(hash(bytes), pin.sha256);
  return bytes;
}
async function test(id, body) {
  try { await body(); report.results.push({id, pass: true}); }
  catch (reason) { report.results.push({id, pass: false, reasonPresent: true, reason: String(reason)}); }
}
async function child(node, args, cwd, env) {
  const stdoutPath = path.join(capture, 'author-repeat.stdout.raw');
  const stderrPath = path.join(capture, 'author-repeat.stderr.raw');
  const stdout = fs.openSync(stdoutPath, 'wx');
  const stderr = fs.openSync(stderrPath, 'wx');
  const row = {args, enteredAt: Date.now(), exit: false, close: false, signals: []};
  report.children.push(row);
  let owned;
  let timer;
  try {
    await new Promise(resolve => {
      owned = spawn(node, args, {cwd, env, stdio: ['ignore', stdout, stderr], detached: false});
      row.pid = owned.pid;
      owned.on('error', reason => { row.error = String(reason); });
      owned.on('exit', (status, signal) => { row.exit = true; row.exitedAt = Date.now(); row.status = status; row.signal = signal; });
      owned.on('close', () => { row.close = true; row.closedAt = Date.now(); clearTimeout(timer); resolve(); });
      timer = setTimeout(() => {
        report.safetyStop = true;
        row.signals.push('SIGTERM');
        owned.kill('SIGTERM');
        timer = setTimeout(() => { row.signals.push('SIGKILL'); owned.kill('SIGKILL'); }, 2000);
      }, 20000);
    });
    assert(row.exit && row.close && !row.error && !row.signal && row.signals.length === 0);
    assert.equal(row.status, 0);
    for (const descriptor of [stdout, stderr]) {
      fs.fsyncSync(descriptor);
      assert(fs.fstatSync(descriptor).size < 2097152);
    }
  } finally { clearTimeout(timer); fs.closeSync(stdout); fs.closeSync(stderr); event({child: row}); }
}
try {
  const sealBytes = fs.readFileSync(path.join(root, 'PRESEAL.json'));
  assert.equal(hash(sealBytes), process.argv[2]);
  const seal = JSON.parse(sealBytes);
  assert(Date.now() < seal.deadline);
  for (const row of seal.inputs) read(row.path, row);
  read(fileURLToPath(import.meta.url), seal.executor);
  const packet = seal.packet;
  const authorSeal = JSON.parse(read(path.join(root, 'AUTHOR-REPEAT-SEAL.json'), seal.authorRepeat));
  const auth = await import(pathToFileURL(path.join(packet, 'auth.mjs')));
  auth.pinExecutable(authorSeal.node);
  const profile = await import(pathToFileURL(path.join(packet, 'profile.mjs')));
  const adapter = await import(pathToFileURL(path.join(packet, 'case-adapter.mjs')));
  const mechanism = await import(pathToFileURL(path.join(packet, 'mechanism.mjs')));
  const data = await import(pathToFileURL(path.join(packet, 'data.mjs')));
  const work = seal.work;
  assert(fs.lstatSync(work).isDirectory());
  assert.equal(fs.realpathSync(work), work);
  const args = [path.join(packet, 'controls.mjs'), path.join(root, 'AUTHOR-REPEAT-SEAL.json'), seal.authorRepeat.sha256, work];
  await child(authorSeal.node.path, args, process.cwd(), {PATH: '/usr/bin:/bin', HOME: work, TMPDIR: work, LC_ALL: 'C', LANG: 'C', TZ: 'UTC'});
  const authorResultPath = path.join(work, 'CONTROL-RESULT.json');
  const authorStat = fs.lstatSync(authorResultPath);
  assert(authorStat.isFile() && authorStat.size < 2097152);
  const authorResult = JSON.parse(fs.readFileSync(authorResultPath));
  report.author = authorResult;
  if (authorResult.primaryPresent || authorResult.ledger.stopped || authorResult.actual.some(row => !row.pass)) {
    report.safetyStop = true;
    throw Error('AUTHOR_ROLE_STOP');
  }
  assert.equal(authorResult.data.length, 6);
  assert.equal(authorResult.actual.length, 4);
  const role = JSON.parse(fs.readFileSync(path.join(work, 'H01.role.json')));
  const baseRow = {program: 'fixture-only', stdinBase64: '', virtualInvocation: {cwd: '/case/work', environment: {}}};
  class FixtureFS { async mkdir() {} async readdir() { return []; } }
  const result = {exitCode: 0, stdoutBytes: new Uint8Array(), stderrBytes: new Uint8Array()};
  await test('I01', () => {
    const source = read(path.join(capture, 'shell-source.raw'), seal.shellSource).toString();
    assert(source.includes('async exec(source: string, options: ShellExecOptions = {}): Promise<ShellResult>'));
    assert(source.includes('dispose(): Promise<void>'));
    assert(source.includes('await Promise.all(active.map(({ owner }) => owner.finalized))'));
    assert(!source.includes('asyncDispose():'));
  });
  await test('I02', async () => {
    let releaseExec, releaseDispose;
    const events = [];
    const execGate = new Promise(resolve => { releaseExec = resolve; });
    const disposeGate = new Promise(resolve => { releaseDispose = resolve; });
    class FixtureShell {
      use() { return this; }
      async exec() { events.push('exec'); await execGate; return result; }
      async dispose() { events.push('dispose'); await disposeGate; events.push('disposed'); }
    }
    let settled = false;
    const pending = adapter.runCase({MemoryFileSystem: FixtureFS, Shell: FixtureShell, agentCommands: () => ({})}, baseRow, []).then(value => { settled = true; return value; });
    try {
      for (let turn = 0; turn < 20 && !events.length; turn++) await Promise.resolve();
      assert.deepEqual(events, ['exec']); assert.equal(settled, false);
      releaseExec();
      for (let turn = 0; turn < 20 && events.length < 2; turn++) await Promise.resolve();
      assert.deepEqual(events, ['exec', 'dispose']); assert.equal(settled, false);
      releaseDispose();
      const observation = await pending;
      assert.equal(observation.publicSettlement.disposeSettled, true);
      assert.deepEqual(observation.publicSettlement.events, ['exec-started', 'exec-resolved', 'dispose-started', 'dispose-resolved']);
    } finally { releaseExec(); releaseDispose(); await pending; }
  });
  await test('I03', async () => {
    class FixtureShell { use() { return this; } async exec() { throw false; } async dispose() { throw 0; } }
    const observation = await adapter.runCase({MemoryFileSystem: FixtureFS, Shell: FixtureShell, agentCommands: () => ({})}, baseRow, []);
    assert.equal(observation.hasPrimary, true); assert.equal(observation.primary, false);
    assert.equal(observation.hasCleanupError, true); assert.equal(observation.cleanupError, 0);
    assert.equal(observation.publicSettlement.disposeRejected, true);
  });
  await test('I04', () => {
    const original = profile.caseArguments(role);
    const env = {SURFACE_ROLE: role.rolePath};
    for (const extra of ['--allow-child-process', '--allow-worker', '--loader=data:text/javascript,']) {
      assert.throws(() => profile.validateArguments(role, [...original, extra], env));
    }
    assert.throws(() => profile.validateArguments(role, original, {...env, NODE_OPTIONS: ''}));
    assert.throws(() => profile.validateRole({...role, loaderThreads: 1}));
  });
  await test('I05', () => {
    const lifecycle = {exit: true, close: true, stdoutEOF: true, stderrEOF: true, capturesQualified: true, forced: false, primaryPresent: false};
    const receipt = {profile: profile.PROFILE, publicSettlement: {execObserved: true, disposeSettled: true, disposeRejected: false}};
    assert.equal(profile.completion(receipt, lifecycle), true);
    for (const key of ['execObserved', 'disposeSettled']) assert.equal(profile.completion({...receipt, publicSettlement: {...receipt.publicSettlement, [key]: false}}, lifecycle), false);
    assert.equal(profile.completion({...receipt, publicSettlement: {...receipt.publicSettlement, disposeRejected: true}}, lifecycle), false);
    assert.equal(profile.completion(receipt, {...lifecycle, forced: true}), false);
    assert.equal(profile.completion(receipt, {...lifecycle, primaryPresent: true}), false);
  });
  await test('I06', () => {
    const current = {present: true, reason: false};
    assert.equal(mechanism.retainPrimary(current, {present: true, reason: 0}), current);
    let writes = 0;
    const store = new mechanism.Storage('/fixture', {bodyDeadline: 1, finalDeadline: 2, maximum: 8}, () => 3, {openSync() { writes++; }});
    assert.throws(() => store.file('fixture', Buffer.from('x')), /BODY_DEADLINE/);
    assert.equal(writes, 0);
  });
  await test('I07', () => {
    const matrix = JSON.parse(read(path.join(packet, 'MATRIX.json'), authorSeal.files['MATRIX.json']));
    data.validateMatrix(matrix);
    assert.equal(matrix.cases.length, 37); assert.equal(matrix.fixtures.length, 4);
    assert.equal(hash(read(path.join(packet, 'MATRIX.json'), authorSeal.files['MATRIX.json'])), 'b7aa013cdc2d74a8ebdf400b4db1cc475479a13eb62aaa2303d8f28f1295c74e');
  });
  await test('I08', () => {
    for (const key of ['app', 'entry', 'guard']) {
      const filename = role[key];
      assert.equal(fs.realpathSync(filename), filename);
      assert.equal(fs.lstatSync(filename).isSymbolicLink(), false);
    }
    const trace = authorResult.actual.find(row => row.id === 'H03').traceRows;
    assert.equal(trace.filter(row => row.event === 'synchronous-hooks-installed').length, 1);
    assert(!trace.some(row => row.event === 'module-loaded' && /\/(wrong|unlisted)\.mjs$/.test(row.url)));
  });
  for (const row of seal.inputs) read(row.path, row);
  report.status = report.results.every(row => row.pass) ? 'SCOPED_CONTROLS_PASS' : 'ASSERTION_FINDINGS';
  if (report.status !== 'SCOPED_CONTROLS_PASS') process.exitCode = 1;
} catch (reason) {
  report.status = 'HOLD'; report.primaryPresent = true; report.primary = String(reason); process.exitCode = 1;
} finally {
  report.owner.finalizingAt = Date.now();
  event({terminal: report.status, reasonPresent: report.primaryPresent === true, primary: report.primary});
  fs.writeFileSync(path.join(root, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  fs.closeSync(primaryFd);
  console.log(JSON.stringify({status: report.status, independent: report.results, primary: report.primary, childCount: report.children.length}));
}

