import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import vm from 'node:vm';
import { ownership, retired, supervise } from './supervisor.mjs';
import { deadline } from './deadline.mjs';
import { parseTree, treeHash, verifyProjection, batchObjects } from './path-bytes.mjs';
import { readCapture } from './capture-io.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, '../../../..');
const metadata = JSON.parse(fs.readFileSync(path.join(own, 'METADATA.json')));
const seal = JSON.parse(fs.readFileSync(path.join(own, 'EXECUTION-SEAL.json')));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const oid = (kind, value) => crypto.createHash('sha1').update(`${kind} ${value.length}\0`).update(value).digest('hex');
const go = JSON.parse(fs.readFileSync(path.join(own, 'ROOT-GO.json')));
assert.equal(go.authorization, 'FRESH ROOT GO');
assert.equal(go.attempt, 1);
assert.equal(go.candidate, metadata.candidate);
assert.equal(go.sealSha256, hash(fs.readFileSync(path.join(own, 'EXECUTION-SEAL.json'))));
const clock = deadline(6600000);
const work = path.join(own, '.work-v2');
const evidenceDirectory = path.join(own, 'evidence');
const owners = [];
const runs = [];
const facts = { started: new Date().toISOString(), controllerPid: process.pid, metadataSha256: hash(fs.readFileSync(path.join(own, 'METADATA.json'))), sealSha256: hash(fs.readFileSync(path.join(own, 'EXECUTION-SEAL.json'))), phases: [], product: [], types: [], controls: [] };
let capturedBytes = 0;
let persistedBytes = 0;
let admittedWorkingBytes = 64 * 1024 * 1024;
let sequence = 0;
let stopped;
let workIdentity;
const environment = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(work, 'home'), TMPDIR: path.join(work, 'tmp'), NO_COLOR: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' };
function inventory(directory, maximum = 512 * 1024 * 1024) {
  const output = {};
  let total = 0;
  let count = 0;
  function walk(relative, depth) {
    assert.ok(depth <= 64);
    for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
      assert.ok(++count <= 20000);
      const key = relative ? `${relative}/${name}` : name;
      const filename = path.join(directory, key);
      const stat = fs.lstatSync(filename);
      assert.ok(!stat.isSymbolicLink(), key);
      if (stat.isDirectory()) { output[key + '/'] = { kind: 'directory', mode: stat.mode & 0o777 }; walk(key, depth + 1); }
      else {
        assert.ok(stat.isFile()); total += stat.size; assert.ok(total <= maximum);
        output[key] = { kind: 'file', bytes: stat.size, mode: stat.mode & 0o777, sha256: hash(fs.readFileSync(filename)) };
      }
    }
  }
  walk('', 0);
  facts.peakWorkingBytes = Math.max(facts.peakWorkingBytes ?? 0, directory === work ? total : 0);
  return output;
}
function put(filename, value) {
  clock.check('write', 30000);
  const data = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  assert.ok(data.length <= 32 * 1024 * 1024);
  if (filename.startsWith(work + path.sep)) { assert.ok(admittedWorkingBytes + data.length <= 512 * 1024 * 1024); admittedWorkingBytes += data.length; }
  else { assert.ok(persistedBytes + data.length <= 112 * 1024 * 1024, 'capture reserve including final receipt'); persistedBytes += data.length; }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, data, { flag: 'wx', mode: 0o644 });
}
function checkTools() {
  for (const group of metadata.tools) {
    for (const entry of group.entries ?? [group]) {
      const filename = path.resolve(repository, entry.path);
      const stat = fs.lstatSync(filename);
      assert.equal(stat.mode & 0o777, entry.mode, filename);
      if (entry.type === 'directory') assert.ok(stat.isDirectory());
      else { assert.ok(stat.isFile()); assert.equal(stat.size, entry.bytes); assert.equal(hash(fs.readFileSync(filename)), entry.sha256, filename); }
    }
    if (group.directory) {
      const current = inventory(path.join(repository, group.directory), 128 * 1024 * 1024);
      assert.equal(Object.keys(current).length, group.entries.length, `tool additions ${group.directory}`);
    }
  }
}
function checkHarness() {
  for (const [name, expected] of Object.entries(seal.files)) {
    const filename = path.join(own, name);
    assert.equal(fs.lstatSync(filename).mode & 0o777, expected.mode, name);
    assert.equal(hash(fs.readFileSync(filename)), expected.sha256, name);
  }
  const allowed = new Set([...Object.keys(seal.files).map(name => name.split('/')[0]), 'PRESEAL.json', 'ROOT-GO.json', 'ROOT-COORDINATION.md', 'runs', 'REPORT.md', 'EXECUTION-SEAL.json', 'RUNTIME-SEAL.json', 'RUNTIME-START.json', 'BUILD-RECEIPT.json', 'FINAL.json', 'REPORT.md', '.work-v2', 'evidence', 'mutations']);
  for (const name of fs.readdirSync(own)) assert.ok(allowed.has(name), `unadmitted harness entry ${name}`);
  assert.deepEqual(fs.readdirSync(path.join(own, 'inventory-v1')).sort(), Object.keys(seal.files).filter(name => name.startsWith('inventory-v1/')).map(name => name.slice('inventory-v1/'.length)).sort(), 'metadata capture append guard');
}
function ownEqual(value, expected) {
  if (expected === null || typeof expected !== 'object') return typeof value === typeof expected && Object.is(value, expected) && (typeof value !== 'number' || Number.isFinite(value));
  if (!value || typeof value !== 'object' || Array.isArray(value) !== Array.isArray(expected)) return false;
  const keys = Reflect.ownKeys(value);
  const expectedKeys = Reflect.ownKeys(expected);
  if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== 'string' || !expectedKeys.includes(key))) return false;
  return expectedKeys.every(key => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && Object.hasOwn(descriptor, 'value') && ownEqual(descriptor.value, expected[key]); });
}
function protocolControls() {
  const valid = { version: 1, role: 'independent-matrix', route: 'synthetic-data-only', caseIds: ['P01', 'S01'], execution: 'NOT_RUN' };
  let accessors = 0;
  const controls = [
    [true, value => value], [true, () => vm.runInNewContext(`(${JSON.stringify(valid)})`)], [true, value => Object.assign(Object.create(null), value)],
    [false, value => ({ ...value, extra: true })], [false, value => Object.defineProperty(value, 'extra', { value: true })], [false, value => Object.assign(value, { [Symbol('extra')]: true })],
    [false, value => Object.defineProperty(value, 'version', { get() { accessors++; return 1; } })], [false, value => { delete value.caseIds[0]; return value; }],
    [false, value => { value.caseIds.extra = true; return value; }], [false, value => { value.caseIds.reverse(); return value; }], [false, value => { value.caseIds[1] = 'P01'; return value; }],
    [false, value => ({ ...value, version: NaN })], [false, value => ({ ...value, version: new Number(1) })],
    [false, value => { delete value.role; return Object.assign(Object.create({ role: valid.role }), value); }], [false, value => { delete value.execution; return value; }],
    [false, value => ({ ...value, role: 'author' })], [false, value => ({ ...value, execution: 'PASS' })], [false, value => ({ ...value, route: 'product' })],
    [false, value => { Object.defineProperty(value.caseIds, '0', { get() { accessors++; return 'P01'; } }); return value; }], [false, value => ({ ...value, version: Infinity })],
  ];
  controls.forEach(([expected, transform], index) => { assert.equal(ownEqual(transform(structuredClone(valid)), valid), expected); facts.controls.push({ id: `T${String(index + 1).padStart(2, '0')}`, accepted: expected, productDispatches: 0 }); });
  assert.equal(accessors, 0);
  for (const reason of [false, 0, null, undefined, {}]) { let caught = false; try { throw reason; } catch (actual) { assert.equal(actual, reason); caught = true; } assert.equal(caught, true); }
  facts.controls.push({ id: 'reason-identities', variants: 5, productDispatches: 0 });
}
async function child(id, role, executable, args, cwd, input) {
  const planned = seal.jobs.find(job => job.id === id);
  assert.ok(planned && ownEqual({ id, role }, { id: planned.id, role: planned.role }), `unplanned role ${id}`);
  assert.equal(executable, role === 'git' ? '/usr/bin/git' : process.execPath);
  assert.ok(!runs.some(run => run.id === id), `no retries ${id}`);
  assert.ok(owners.every(retired), 'unretired owned child');
  clock.check(id, 30000 + planned.timeoutMs + 2500);
  assert.ok(persistedBytes + planned.maxBytes * 2 + 48 * 1024 * 1024 <= 128 * 1024 * 1024, 'capture admission reserve');
  checkHarness(); checkTools(); inventory(work);
  const owner = ownership(id, role); owners.push(owner);
  const run = await supervise(executable, args, { cwd, env: environment, input, timeoutMs: planned.timeoutMs, maxBytes: planned.maxBytes }, owner, clock);
  capturedBytes += run.bytes;
  assert.ok(capturedBytes <= 128 * 1024 * 1024);
  const capture = { id, role, ...run };
  runs.push(capture);
  const stem = `${String(++sequence).padStart(3, '0')}-${id}`;
  const channels = { stdout: Buffer.from(run.stdoutBase64, 'base64'), stderr: Buffer.from(run.stderrBase64, 'base64') };
  const fragments = [];
  for (const [channel, payload] of Object.entries(channels)) for (let offset = 0; offset < payload.length; offset += 65536) {
    const fragment = payload.subarray(offset, offset + 65536);
    const name = `${stem}-${channel}-${offset}.json`;
    const record = { channel, offset, totalBytes: payload.length, base64: fragment.toString('base64'), sha256: hash(fragment) };
    put(path.join(evidenceDirectory, name), record); fragments.push({ name, bytes: fragment.length, sha256: hash(fragment) });
  }
  const { stdout, stderr, stdoutBase64, stderrBase64, ...description } = capture;
  const receipt = { ...description, fragments, stdoutSha256: hash(channels.stdout), stderrSha256: hash(channels.stderr) };
  const filename = path.join(evidenceDirectory, `${stem}.json`);
  put(filename, receipt);
  assert.equal(hash(fs.readFileSync(filename)), hash(Buffer.from(JSON.stringify(receipt, null, 2) + '\n')));
  assert.ok(retired(owner), `unknown child retirement ${id}`);
  assert.equal(run.fault, null, `unsafe child ${id}`);
  assert.equal(run.signal, null, `signal ${id}`);
  checkHarness(); checkTools(); inventory(work);
  console.log(JSON.stringify({ id, role, code: run.code, bytes: run.bytes, pid: run.pid, closed: run.closeObserved, groupAbsent: run.groupAbsent, elapsedMs: clock.elapsed() }));
  return capture;
}
function packageInventory(directory) {
  return Object.fromEntries(Object.entries(inventory(directory)).filter(([name]) => name.startsWith('dist/') || name === 'README.md' || name === 'package.json'));
}
function copyPackage(source, destination, admitted) {
  assert.equal(fs.existsSync(destination), false); fs.mkdirSync(destination, { recursive: true });
  for (const [name, entry] of Object.entries(admitted)) {
    const target = path.join(destination, name);
    if (entry.kind === 'directory') { fs.mkdirSync(target, { recursive: true, mode: entry.mode }); continue; }
    const payload = fs.readFileSync(path.join(source, name)); assert.equal(hash(payload), entry.sha256);
    put(target, payload); fs.chmodSync(target, entry.mode);
  }
  assert.deepEqual(inventory(destination), admitted);
}
function materializeHarness(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const names = ['bootstrap.mjs', 'loader.mjs', 'worker.mjs'];
  for (const name of names) put(path.join(directory, name), fs.readFileSync(path.join(own, name)));
  for (const name of ['ORIGINAL32-v1.json', 'SUPPLEMENT-v1.json']) {
    const expected = metadata.matrix.find(entry => entry.path.endsWith('/' + name));
    const payload = fs.readFileSync(path.join(repository, expected.path)); assert.equal(hash(payload), expected.sha256);
    put(path.join(directory, name), payload); names.push(name);
  }
  const current = inventory(directory);
  return Object.fromEntries(names.map(name => [name, current[name]]));
}
async function runtime(id, layout, directory, product, admitted, extra = {}) {
  const planned = seal.jobs.find(job => job.id === id);
  const fixtureRoot = path.join(directory, `fixtures-${id}`); fs.mkdirSync(fixtureRoot);
  const manifest = path.join(directory, `manifest-${id}.json`); put(manifest, admitted);
  const harness = Object.fromEntries(['bootstrap.mjs', 'loader.mjs', 'worker.mjs', 'ORIGINAL32-v1.json', 'SUPPLEMENT-v1.json'].map(name => [name, inventory(directory)[name]]));
  const job = { id, layout, product, manifest, fixtureRoot, ids: planned.ids ?? [], harness, ...extra };
  const jobPath = path.join(directory, `job-${id}.json`); put(jobPath, job);
  const before = inventory(directory);
  const sourceBefore = inventory(path.join(work, 'source'));
  const productBefore = inventory(product);
  const rootBinding = [directory, product, path.dirname(product)].map(filename => { const stat = fs.lstatSync(filename); assert.equal(fs.realpathSync(filename), filename); return { path: filename, mode: stat.mode & 0o777, dev: stat.dev, ino: stat.ino }; });
  const run = await child(id, 'product', process.execPath, ['--max-old-space-size=256', '--permission', `--allow-fs-read=${directory}`, `--allow-fs-read=${product}`, `--allow-fs-write=${fixtureRoot}`, path.join(directory, 'bootstrap.mjs'), jobPath], directory);
  assert.deepEqual(inventory(product), productBefore, `product postguard ${id}`);
  for (const entry of rootBinding) { const stat = fs.lstatSync(entry.path); assert.equal(stat.mode & 0o777, entry.mode); assert.equal(stat.dev, entry.dev); assert.equal(stat.ino, entry.ino); }
  assert.deepEqual(inventory(path.join(work, 'source')), sourceBefore, `source postguard ${id}`);
  const after = inventory(directory);
  const excluded = name => !name.startsWith(`fixtures-${id}/`);
  assert.deepEqual(Object.fromEntries(Object.entries(after).filter(([name]) => excluded(name))), Object.fromEntries(Object.entries(before).filter(([name]) => excluded(name))), `consumer append guard ${id}`);
  const records = run.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const final = records.at(-1);
  assert.equal(final?.kind, 'final', `missing final ${id}`); assert.equal(final.job, id); assert.equal(final.complete, true); assert.equal(final.shells, final.disposed);
  for (const name of ['apply', 'parser', 'matcher', 'shared', 'options', 'index']) assert.ok(final.loads.some(load => load.relative === `dist/commands/apply-patch/${name}.js`));
  const result = { id, layout, ...final, rootBinding, cases: records.filter(row => row.kind === 'case').map(({ raw, ...row }) => row), sourceBeforeAfter: hash(JSON.stringify(sourceBefore)), productBeforeAfter: hash(JSON.stringify(productBefore)) };
  facts.product.push(result);
  return result;
}
async function types(layout, directory, product) {
  const internal = './' + path.relative(directory, path.join(product, 'dist/commands/apply-patch/index.js')).split(path.sep).join('/');
  const root = './' + path.relative(directory, path.join(product, 'dist/index.js')).split(path.sep).join('/');
  const positive = `import { createApplyPatchCommand, createApplyPatchCommands, applyPatchCommands } from ${JSON.stringify(internal)};\nconst command = createApplyPatchCommand(); const commands = createApplyPatchCommands(); const plugin = applyPatchCommands(); void [command, commands, plugin];\n`;
  const variants = [['positive', positive, 0], ['bad-value', positive + 'createApplyPatchCommand({ limits: { maxPatchBytes: "wrong" } });\n', 2, 'TS2322'], ['bad-value-repair', positive + 'createApplyPatchCommand();\n', 0], ['root-negative', `import {createApplyPatchCommand} from ${JSON.stringify(root)}; void createApplyPatchCommand;\n`, 2, 'TS2305'], ['root-repair', positive, 0]];
  for (const [name, body, expectedCode, diagnostic] of variants) {
    const filename = path.join(directory, `consumer-${name}.mts`); put(filename, body);
    const before = inventory(product);
    const run = await child(`types-${layout}-${name}`, 'type', process.execPath, [path.join(repository, 'node_modules/typescript/bin/tsc'), '--noEmit', '--listFiles', '--strict', '--exactOptionalPropertyTypes', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--types', 'node', '--typeRoots', path.join(repository, 'node_modules/@types'), filename], directory);
    assert.deepEqual(inventory(product), before);
    facts.types.push({ id: run.id, expectedCode, actualCode: run.code, diagnostic: diagnostic ?? null, pass: run.code === expectedCode && (!diagnostic || run.stdout.includes(diagnostic)), declarationPaths: run.stdout.split('\n').filter(line => line.startsWith(product) && line.endsWith('.d.ts')) });
  }
}

try {
  assert.equal(fs.existsSync(work), false, 'one attempt unique work root');
  assert.equal(fs.existsSync(evidenceDirectory), false, 'preserve previous capture');
  checkHarness(); checkTools();
  fs.mkdirSync(work); workIdentity = fs.lstatSync(work); fs.mkdirSync(evidenceDirectory);
  fs.mkdirSync(path.join(work, 'home')); fs.mkdirSync(path.join(work, 'tmp'));
  protocolControls();
  const base = metadata.baseManifest;
  const treeRun = await child('git-base-tree', 'git', '/usr/bin/git', ['--no-replace-objects', 'ls-tree', '-rz', '--full-tree', base.base], repository);
  assert.equal(treeRun.code, 0);
  const baseEntries = parseTree(Buffer.from(treeRun.stdoutBase64, 'base64'));
  assert.equal(treeHash(baseEntries), base.baseTree);
  const candidateEntries = parseTree(readCapture(path.join(own, 'inventory-v1'), 'candidate'));
  assert.equal(treeHash(candidateEntries), metadata.transport.candidateTree);
  assert.equal(candidateEntries.length, 50002);
  const inputs = verifyProjection([...base.inputs, ...metadata.sourceEntries], baseEntries, candidateEntries, metadata);
  const requests = [...new Set([base.base, metadata.candidate, ...inputs.map(entry => entry.blob)])];
  const objectRun = await child('git-authenticated-inputs', 'git', '/usr/bin/git', ['--no-replace-objects', 'cat-file', '--batch'], repository, requests.join('\n') + '\n');
  assert.equal(objectRun.code, 0);
  const objects = batchObjects(Buffer.from(objectRun.stdoutBase64, 'base64'), requests);
  assert.equal(objects.get(base.base).kind, 'commit'); assert.equal(objects.get(metadata.candidate).kind, 'commit');
  assert.equal(objects.get(base.base).payload.toString().split('\n')[0], `tree ${base.baseTree}`);
  assert.equal(objects.get(metadata.candidate).payload.toString().split('\n')[0], `tree ${treeHash(candidateEntries)}`);
  const overrides = new Map(base.inputs.filter(entry => entry.revision !== base.base).map(entry => [entry.path, entry]));
  assert.equal(overrides.size, 5);
  const composed = baseEntries.map(entry => overrides.get(entry.path) ?? entry);
  assert.equal(treeHash(composed), base.composedTree);
  facts.derivedBaseTree = treeHash(composed);
  facts.candidateCompositionTree = treeHash([...composed, ...metadata.sourceEntries]);
  facts.sourceInputs = inputs;
  const source = path.join(work, 'source'); fs.mkdirSync(source);
  for (const entry of inputs) {
    assert.ok(!entry.path.split('/').includes('AGENTS.md'));
    assert.equal(entry.mode, '100644');
    const object = objects.get(entry.blob);
    assert.equal(object.objectId, entry.blob); assert.equal(hash(object.payload), entry.sha256); assert.equal(object.payload.length, entry.bytes);
    const parent = entry.revision === metadata.candidate ? candidateEntries : baseEntries;
    if (entry.revision === metadata.candidate || entry.revision === base.base) assert.equal(parent.find(item => item.path === entry.path)?.blob, entry.blob);
    put(path.join(source, entry.path), object.payload);
  }
  const sourceBefore = inventory(source);
  const controlDirectory = path.join(work, 'guard'); fs.mkdirSync(controlDirectory); put(path.join(controlDirectory, 'dist/stub.js'), 'export const marker = "guard-only-no-product";\n');
  for (const kind of ['hash', 'missing', 'mode']) {
    const run = await child(`guard-${kind}`, 'guard', process.execPath, [path.join(own, 'guard-control.mjs'), controlDirectory, kind], own);
    assert.equal(run.code, 0, `loader control ${kind}`); facts.controls.push({ id: run.id, stdout: run.stdout });
  }
  const binary = await child('supervisor-binary', 'guard', process.execPath, ['-e', 'process.stdout.write(Buffer.from([0,255,128,10]));'], own);
  assert.equal(binary.stdoutBase64, 'AP+ACg=='); assert.equal(binary.code, 0);
  facts.controls.push({ id: binary.id, rawBytesBase64: binary.stdoutBase64 });
  const build = await child('build-source', 'build', process.execPath, [path.join(repository, 'node_modules/typescript/bin/tsc'), '-p', path.join(source, 'tsconfig.build.json'), '--typeRoots', path.join(repository, 'node_modules/@types')], source);
  assert.equal(build.code, 0, 'build failure');
  const afterBuild = inventory(source);
  assert.deepEqual(Object.fromEntries(Object.entries(afterBuild).filter(([name]) => !name.startsWith('dist/'))), sourceBefore, 'append-aware selected-source guard');
  const admitted = packageInventory(source);
  assert.equal(Object.values(admitted).filter(entry => entry.kind === 'file').length, 882);
  const packageJson = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) assert.equal(Object.keys(packageJson[key] ?? {}).length, 0);
  facts.sourceBefore = sourceBefore; facts.sourceAfter = afterBuild; facts.package = admitted;
  const mutationSpecs = [
    ['M01', 'apply.js', 'const text = context.args[0];', marker => `const text = (${marker}, context.args[0]);`, marker => `const text = (${marker}, context.stdin[Symbol.asyncIterator](), context.args[0]);`, 'P02'],
    ['M03', 'matcher.js', 'work.equal(lines[candidate + offset].text, pattern[offset])', marker => `(${marker}, work.equal(lines[candidate + offset].text, pattern[offset]))`, marker => `(${marker}, work.equal(lines[candidate + offset].text.trim(), pattern[offset].trim()))`, 'P18'],
    ['M04', 'matcher.js', 'const first = eof ? last : start;', marker => `const first = (${marker}, eof ? last : start);`, marker => `const first = (${marker}, start);`, 'P16'],
    ['M09', 'apply.js', 'flag: "wx"', marker => `flag: (${marker}, "wx")`, marker => `flag: (${marker}, "w")`, 'S40'],
    ['M12', 'apply.js', 'chunks.push(new Uint8Array(chunk));', marker => `chunks.push((${marker}, new Uint8Array(chunk)));`, marker => `chunks.push((${marker}, chunk));`, 'S49'],
    ['M18', 'apply.js', 'work.count("maxInputChunks", 1);', marker => `(${marker}, work.count("maxInputChunks", 1));`, marker => `(${marker}, chunk.byteLength && work.count("maxInputChunks", 1));`, 'L10'],
  ];
  facts.mutations = [];
  for (const [id, name, needle, positive, negative, caseId] of mutationSpecs) {
    const relative = `dist/commands/apply-patch/${name}`;
    const original = fs.readFileSync(path.join(source, relative), 'utf8');
    assert.equal(original.split(needle).length - 1, 1, `exact mutation site ${id}`);
    const marker = `AP-INDEPENDENT-ACTUAL-v1:${id}`;
    const witness = `(globalThis.reviewMarkers.includes(${JSON.stringify(marker)}) || globalThis.reviewMarkers.push(${JSON.stringify(marker)}))`;
    const variants = {};
    for (const [kind, transform] of [['positive', positive], ['mutant', negative]]) {
      const body = original.replace(needle, transform(witness));
      const filename = path.join(own, 'mutations', `${id}-${kind}.js.data`); put(filename, body);
      variants[kind] = { path: path.relative(own, filename), sha256: hash(body), bytes: Buffer.byteLength(body), mode: 0o644 };
    }
    facts.mutations.push({ id, relative, original: admitted[relative], needle, marker, caseId, variants });
  }
  const sourceConsumer = path.join(work, 'source-consumer'); materializeHarness(sourceConsumer);
  put(path.join(sourceConsumer, 'package.json'), { name: 'independent-internal-source-consumer', private: true, type: 'module' });
  const installed = path.join(work, 'installed'); fs.mkdirSync(installed);
  put(path.join(installed, 'package.json'), { name: 'independent-internal-installed-consumer', private: true, type: 'module' });
  const installedProduct = path.join(installed, 'node_modules/virtual-bash'); copyPackage(source, installedProduct, admitted); materializeHarness(installed);
  facts.packageMechanism = 'Deterministic offline package assembly into a real consumer/node_modules/virtual-bash; explicitly authorized assembly, not npm pack/install and not public apply_patch export';
  const receipt = { sourceInventory: afterBuild, packageInventory: admitted, facts, compiler: build.id, builtAt: new Date().toISOString(), elapsedMs: clock.elapsed(), runtimeStatus: 'AWAITING_COMMITTED_RUNTIME_SEAL' };
  put(path.join(own, 'BUILD-RECEIPT.json'), receipt);
  console.log('BUILD_READY_COMMIT_RUNTIME_SEAL');
  while (!fs.existsSync(path.join(own, 'RUNTIME-START.json'))) { clock.check('runtime-seal wait', 30000); await new Promise(resolve => setTimeout(resolve, 250)); }
  const start = JSON.parse(fs.readFileSync(path.join(own, 'RUNTIME-START.json')));
  assert.match(start.commit, /^[0-9a-f]{40}$/);
  const committedSeal = await child('git-runtime-seal', 'git', '/usr/bin/git', ['--no-replace-objects', 'show', `${start.commit}:tests/commands/apply-patch-independent-20260828/path-transport-v2/RUNTIME-SEAL.json`], repository);
  assert.equal(committedSeal.code, 0);
  assert.equal(hash(Buffer.from(committedSeal.stdoutBase64, 'base64')), hash(fs.readFileSync(path.join(own, 'RUNTIME-SEAL.json'))));
  facts.runtimeSealCommit = start.commit;
  const runtimeSeal = JSON.parse(fs.readFileSync(path.join(own, 'RUNTIME-SEAL.json')));
  assert.equal(runtimeSeal.buildReceiptSha256, hash(fs.readFileSync(path.join(own, 'BUILD-RECEIPT.json'))));
  assert.equal(runtimeSeal.packageSha256, hash(JSON.stringify(admitted)));
  assert.equal(runtimeSeal.workerSha256, seal.files['worker.mjs'].sha256);
  assert.equal(runtimeSeal.mutationsSha256, hash(JSON.stringify(facts.mutations)));
  assert.deepEqual(inventory(source), afterBuild);
  for (const layout of ['source', 'installed', 'moved']) {
    let directory = layout === 'source' ? sourceConsumer : installed;
    let product = layout === 'source' ? source : installedProduct;
    if (layout === 'moved') {
      directory = path.join(work, 'physically-moved'); const beforeMove = inventory(installed); fs.renameSync(installed, directory);
      assert.equal(fs.existsSync(installed), false); assert.deepEqual(inventory(directory), beforeMove);
      product = path.join(directory, 'node_modules/virtual-bash'); facts.physicalMove = { from: installed, to: directory, originalAbsent: true, inventorySha256: hash(JSON.stringify(beforeMove)) };
    }
    for (const cohort of ['originals', 'supplement-a', 'supplement-b']) await runtime(`${layout}-${cohort}`, layout, directory, product, admitted);
    await types(layout, directory, product);
  }
  for (const cap of ['L01', 'L02', 'L05', 'L06', 'L07', 'L10']) for (const endpoint of ['minus', 'at', 'over']) await runtime(`cap-${cap}-${endpoint}`, 'source', sourceConsumer, source, admitted, { cap, endpoint });
  await runtime('real-scoped', 'source', sourceConsumer, source, admitted, { backend: 'real' });
  await runtime('mock-s3-scoped', 'source', sourceConsumer, source, admitted, { backend: 'mock-s3' });
  const mutantConsumer = path.join(work, 'mutant-consumer'); fs.mkdirSync(mutantConsumer);
  put(path.join(mutantConsumer, 'package.json'), { name: 'independent-mutant-consumer', private: true, type: 'module' });
  const mutantProduct = path.join(mutantConsumer, 'node_modules/virtual-bash'); copyPackage(source, mutantProduct, admitted); materializeHarness(mutantConsumer);
  for (const mutation of facts.mutations) {
    const results = [];
    for (const phase of ['before', 'mutant', 'restored']) {
      const variant = mutation.variants[phase === 'mutant' ? 'mutant' : 'positive'];
      const payload = fs.readFileSync(path.join(own, variant.path)); assert.equal(hash(payload), variant.sha256);
      fs.writeFileSync(path.join(mutantProduct, mutation.relative), payload);
      const variantManifest = { ...admitted, [mutation.relative]: { kind: 'file', mode: variant.mode, bytes: variant.bytes, sha256: variant.sha256 } };
      const result = await runtime(`mutation-${mutation.id}-${phase}`, 'installed', mutantConsumer, mutantProduct, variantManifest, mutation.caseId === 'L10' ? { cap: 'L10', endpoint: 'over' } : {});
      assert.ok(result.loads.some(load => load.relative === mutation.relative && load.sha256 === variant.sha256));
      assert.ok(result.markers.includes(mutation.marker), `branch marker ${mutation.id}`);
      results.push({ phase, counts: result.counts, cases: result.cases, actualLoadedSha256: variant.sha256 });
    }
    mutation.results = results;
    mutation.killed = results[0].counts.PASS === 1 && results[1].counts.FAIL === 1 && results[2].counts.PASS === 1;
    fs.writeFileSync(path.join(mutantProduct, mutation.relative), fs.readFileSync(path.join(source, mutation.relative)));
    assert.deepEqual(inventory(mutantProduct), admitted);
  }
  facts.phases.push('all-planned-runtime-jobs-settled');
} catch (reason) {
  stopped = { name: reason?.name, message: reason?.message ?? String(reason), stack: reason?.stack };
  console.error(JSON.stringify({ UNSAFE_OR_ADMISSION_STOP: stopped.message }));
} finally {
  facts.finished = new Date().toISOString(); facts.elapsedMs = clock.elapsed(); facts.capturedBytes = capturedBytes;
  facts.persistedCaptureBytesBeforeFinalization = persistedBytes; facts.admittedWorkingBytes = admittedWorkingBytes;
  facts.processClosure = owners.map(owner => ({ id: owner.id, role: owner.role, pid: owner.pid, closeObserved: owner.closeObserved, groupAbsent: owner.groupAbsent, retired: retired(owner) }));
  facts.stopped = stopped ?? null;
  facts.plannedJobs = seal.jobs.length; facts.executedJobs = runs.length;
  facts.notRunJobs = seal.jobs.filter(job => !runs.some(run => run.id === job.id)).map(job => job.id);
  facts.peakOwnedProcesses = runs.length ? 2 : 1;
  try {
    checkHarness(); checkTools();
    if (fs.existsSync(work)) {
      const identity = fs.lstatSync(work); assert.equal(identity.ino, workIdentity.ino); assert.equal(identity.dev, workIdentity.dev);
      assert.ok(owners.every(retired)); clock.check('archive-and-cleanup', 1000);
      const listing = inventory(work);
      const archive = { inventory: listing, files: Object.fromEntries(Object.entries(listing).filter(([, entry]) => entry.kind === 'file').map(([name]) => [name, fs.readFileSync(path.join(work, name)).toString('base64')])) };
      const compressed = gzipSync(Buffer.from(JSON.stringify(archive)));
      assert.ok(capturedBytes + compressed.length <= 128 * 1024 * 1024);
      const filename = path.join(evidenceDirectory, 'work-archive.json.gz.base64'); put(filename, compressed.toString('base64') + '\n');
      facts.archive = { path: path.relative(own, filename), compressedBytes: compressed.length, sha256: hash(compressed), entries: Object.keys(listing).length };
      fs.rmSync(work, { recursive: true }); facts.cleanup = { ownedRootRemoved: !fs.existsSync(work), knownChildrenRetired: true };
    }
  } catch (reason) { facts.cleanup = { failure: reason?.stack ?? String(reason), ownedRootPreserved: fs.existsSync(work) }; }
  const finalBytes = Buffer.from(JSON.stringify(facts, null, 2) + '\n');
  assert.ok(finalBytes.length <= 16 * 1024 * 1024 && finalBytes.length + persistedBytes <= 128 * 1024 * 1024);
  fs.writeFileSync(path.join(own, 'FINAL.json'), finalBytes, { flag: 'wx' });
  console.log(JSON.stringify({ final: path.join(own, 'FINAL.json'), stopped: facts.stopped, cleanup: facts.cleanup }));
}
process.exitCode = facts.stopped || facts.cleanup?.failure ? 1 : 0;
