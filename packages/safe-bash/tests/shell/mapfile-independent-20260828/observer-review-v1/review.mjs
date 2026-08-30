import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const packetRelative = 'tests/shell/mapfile-design-20260828';
const packet = path.join(root, packetRelative);
const candidate = 'f2352a6300925480aaa53a494f6014b1d54a9618';
const git = (...args) => childProcess.execFileSync('git', args, { cwd: root, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
const sealPath = path.join(packet, 'observer-v1/MODULE-SEAL.json');
const sealBytes = git('show', `${candidate}:${packetRelative}/observer-v1/MODULE-SEAL.json`);
assert.equal(hash(sealBytes), 'd08585b8995ffd1399be27c17dc378357707106b93f12c240e92ffe57dadadc4');
const seal = JSON.parse(sealBytes);
const bound = new Map([[sealPath, hash(sealBytes)]]);
for (const [relative, expected] of Object.entries(seal.artifacts)) {
  const filename = path.join(packet, relative);
  assert.equal(hash(git('show', `${candidate}:${packetRelative}/${relative}`)), expected);
  bound.set(filename, expected);
}
const originalEvidence = path.join(root, 'tests/shell/mapfile-independent-20260828/DATA-AUDIT.json');
const oldEvidenceHash = hash(fs.readFileSync(originalEvidence));
assert.equal(oldEvidenceHash, hash(git('show', '959eff75:tests/shell/mapfile-independent-20260828/DATA-AUDIT.json')));
function checkFiles() {
  for (const [filename, expected] of bound) {
    assert.ok(fs.lstatSync(filename).isFile());
    assert.equal(fs.realpathSync(filename), filename);
    assert.equal(hash(fs.readFileSync(filename)), expected);
  }
  assert.deepEqual(fs.readdirSync(path.join(packet, 'observer-v1/modules')).sort(), seal.moduleFiles.slice().sort());
  assert.equal(hash(fs.readFileSync(originalEvidence)), oldEvidenceHash);
}
checkFiles();
const original = JSON.parse(fs.readFileSync(path.join(packet, 'OBSERVATIONS.json')));
const additions = JSON.parse(fs.readFileSync(path.join(packet, 'OBSERVATIONS-addendum-v2.json')));
const rows = [...original.rows, ...additions.rows];
assert.equal(rows.length, 43);
assert.equal(hash(Buffer.from(JSON.stringify(rows))), seal.combinedRecipeSha256);
for (const row of rows) {
  assert.equal(row.expectation, null);
  assert.equal(row.classification, 'neutral-not-executed');
  assert.equal(hash(Buffer.from(row.script)), row.scriptSha256);
  assert.equal(hash(Buffer.from(row.stdinHex, 'hex')), row.stdinSha256);
}
const loaded = new Map();
const hooks = registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith('node:')) return nextLoad(url, context);
  const filename = fileURLToPath(url);
  assert.ok(bound.has(filename) && filename.endsWith('.mjs'), `unbound module ${filename}`);
  const result = nextLoad(url, context);
  assert.notEqual(result.source, null);
  const bytes = Buffer.from(result.source);
  assert.equal(hash(bytes), bound.get(filename));
  loaded.set(filename, hash(bytes));
  return result;
} });
const forbidden = [];
const originalFunctions = [];
for (const [object, names] of [[childProcess, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']], [fs, ['mkdirSync', 'writeFileSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'chmodSync']]]) {
  for (const name of names) {
    originalFunctions.push([object, name, object[name]]);
    object[name] = () => { forbidden.push(name); throw new Error(`forbidden actual effect ${name}`); };
  }
}
const originalKill = process.kill;
process.kill = () => { forbidden.push('kill'); throw new Error('forbidden actual signal'); };
syncBuiltinESMExports();
const modules = {};
for (const name of seal.moduleFiles) modules[name] = await import(pathToFileURL(path.join(packet, 'observer-v1/modules', name)).href);
const author = await modules['synthetic.mjs'].syntheticControls();

class Port {
  constructor(scenario) {
    this.scenario = scenario; this.files = new Map(); this.sequence = 0; this.clock = 0;
    this.tasks = new Map(); this.taskId = 0; this.events = 0; this.maximumTasks = 0;
    this.starts = 0; this.releases = 0; this.signals = []; this.nativeHashes = 0; this.specs = []; this.late = 0;
    for (const filename of ['/', '/controls', '/controls/modules']) this.put(filename, 'directory');
    for (const name of seal.moduleFiles) this.put(`/controls/modules/${name}`, 'file', fs.readFileSync(path.join(packet, 'observer-v1/modules', name)));
    this.put('/controls/bash', 'file', Buffer.from('NOT_EXECUTABLE_NATIVE_MODEL'), 0o755);
    this.put('/controls/node', 'file', Buffer.from('NOT_EXECUTABLE_RUNTIME_MODEL'), 0o755);
    this.put('/controls/config', 'file', Buffer.from('BOUND_SYNTHETIC_CONFIG'));
  }
  put(filename, kind, bytes = Buffer.alloc(0), mode = kind === 'directory' ? 0o700 : 0o644) { this.files.set(filename, { kind, bytes: Buffer.from(bytes), identity: ++this.sequence, mode }); }
  stat(filename) {
    if (this.scenario === 'post-mkdir-stat-fails' && filename === '/owned' && this.files.has(filename)) throw new Error('inspection after mkdir failed');
    const record = this.files.get(filename); assert.ok(record, `missing ${filename}`);
    return { ...record, bytes: record.bytes.length };
  }
  read(filename) { assert.ok(this.files.has(filename)); return Buffer.from(this.files.get(filename).bytes); }
  hash(filename, count) {
    if (filename === '/controls/bash' && ++this.nativeHashes === 2 && this.scenario === 'deadline-crossed-during-auth') this.clock = 150000;
    const bytes = this.read(filename); assert.equal(bytes.length, count); return hash(bytes);
  }
  runtimeIdentity() { return { path: '/controls/node', version: this.scenario === 'runtime-version-wrong' ? 'wrong' : 'MODEL', platform: 'synthetic', arch: 'synthetic' }; }
  canonical(filename) { return filename; }
  list(directory) { return [...this.files.keys()].filter(filename => filename !== directory && path.dirname(filename) === directory).map(filename => path.basename(filename)); }
  mkdir(filename) { assert.ok(!this.files.has(filename)); this.put(filename, 'directory'); }
  rmdir(filename) { assert.deepEqual(this.list(filename), []); this.files.delete(filename); }
  writeExclusive(filename, bytes) {
    if (this.scenario === 'spawn-publication-fails' && filename.includes('/spawn-')) throw new Error('spawn publication failure');
    if (this.scenario === 'final-publication-fails' && filename.endsWith('/final.json')) throw new Error('final publication failure');
    assert.ok(!this.files.has(filename)); this.put(filename, 'file', bytes, 0o600);
    if (filename.endsWith('/final.json')) {
      if (this.scenario === 'final-mode-only') this.files.get('/controls/modules/storage.mjs').mode = 0o777;
      if (this.scenario === 'final-receipt-changed') this.files.get('/owned/records/attempt-N01.json').bytes = Buffer.from('changed');
      if (this.scenario === 'final-auth-changed') this.files.get('/controls/auth').bytes = Buffer.from('{}');
      if (this.scenario === 'final-new-module') this.put('/controls/modules/unadmitted.mjs', 'file');
    }
  }
  now() { return this.clock; }
  timer(delay, callback) { const id = ++this.taskId; this.tasks.set(id, { at: this.clock + delay, callback }); this.maximumTasks = Math.max(this.maximumTasks, this.tasks.size); return id; }
  clearTimer(id) { this.tasks.delete(id); }
  start(spec, callbacks) {
    this.starts++; this.specs.push(spec);
    assert.equal(spec.executable, '/controls/bash');
    assert.deepEqual(spec.args.slice(0, 3), ['--noprofile', '--norc', '-c']);
    assert.equal(spec.args.length, 5); assert.equal(spec.args[4], 'mapfile-design-v1');
    assert.equal(spec.cwd, '/owned/fixture');
    assert.deepEqual(spec.env, { PATH: '', ENV: '', BASH_ENV: '', HOME: '/owned/fixture/home', TMPDIR: '/owned/fixture/tmp', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' });
    if (this.scenario === 'sync-spawn-throw') throw new Error('sync spawn failure');
    if (this.scenario === 'async-no-process') {
      this.timer(0, () => callbacks.error(new Error('async spawn failure')));
      this.timer(1, () => { this.late++; callbacks.close(null, null); });
      return { pid: undefined, release: () => { this.releases++; } };
    }
    let alive = true, closed = false;
    const close = () => {
      if (closed) return; closed = true;
      alive = this.scenario === 'group-survives';
      callbacks.exit(this.scenario === 'nonzero-neutral' ? 7 : 0, null);
      callbacks.close(this.scenario === 'nonzero-neutral' ? 7 : 0, null);
      if (this.scenario === 'replace-fixture') this.put('/owned/fixture/tmp', 'directory');
      if (this.scenario === 'append-fixture') this.put('/owned/fixture/foreign', 'file');
    };
    if (this.scenario !== 'close-without-spawn') this.timer(this.scenario === 'late-spawn' ? 3001 : 0, callbacks.spawn);
    if (!['missing-close', 'late-spawn', 'deadline-crossed-during-auth'].includes(this.scenario)) this.timer(10, close);
    if (this.scenario.startsWith('output-')) this.timer(5, () => {
      const count = this.scenario === 'output-exact' ? 65536 : 65537;
      for (let index = 0; index < (this.scenario === 'output-repeated' ? 200 : 1); index++) callbacks.data('stdout', Buffer.alloc(count));
    });
    if (this.scenario === 'invalid-output-channel') this.timer(5, () => callbacks.data('other', Buffer.from('x')));
    if (this.scenario === 'empty-output') this.timer(5, () => { for (let index = 0; index < 200; index++) callbacks.data('stdout', Buffer.alloc(0)); });
    return {
      pid: 9000 + this.starts,
      groupExists: () => alive,
      signalGroup: signal => { this.signals.push(signal); if (this.scenario !== 'group-survives') alive = false; if (!['missing-close', 'late-spawn'].includes(this.scenario)) this.timer(1, close); },
      release: () => { this.releases++; },
    };
  }
  async drive(promise) {
    let done = false, value, failure;
    promise.then(result => { done = true; value = result; }, error => { done = true; failure = error; });
    while (!done || this.tasks.size) {
      for (let count = 0; count < 8; count++) await Promise.resolve();
      if (done && !this.tasks.size) break;
      const next = [...this.tasks].sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      assert.ok(next, 'no scheduled progress'); assert.ok(++this.events <= 4096);
      this.tasks.delete(next[0]); this.clock = Math.max(this.clock, next[1].at); assert.ok(this.clock <= 150001);
      next[1].callback();
    }
    if (failure) throw failure; return value;
  }
}
function configFor(port) {
  const runtime = { path: '/controls/node', version: 'MODEL', platform: 'synthetic', arch: 'synthetic', bytes: port.read('/controls/node').length, sha256: hash(port.read('/controls/node')) };
  const config = { schema: 'mapfile-observer-v1', mode: 'synthetic', runtime, protected: {}, moduleRoot: '/controls/modules', moduleFiles: seal.moduleFiles, moduleSealSha256: hash(sealBytes), authorizationPath: '/controls/auth', recipeSha256: seal.combinedRecipeSha256, rows, rowIds: port.scenario === 'all43-neutral' ? rows.map(row => row.id) : ['N01'], outputRoot: '/owned', binary: '/controls/bash', binaryBytes: port.read('/controls/bash').length, binarySha256: hash(port.read('/controls/bash')) };
  if (port.scenario === 'duplicate-ids') config.rowIds = ['N01', 'N01'];
  const authority = { kind: port.scenario === 'no-authority' ? 'NONE' : 'SYNTHETIC_ONLY', runtime, moduleSealSha256: config.moduleSealSha256, recipeSha256: config.recipeSha256, rowIds: config.rowIds, outputRoot: config.outputRoot };
  port.put('/controls/auth', 'file', Buffer.from(JSON.stringify(authority)));
  config.authorizationSha256 = hash(port.read('/controls/auth'));
  for (const [filename, item] of port.files) if (item.kind === 'file' && !['/controls/node', '/controls/bash'].includes(filename)) config.protected[filename] = hash(item.bytes);
  if (port.scenario === 'module-mode-only') port.files.get('/controls/modules/admission.mjs').mode = 0o777;
  if (port.scenario === 'native-not-executable') port.files.get('/controls/bash').mode = 0o644;
  if (port.scenario === 'runtime-not-executable') port.files.get('/controls/node').mode = 0o644;
  if (port.scenario === 'runtime-missing') port.files.delete('/controls/node');
  if (port.scenario === 'module-symlink') port.files.get('/controls/modules/admission.mjs').kind = 'symlink';
  return config;
}
const cases = [
  ['positive', true], ['all43-neutral', true], ['nonzero-neutral', true],
  ['module-mode-only', false], ['native-not-executable', false], ['runtime-not-executable', false], ['final-mode-only', false],
  ['deadline-crossed-during-auth', false], ['missing-close', false], ['group-survives', false],
  ['sync-spawn-throw', false], ['async-no-process', false], ['close-without-spawn', false], ['late-spawn', false],
  ['post-mkdir-stat-fails', false], ['spawn-publication-fails', false], ['final-publication-fails', false],
  ['final-receipt-changed', false], ['final-auth-changed', false], ['final-new-module', false],
  ['replace-fixture', false], ['append-fixture', false], ['output-repeated', false], ['invalid-output-channel', false],
  ['duplicate-ids', false], ['no-authority', false], ['runtime-missing', false], ['runtime-version-wrong', false],
  ['module-symlink', false], ['output-exact', true], ['output-overflow', false], ['empty-output', true],
];
const independent = [];
for (const [scenario, expectedSuccess] of cases) {
  const port = new Port(scenario), config = configFor(port);
  const result = { scenario, expectedSuccess, pass: false };
  try {
    const report = await port.drive(modules['observer.mjs'].runObserver(port, config));
    result.report = report;
    assert.equal(report.success, expectedSuccess);
    if (scenario === 'deadline-crossed-during-auth') assert.equal(port.starts, 0, 'no start after prelaunch authentication crosses deadline');
    if (scenario === 'post-mkdir-stat-fails') { assert.equal(report.directories[0].planned, true); assert.equal(report.directories[0].acquired, true); assert.equal(report.directories[0].identity, null); assert.equal(port.starts, 0); }
    if (scenario === 'spawn-publication-fails') { assert.equal(report.launched, 1); assert.equal(report.actualCloseEvents, 1); assert.equal(port.releases, 1); }
    if (scenario === 'final-publication-fails') { assert.equal(report.launched, 1); assert.ok(report.failures.some(row => row.phase === 'final-persistence')); }
    if (scenario === 'replace-fixture') assert.ok(port.files.has('/owned/fixture/tmp'));
    if (scenario === 'append-fixture') assert.ok(port.files.has('/owned/fixture/foreign'));
    if (['missing-close', 'group-survives', 'late-spawn'].includes(scenario)) { assert.equal(report.rows[0].terminal, 'terminal-cleanup-uncertain'); assert.ok(report.rows[0].elapsed <= 3000); }
    if (scenario === 'output-repeated') { assert.ok(port.maximumTasks <= 16); assert.ok(port.signals.length <= 4); assert.ok(report.outputBytesRetained <= 65536); }
    if (['sync-spawn-throw', 'async-no-process'].includes(scenario)) { assert.equal(report.launched, 0); assert.equal(report.actualCloseEvents, 0); }
    if (scenario === 'all43-neutral') assert.equal(port.starts, 43);
    assert.equal(port.tasks.size, 0);
    result.pass = true;
  } catch (error) { result.error = { name: error.name, message: error.message }; }
  result.model = { starts: port.starts, releases: port.releases, events: port.events, clock: port.clock, maximumTasks: port.maximumTasks, pending: port.tasks.size, signals: port.signals, late: port.late };
  port.files.clear(); independent.push(result);
}
const plannedPort = new Port('planned-owner-control');
const owned = new modules['storage.mjs'].OwnedStorage(plannedPort, '/owned');
const originalMkdir = plannedPort.mkdir.bind(plannedPort);
plannedPort.mkdir = filename => { assert.equal(owned.directories.at(-1).path, filename); assert.equal(owned.directories.at(-1).planned, true); assert.equal(owned.directories.at(-1).acquired, false); originalMkdir(filename); };
owned.acquire('/owned');
plannedPort.files.clear();
assert.equal(forbidden.length, 0);
assert.equal(loaded.size, 7);
checkFiles();
hooks.deregister();
for (const [object, name, value] of originalFunctions) object[name] = value;
process.kill = originalKill; syncBuiltinESMExports();
const authorJson = Buffer.from(JSON.stringify(author));
const result = {
  schema: 'mapfile-independent-observer-review-v1', candidate,
  reviewerScriptSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
  presealSha256: hash(fs.readFileSync(path.join(here, 'PRESEAL.json'))),
  actualNode: { path: process.execPath, version: process.version, sha256: hash(fs.readFileSync(process.execPath)) },
  loaded: [...loaded].map(([filename, sha256]) => ({ filename, sha256 })),
  modeQualification: 'candidate port does not expose/check modes; synthetic same-byte mode changes are explicit unbound-policy controls',
  authorReplay: { passed: author.passed, total: author.total, original: author.originalTotal, supplemental: author.supplementalTotal, cliMissingAdmissionRejected: author.cliMissingAdmissionRejected, jsonSha256: hash(authorJson), jsonBytes: authorJson.length, gzipBase64: gzipSync(authorJson).toString('base64') },
  independent: { passed: independent.filter(row => row.pass).length, total: independent.length, cases: independent },
  directStorageOwnershipControl: 'passed register-before-mkdir on actual complete storage module with synthetic dependency',
  original43: { nativeCalls: 0, original: 32, additive: 11, scripts: rows.reduce((total, row) => total + Buffer.byteLength(row.script), 0), stdin: rows.reduce((total, row) => total + row.stdinHex.length / 2, 0), sha256: seal.combinedRecipeSha256 },
  realObserverChildren: 0, nativeCalls: 0, productCalls: 0, realDriverInstantiations: 0, forbiddenActualEffects: forbidden,
};
const text = JSON.stringify(result);
assert.ok(Buffer.byteLength(text) <= 4194304);
console.log(text);
if (author.passed !== author.total || independent.some(row => !row.pass)) process.exitCode = 1;
