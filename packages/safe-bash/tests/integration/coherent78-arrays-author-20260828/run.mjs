import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { own, repo, sha, objectHash, inputs } from './prepare.mjs';

assert.deepEqual(process.argv.slice(2), ['--continue']);
const started = Date.now();
const { manifest, base, seal } = inputs();
assert.deepEqual(manifest, JSON.parse(await fs.readFile(path.join(own, 'SOURCE.json'))));
assert.equal(process.execPath, seal.tools.nodePath);
assert.equal(process.version, seal.tools.nodeVersion);
assert.equal(sha(await fs.readFile(process.execPath)), seal.tools.nodeSha256);
const executor = JSON.parse(await fs.readFile(path.join(own, 'EXECUTOR-v5.json')));
for (const [name, expected] of Object.entries(executor.files)) assert.equal(sha(await fs.readFile(path.join(own, name))), expected, name);
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'coherent78-arrays-author-'));
console.log(JSON.stringify({ output, candidate: manifest.computedTree, sourceSha256: sha(await fs.readFile(path.join(own, 'SOURCE.json'))) }));
const receipt = { role: 'AUTHOR_COHERENCE_ONLY', candidate: manifest.computedTree, started: new Date(started).toISOString(), output, executor, source: manifest, children: [], phases: [], types: [], controls: [], failures: [], cleanup: {}, nativeRuns: 0, actualSafeJsRuns: 0 };
const priorEncoded = await fs.readFile(path.join(own, 'RAW-v2.json.gz.base64'));
assert.equal(sha(priorEncoded), 'ff6209758d5bf6c5dcfcd4f742299d9d9ec2c72b04e6bfe515fa4e51dc867ecf');
const prior = JSON.parse(gunzipSync(Buffer.from(priorEncoded.toString().trim(), 'base64'), { maxOutputLength: 134217728 })).receipt;
assert.equal(prior.candidate, manifest.computedTree);
assert.equal(prior.pack.sha256, 'f5152eaeaaeb78aff350a86d55f67905c2caab900ba2f45b1869da6498e1e956');
assert.equal(prior.children.filter(row => row.label === 'production-build-once' && row.code === 0).length, 1);
receipt.continuation = { originalRawSha256: sha(priorEncoded), priorOutput: prior.output, originalStatus: prior.status, productionBuildsThisContinuation: 0, originalPhasesNotRerun: prior.phases.map(row => ({ layout: row.layout, script: row.script, summary: row.summary })), originalTypeGroupsNotRerun: prior.types.length };
const secondEncoded = await fs.readFile(path.join(own, 'RAW-v3.json.gz.base64'));
assert.equal(sha(secondEncoded), '7e903844979ab00dd8ee40d420cbe37f9ddba4c37ec6b779bdbca7774aaf5fce');
const second = JSON.parse(gunzipSync(Buffer.from(secondEncoded.toString().trim(), 'base64'), { maxOutputLength: 134217728 })).receipt;
assert.equal(second.candidate, manifest.computedTree); assert.equal(second.pack.sha256, prior.pack.sha256);
receipt.continuation.completedPriorContinuation = { rawSha256: sha(secondEncoded), phases: second.phases.map(row => ({ layout: row.layout, script: row.script, summary: row.summary })), typeGroups: second.types.length, notRerun: true };
let totalCapture = 0, written = 0, childCount = 0;
const active = new Set();
const save = () => fs.writeFile(path.join(output, 'RESULT.json'), JSON.stringify(receipt, null, 2) + '\n');
async function write(filename, bytes, mode = 0o644) {
  written += Buffer.byteLength(bytes);
  assert.ok(written <= seal.bounds.workingBytes, 'working write budget');
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, bytes, { flag: 'wx', mode });
}
const environment = { PATH: path.dirname(process.execPath), HOME: path.join(output, 'home'), TMPDIR: path.join(output, 'tmp'), npm_config_cache: path.join(output, 'cache'), npm_config_userconfig: path.join(output, 'npmrc'), npm_config_globalconfig: path.join(output, 'global-npmrc'), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', NO_COLOR: '1' };
async function child(label, executable, args, cwd, extra = {}, input) {
  assert.ok(++childCount <= seal.bounds.ownedChildren);
  assert.ok(Date.now() - started < (seal.bounds.totalSecondsIncludingCleanup - seal.bounds.cleanupSeconds) * 1000);
  assert.equal(active.size, 0);
  const row = { label, executable, executableSha256: sha(await fs.readFile(executable)), args, cwd, pid: null, signals: [] };
  receipt.children.push(row);
  const instance = spawn(executable, args, { cwd, env: { ...environment, ...extra }, stdio: ['pipe', 'pipe', 'pipe'] });
  active.add(instance); row.pid = instance.pid;
  let bytes = 0, rescue;
  const terminate = () => { if (row.signals.length) return; row.signals.push('SIGTERM'); instance.kill('SIGTERM'); rescue = setTimeout(() => { if (active.has(instance)) { row.signals.push('SIGKILL'); instance.kill('SIGKILL'); } }, 1000); };
  const timer = setTimeout(terminate, Math.min(seal.bounds.childSeconds * 1000, seal.bounds.totalSecondsIncludingCleanup * 1000 - (Date.now() - started) - 5000));
  const streams = [[], []];
  for (const [index, stream] of [instance.stdout, instance.stderr].entries()) stream.on('data', chunk => {
    bytes += chunk.length; totalCapture += chunk.length;
    if (bytes > seal.bounds.perChildOutputBytes || totalCapture > seal.bounds.captureBytes) terminate(); else streams[index].push(Buffer.from(chunk));
  });
  instance.stdin.on('error', () => {}); instance.stdin.end(input);
  instance.on('error', error => { row.spawnError = String(error); });
  const [code, signal] = await new Promise(resolve => instance.once('close', (...result) => resolve(result)));
  clearTimeout(timer); clearTimeout(rescue); active.delete(instance);
  Object.assign(row, { code, signal, closed: true, outputBytes: bytes });
  const out = Buffer.concat(streams[0]), err = Buffer.concat(streams[1]);
  await write(path.join(output, `${childCount}-${label}.stdout`), out);
  await write(path.join(output, `${childCount}-${label}.stderr`), err);
  await save();
  console.log(JSON.stringify({ phase: label, code, signal, bytes }));
  assert.ok(!row.spawnError && !signal && row.signals.length === 0, `${label}: child lifecycle failure`);
  return { code, out, err, row };
}
async function inventory(root, prefix = '') {
  const result = {};
  for (const name of (await fs.readdir(path.join(root, prefix))).sort()) {
    assert.notEqual(name, 'AGENTS.md', 'No instruction materialization');
    const relative = prefix ? `${prefix}/${name}` : name;
    const metadata = await fs.lstat(path.join(root, relative));
    assert.ok(!metadata.isSymbolicLink(), `Unexpected symlink ${relative}`);
    if (metadata.isDirectory()) { result[relative + '/'] = { kind: 'directory', mode: metadata.mode & 0o777 }; Object.assign(result, await inventory(root, relative)); }
    else { assert.ok(metadata.isFile()); const bytes = await fs.readFile(path.join(root, relative)); result[relative] = { kind: 'file', mode: metadata.mode & 0o777, bytes: bytes.length, sha256: sha(bytes) }; }
  }
  return result;
}
async function packageInventory(root) {
  const result = Object.fromEntries(Object.entries(await inventory(path.join(root, 'dist'))).map(([name, row]) => ['dist/' + name, row]));
  for (const name of ['package.json', 'README.md']) { const bytes = await fs.readFile(path.join(root, name)); result[name] = { kind: 'file', mode: (await fs.stat(path.join(root, name))).mode & 0o777, bytes: bytes.length, sha256: sha(bytes) }; }
  return result;
}
async function stageHarness(root) {
  for (const row of manifest.acceptedHelpers) await write(path.join(root, path.basename(row.path)), await fs.readFile(path.join(repo, row.path)));
  for (const name of ['arrays.mjs', 'ARRAY-CASES.json']) await write(path.join(root, name), await fs.readFile(path.join(own, name)));
}
let source, movedRoot, admitted, compiler;
async function runtime(label, consumer, product, script = 'probe.mjs', extra = {}) {
  const result = await child(label, process.execPath, ['--loader', path.join(consumer, 'loader.mjs'), path.join(consumer, script)], consumer, {
    RUN_ROOT: consumer, PRODUCT_ROOT: product, PRODUCT_INVENTORY: path.join(output, 'admitted.json'), LOAD_LOG: path.join(output, `${label}-loads.jsonl`), LAYOUT: label, ...extra,
  });
  const observations = result.out.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { ...result, observations, summary: observations.at(-1)?.summary };
}
async function types(label, consumer) {
  const table = JSON.parse(await fs.readFile(path.join(consumer, 'TYPES.json')));
  const groups = [
    { id: 'positive', cases: table.positive.map(row => row.id), body: table.positive.map(row => `{ ${row.body} }`).join('\n') },
    ...table.negative.map(row => ({ ...row, cases: [row.id] })),
    { id: 'inversions', cases: table.negative.map(row => row.id + '-inverse'), body: table.negative.map(row => `{ ${row.inversion} }`).join('\n') },
  ];
  for (const group of groups) {
    const filename = path.join(consumer, `${label}-consumer-${group.id}.ts`);
    await write(filename, table.prefix + group.body + '\n');
    const result = await child(`${label}-types-${group.id}`, process.execPath, [compiler, '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--skipLibCheck', '--pretty', 'false', '--listFiles', '--typeRoots', path.join(source, 'node_modules/@types'), filename], consumer);
    const diagnostic = result.out.toString() + result.err.toString();
    const errors = diagnostic.split('\n').filter(line => /error TS\d+:/.test(line));
    const pass = group.diagnostic ? result.code === 2 && errors.length === 1 && errors[0].includes(group.diagnostic) && errors[0].includes(group.term) : result.code === 0 && errors.length === 0;
    const product = label === 'source-build' ? source : path.join(consumer, 'node_modules/virtual-bash');
    const declarations = diagnostic.split('\n').filter(line => line.endsWith('.d.ts') && line.includes('/dist/'));
    const realProduct = await fs.realpath(product);
    assert.ok(declarations.length > 0, 'Absent public declaration');
    const boundDeclarations = [];
    for (const file of declarations) {
      const realFile = await fs.realpath(file);
      assert.ok(realFile.startsWith(realProduct + '/dist/'), 'Type source fallback');
      const relative = path.relative(realProduct, realFile), digest = sha(await fs.readFile(realFile));
      assert.equal(digest, admitted[relative]?.sha256, 'Declaration bytes differ from candidate');
      boundDeclarations.push({ path: relative, sha256: digest });
    }
    receipt.types.push({ layout: label, id: group.id, cases: group.cases, pass, errors, realProduct, declarations: boundDeclarations });
    if (!pass) receipt.failures.push({ phase: `${label}-types`, id: group.id, errors });
  }
}
async function layout(label, consumer, product) {
  for (const [script, expected] of [['probe.mjs', 19], ['arrays.mjs', 12]]) {
    const result = await runtime(label + '-' + script, consumer, product, script);
    const summary = result.summary;
    assert.equal(summary?.cases, expected, 'Missing or incomplete runtime corpus');
    receipt.phases.push({ layout: label, script, summary, observations: result.observations });
    for (const row of result.observations.filter(row => row.id && !row.pass)) receipt.failures.push({ phase: label, script, ...row });
    assert.ok(summary.disposed === (summary.created ?? summary.cases), 'Shell cleanup incomplete');
  }
  await types(label, consumer);
}

try {
  for (const name of ['home', 'tmp', 'cache']) await fs.mkdir(path.join(output, name));
  for (const name of ['npmrc', 'global-npmrc']) await write(path.join(output, name), '');
  source = path.join(output, 'source'); await fs.mkdir(source);
  for (const row of manifest.inputs) {
    assert.ok(!row.path.startsWith('/') && !row.path.split('/').some(part => part === '..' || part === 'AGENTS.md'));
    const previous = path.join(prior.output, 'source', row.path);
    const metadata = await fs.lstat(previous); assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
    const bytes = await fs.readFile(previous); assert.equal(bytes.length, row.bytes);
    assert.equal(sha(bytes), row.sha256); assert.equal(objectHash('blob', bytes), row.blob);
    await write(path.join(source, row.path), bytes, Number.parseInt(row.mode, 8) & 0o777);
  }
  receipt.tools = {};
  for (const name of ['typescript', '@types/node', 'undici-types', 'npm']) {
    const tool = base.tools[name];
    const destination = name === 'npm' ? path.join(output, 'tools/npm') : path.join(source, 'node_modules', name);
    for (const [relative, mode, length, digest] of tool.originalRows) {
      const filename = path.join(tool.origin, relative), metadata = await fs.lstat(filename);
      if (mode === 'SYMLINK') {
        assert.ok(metadata.isSymbolicLink());
        assert.equal(await fs.readlink(filename), length);
        assert.ok(tool.omittedInternalBinLinks.some(([name, target]) => name === relative && target === length));
        const resolved = await fs.realpath(filename), realRoot = await fs.realpath(tool.origin);
        assert.ok(resolved.startsWith(realRoot + path.sep));
        const targetRow = tool.originalRows.find(row => row[0] === path.relative(realRoot, resolved));
        assert.ok(targetRow && targetRow[1] !== 'SYMLINK');
        assert.equal(sha(await fs.readFile(resolved)), targetRow[3]);
        continue;
      }
      assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
      const bytes = await fs.readFile(filename); assert.equal(bytes.length, length); assert.equal(sha(bytes), digest); assert.equal(metadata.mode & 0o777, mode);
      await write(path.join(destination, relative), bytes, mode);
    }
    assert.equal(JSON.parse(await fs.readFile(path.join(destination, 'package.json'))).version, tool.version);
    receipt.tools[name] = { originalRows: tool.originalRows, version: tool.version, copied: destination, omittedInternalBinLinks: tool.omittedInternalBinLinks };
  }
  compiler = path.join(source, 'node_modules/typescript/bin/tsc');
  for (const [relative, row] of Object.entries(prior.packageMembers)) {
    if (row.kind !== 'file' || !relative.startsWith('dist/')) continue;
    const filename = path.join(prior.output, 'source', relative), metadata = await fs.lstat(filename);
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
    const bytes = await fs.readFile(filename); assert.equal(sha(bytes), row.sha256); assert.equal(metadata.mode & 0o777, row.mode);
    await write(path.join(source, relative), bytes, row.mode);
  }
  admitted = await packageInventory(source);
  assert.deepEqual(admitted, prior.packageMembers);
  assert.equal(Object.values(admitted).filter(row => row.kind === 'file').length, seal.expectedFullPackageMembers);
  receipt.packageMembers = admitted;
  await write(path.join(output, 'admitted.json'), JSON.stringify(admitted));
  await stageHarness(source);
  const npm = path.join(output, 'tools/npm/bin/npm-cli.js');
  const tarball = path.join(output, 'virtual-bash-exact-prior.tgz'), bytes = Buffer.from(prior.pack.base64, 'base64');
  assert.equal(sha(bytes), prior.pack.sha256); await write(tarball, bytes);
  receipt.pack = prior.pack;
  const consumer = path.join(output, 'installed');
  await write(path.join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  const install = await child('offline-install', process.execPath, [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--omit=dev', tarball], consumer);
  assert.equal(install.code, 0);
  const product = path.join(consumer, 'node_modules/virtual-bash');
  assert.deepEqual(await packageInventory(product), admitted);
  const installedAll = await inventory(product);
  assert.equal(Object.values(installedAll).filter(row => row.kind === 'file').length, seal.expectedFullPackageMembers);
  receipt.fullInstalled = installedAll;
  await stageHarness(consumer);
  const moved = path.join(output, 'physically moved consumer'); await fs.rename(consumer, moved);
  await assert.rejects(fs.lstat(consumer), error => error.code === 'ENOENT');
  movedRoot = path.join(moved, 'node_modules/virtual-bash'); receipt.move = { originalAbsent: true, moved };
  await types('moved', moved);
  const runtimePath = path.join(movedRoot, 'dist/shell/runtime.js'), runtimeBytes = await fs.readFile(runtimePath);
  try {
    await fs.appendFile(runtimePath, '\n');
    const control = await child('control-tamper', process.execPath, ['--loader', path.join(moved, 'loader.mjs'), path.join(moved, 'arrays.mjs')], moved, { RUN_ROOT: moved, PRODUCT_ROOT: movedRoot, PRODUCT_INVENTORY: path.join(output, 'admitted.json'), LOAD_LOG: path.join(output, 'tamper-loads.jsonl'), ARRAY_CASE: 'A02' });
    assert.notEqual(control.code, 0); assert.ok(control.err.toString().includes('Changed product load: dist/shell/runtime.js'));
    receipt.controls.push({ id: 'changed-binding', pass: true });
  } finally { await fs.writeFile(runtimePath, runtimeBytes); }
  const entry = path.join(movedRoot, 'dist/commands/timeout/index.js');
  await fs.rename(entry, entry + '.held');
  try {
    const control = await child('control-missing', process.execPath, ['--loader', path.join(moved, 'loader.mjs'), path.join(moved, 'arrays.mjs')], moved, { RUN_ROOT: moved, PRODUCT_ROOT: movedRoot, PRODUCT_INVENTORY: path.join(output, 'admitted.json'), LOAD_LOG: path.join(output, 'missing-loads.jsonl'), ARRAY_CASE: 'A02' });
    assert.notEqual(control.code, 0); assert.ok(control.err.toString().includes('ERR_MODULE_NOT_FOUND'));
    receipt.controls.push({ id: 'missing-entry', pass: true });
  } finally { await fs.rename(entry + '.held', entry); }
  const fallback = await child('control-fallback', process.execPath, ['--loader', path.join(moved, 'loader.mjs'), path.join(moved, 'probe.mjs')], moved, { RUN_ROOT: moved, PRODUCT_ROOT: movedRoot, PRODUCT_INVENTORY: path.join(output, 'admitted.json'), LOAD_LOG: path.join(output, 'fallback-loads.jsonl'), CONTROL: 'source-fallback', FALLBACK_PATH: path.join(source, 'src/index.ts'), CASE_IDS: 'C01' });
  assert.notEqual(fallback.code, 0); assert.ok(fallback.err.toString().includes('Outside admitted consumer:'));
  receipt.controls.push({ id: 'outside-source', pass: true });
  const mutated = path.join(movedRoot, 'dist/shell/arrays/bindings.js'), original = await fs.readFile(mutated);
  const needle = 'return this.values.get(index)?.text.value;';
  assert.equal(original.toString().split(needle).length, 2);
  const changed = Buffer.from(original.toString().replace(needle, 'return index === 0 ? "__array_mutant__" : this.values.get(index)?.text.value;'));
  try {
    await fs.writeFile(mutated, changed);
    const mutantInventory = await packageInventory(movedRoot);
    await fs.writeFile(path.join(output, 'admitted.json'), JSON.stringify(mutantInventory));
    const control = await runtime('control-loaded-mutant', moved, movedRoot, 'arrays.mjs', { ARRAY_CASE: 'A02' });
    assert.equal(control.code, 1); assert.equal(control.summary?.cases, 1); assert.equal(control.summary?.pass, 0); assert.equal(control.summary?.disposed, 1);
    const loads = (await fs.readFile(path.join(output, 'control-loaded-mutant-loads.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(loads.some(row => row.relative === 'dist/shell/arrays/bindings.js' && row.sha256 === sha(changed)));
    receipt.controls.push({ id: 'loaded-zero-view-mutant', pass: true, mutantSha256: sha(changed), observations: control.observations });
  } finally { await fs.writeFile(mutated, original); await fs.writeFile(path.join(output, 'admitted.json'), JSON.stringify(admitted)); }
  const restored = await runtime('control-restored-A02', moved, movedRoot, 'arrays.mjs', { ARRAY_CASE: 'A02' });
  assert.equal(restored.code, 0); assert.equal(restored.summary?.pass, 1);
  receipt.controls.push({ id: 'restored-positive', pass: true });
  assert.deepEqual(await inventory(movedRoot), installedAll);
  assert.deepEqual(await packageInventory(source), admitted);
  for (const row of manifest.inputs) assert.equal(sha(await fs.readFile(path.join(source, row.path))), row.sha256);
  const actualSource = await inventory(path.join(source, 'src'));
  assert.deepEqual(Object.keys(actualSource).filter(name => actualSource[name].kind === 'file').sort(), manifest.inputs.filter(row => row.path.startsWith('src/')).map(row => row.path.slice(4)).sort());
  for (const row of manifest.acceptedHelpers) assert.equal(sha(await fs.readFile(path.join(repo, row.path))), row.sha256);
  const full = await inventory(output);
  receipt.workingBytesAtCheckpoint = Object.values(full).reduce((sum, row) => sum + (row.bytes ?? 0), 0);
  assert.ok(receipt.workingBytesAtCheckpoint <= seal.bounds.workingBytes);
  receipt.stability = { selectedSource: true, addedSourceEntries: true, fullPackage: true, acceptedHelpers: true };
} catch (error) {
  receipt.setupOrControlFailure = { message: error?.message ?? String(error), stack: error?.stack };
} finally {
  receipt.cleanup = { directChildren: receipt.children.length, closed: receipt.children.filter(row => row.closed).length, active: active.size, signals: receipt.children.flatMap(row => row.signals), scratchRetained: output, noForeignCleanup: true };
  receipt.elapsedMilliseconds = Date.now() - started;
  receipt.captureBytes = totalCapture;
  receipt.status = receipt.setupOrControlFailure || receipt.failures.length || active.size ? 'FAILED_OR_INCOMPLETE' : 'AUTHOR_SCOPED_PASS';
  await save();
  const captures = [];
  for (const name of (await fs.readdir(output)).sort()) if (/\.(stdout|stderr|jsonl)$/.test(name)) captures.push({ name, base64: (await fs.readFile(path.join(output, name))).toString('base64') });
  const encoded = gzipSync(Buffer.from(JSON.stringify({ receipt, captures })), { level: 9 }).toString('base64') + '\n';
  await fs.writeFile(path.join(own, 'RAW-v4.json.gz.base64'), encoded, { flag: 'wx' });
  const summary = { candidate: receipt.candidate, status: receipt.status, pack: receipt.pack?.sha256, phases: receipt.phases.map(row => ({ layout: row.layout, script: row.script, summary: row.summary })), failures: receipt.failures, setupOrControlFailure: receipt.setupOrControlFailure, typeGroups: receipt.types.length, typePass: receipt.types.filter(row => row.pass).length, controls: receipt.controls, cleanup: receipt.cleanup, elapsedMilliseconds: receipt.elapsedMilliseconds, rawSha256: sha(Buffer.from(encoded)) };
  await fs.writeFile(path.join(own, 'RESULT-v4.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(summary));
  if (receipt.status !== 'AUTHOR_SCOPED_PASS') process.exitCode = 1;
}
