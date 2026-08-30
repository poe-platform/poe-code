import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {spawnSync} from 'node:child_process';
import {deflateSync} from 'node:zlib';
import vm from 'node:vm';
import {exactArgv} from './controls.mjs';

const [group, container, output] = process.argv.slice(2);
const recipe = JSON.parse(fs.readFileSync(join(container, 'BINDINGS.json')));
const driver = join(container, 'driver');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const modules = new Map(recipe.importModules.map(name => [pathToFileURL(join(driver, name)).href, recipe.closure.find(row => row.name === name).sha256]));
const loads = [];
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    assert.ok(result.url.startsWith('node:') || modules.has(result.url), 'unbound import: ' + result.url);
    return result;
  },
  load(url, context, next) {
    const result = next(url, context);
    if (url.startsWith('file:')) {
      const hash = digest(result.source ?? fs.readFileSync(fileURLToPath(url)));
      assert.equal(hash, modules.get(url), 'import bytes changed');
      loads.push({url, sha256: hash});
    }
    return result;
  }
});
const {openFencedWorker} = await import(pathToFileURL(join(driver, 'fenced-supervisor.mjs')));
const scope = openFencedWorker();
const {createToolPath, verifyToolPath, createInheritedHelperRoute} = await import(pathToFileURL(join(driver, 'tool-routing.mjs')));
const {rejectAmbientInjection} = await import(pathToFileURL(join(driver, 'external-admission.mjs')));
const root = join(scope.envelope.roots[0].path, 'controls');
fs.mkdirSync(root);
const nativeRoot = join(root, 'native');
fs.mkdirSync(nativeRoot);
const binding = createToolPath(root);
const environment = {PATH: nativeRoot + ':' + binding.path, GIT_EXEC_PATH: binding.gitCore.origin, GIT_OPTIONAL_LOCKS: '0'};
const snapshot = () => ({...process.env});
const initial = snapshot();
const handles = [];
const route = (selected = environment, selectedBinding = binding) => {
  const handle = createInheritedHelperRoute(selectedBinding, selected, nativeRoot);
  handles.push(handle);
  return handle;
};
const rows = [], telemetry = [];
const errorData = error => ({name: error?.name ?? typeof error, message: error?.message ?? String(error), stack: error?.stack ?? null,
  code: error?.code ?? null, errno: error?.errno ?? null, syscall: error?.syscall ?? null, path: error?.path ?? null,
  spawnargs: error?.spawnargs ?? null, errors: error?.errors?.map(value => ({name: value?.name ?? typeof value, message: value?.message ?? String(value)})) ?? null});
const save = () => fs.writeFileSync(join(output, 'worker.json'), JSON.stringify({group, pid: process.pid, rows, telemetry, loads,
  routes: handles.flatMap(handle => handle.records), initialEnvironment: initial, finalEnvironment: snapshot(), root,
  source: recipe.reseal, permission: 'actual shipping fence, no phase RPC/private/product operation'}, null, 2) + '\n');
const rejection = async callback => {
  let rejected = false, value;
  try { await callback(); } catch (error) { rejected = true; value = error; }
  assert.equal(rejected, true, 'expected rejection');
  return value;
};
const check = async (id, callback) => {
  const before = snapshot();
  try {
    const detail = await callback();
    rows.push({id, status: detail?.unexecuted ? 'UNEXECUTED' : 'PASS', kind: detail?.unexecuted ? 'EXERCISED_PREREQUISITE_ONLY' : 'EXERCISED', detail: detail ?? null});
  } catch (error) {
    rows.push({id, status: 'FAIL', kind: 'EXERCISED', error: errorData(error)});
  }
  const after = snapshot();
  rows.at(-1).environment = {before, after, unchanged: Object.keys(before).length === Object.keys(after).length && Object.keys(before).every(key => Object.hasOwn(after, key) && before[key] === after[key])};
  save();
  assert.deepEqual(after, before, 'review boundary environment not restored');
};

await check('R03-N', async () => {
  const before = snapshot();
  process.env.GIT_EXEC_PATH = '/owned/inadmissible-core';
  process.env.GIT_OPTIONAL_LOCKS = '1';
  const poisonedInput = snapshot(); let callbacks = 0;
  const handle = route();
  try {
    const error = await rejection(() => handle.run('prerequisites', () => {callbacks++;}));
    assert.equal(callbacks, 0); assert.equal(handle.records.length, 0);
    assert.deepEqual(snapshot(), poisonedInput); handle.assertIdle();
    return {error: errorData(error), callbacks, dispatches: 0, records: handle.records.length,
      inputBefore: poisonedInput, inputAfter: snapshot(), rootDisposition: 'Separate inadmissible-input refusal; NOT E03.3 restoration'};
  } finally {
    for (const key of ['GIT_EXEC_PATH', 'GIT_OPTIONAL_LOCKS']) {
      if (Object.hasOwn(before, key)) process.env[key] = before[key]; else delete process.env[key];
    }
  }
});
await check('R03-E', async () => {
  const before = snapshot();
  process.env.GIT_EXEC_PATH = ''; process.env.GIT_OPTIONAL_LOCKS = '';
  const emptyInput = snapshot(), handle = route(); let callbacks = 0;
  try {
    assert.equal(await handle.run('private-finally', async () => {
      callbacks++; assert.equal(process.env.GIT_EXEC_PATH, environment.GIT_EXEC_PATH);
      assert.equal(process.env.GIT_OPTIONAL_LOCKS, '0'); await Promise.resolve(); return 19;
    }), 19);
    assert.equal(callbacks, 1); assert.deepEqual(snapshot(), emptyInput);
    for (const key of ['GIT_EXEC_PATH', 'GIT_OPTIONAL_LOCKS']) {assert.ok(Object.hasOwn(process.env, key)); assert.equal(process.env[key], '');}
    handle.assertIdle(); return {callbacks, dispatches: 0, before: emptyInput, after: snapshot(), records: handle.records};
  } finally {
    for (const key of ['GIT_EXEC_PATH', 'GIT_OPTIONAL_LOCKS']) {
      if (Object.hasOwn(before, key)) process.env[key] = before[key]; else delete process.env[key];
    }
  }
});
if (group === 'authority') await check('E10.1', async () => {
  const repository = join(root, 'fixture'), source = join(root, 'selected');
  fs.mkdirSync(repository); fs.mkdirSync(source); fs.mkdirSync(join(repository, '.git')); fs.mkdirSync(join(repository, '.git', 'objects')); fs.mkdirSync(join(repository, '.git', 'refs'));
  fs.writeFileSync(join(repository, '.git', 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\n');
  const object = (kind, bytes) => {
    const body = Buffer.concat([Buffer.from(kind + ' ' + bytes.length + '\0'), bytes]);
    const identity = createHash('sha1').update(body).digest('hex'), folder = join(repository, '.git', 'objects', identity.slice(0, 2));
    fs.mkdirSync(folder, {recursive: true}); fs.writeFileSync(join(folder, identity.slice(2)), deflateSync(body), {flag: 'wx'}); return identity;
  };
  const paths = ['tests/commands/metadata-stress/canonical-env/runner.mjs', 'tests/plugins/qualified-current-release/prerequisites.mjs'];
  const tree = {}, expected = {};
  for (const [index, path] of paths.entries()) {
    const bytes = Buffer.from('owned synthetic authority ' + (index + 1) + '\n');
    expected[path] = {bytes: bytes.length, sha256: digest(bytes), blob: object('blob', bytes)};
    const components = path.split('/'); let current = tree;
    for (const component of components.slice(0, -1)) current = current[component] ??= {};
    current[components.at(-1)] = expected[path].blob;
    const target = join(source, path); fs.mkdirSync(dirname(target), {recursive: true}); fs.writeFileSync(target, bytes, {flag: 'wx'});
  }
  const encodeTree = value => object('tree', Buffer.concat(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([name, entry]) => Buffer.concat([Buffer.from((typeof entry === 'string' ? '100644' : '40000') + ' ' + name + '\0'), Buffer.from(typeof entry === 'string' ? entry : encodeTree(entry), 'hex')]))));
  const treeId = encodeTree(tree);
  const candidate = object('commit', Buffer.from('tree ' + treeId + '\nauthor Independent <owned@invalid> 1 +0000\ncommitter Independent <owned@invalid> 1 +0000\n\nowned authority fixture\n'));
  fs.writeFileSync(join(repository, '.git', 'HEAD'), candidate + '\n');
  const direct = binding.aliases.find(row => row.name === 'git'); let calls = 0;
  const boundedExec = (command, args, options) => {
    assert.ok(++calls <= 2); assert.equal(command, 'git'); assert.equal(options.cwd, repository); assert.equal(Object.hasOwn(options, 'env'), false);
    assert.ok(Array.isArray(args));
    const selectedDescriptor = Object.getOwnPropertyDescriptor(args, '2');
    assert.ok(selectedDescriptor && Object.hasOwn(selectedDescriptor, 'value') && typeof selectedDescriptor.value === 'string');
    const selected = selectedDescriptor.value.slice(candidate.length + 1); assert.ok(paths.includes(selected));
    const normalizedArgs = exactArgv(args, ['--no-replace-objects', 'show', candidate + ':' + selected]);
    verifyToolPath(binding, {...process.env}, nativeRoot);
    const candidates = process.env.PATH.split(':').map(folder => join(folder, command)).filter(path => fs.existsSync(path));
    assert.deepEqual(candidates, [join(binding.path, 'git')]); const resolved = fs.realpathSync(candidates[0]);
    assert.equal(resolved, direct.physical); assert.equal(digest(fs.readFileSync(resolved)), direct.sha256);
    const before = {command, args: normalizedArgs, cwd: options.cwd, envOptionPresent: false, effectiveEnvironment: snapshot(), candidates, resolvedTarget: resolved, binarySha256: direct.sha256, gitCore: binding.gitCore,
      dispatchEvidence: 'Unique first PATH route authenticated before actual bare-name spawn; no kernel exec-event trace, no TOCTOU guarantee'};
    fs.writeFileSync(join(output, 'git-' + calls + '-before.json'), JSON.stringify(before, null, 2) + '\n', {flag: 'wx'});
    const result = spawnSync(command, normalizedArgs, {...options, timeout: recipe.bounds.gitTimeoutMs, maxBuffer: recipe.bounds.gitOutputBytes, killSignal: 'SIGKILL'});
    const record = {before, afterEnvironment: snapshot(), requestedSpawnargs: [command, ...normalizedArgs], pid: result.pid, status: result.status, signal: result.signal, error: result.error ? errorData(result.error) : null,
      stdout: result.stdout?.toString() ?? '', stderr: result.stderr?.toString() ?? '', stdoutBytes: result.stdout?.length ?? 0, stdoutSha256: result.stdout ? digest(result.stdout) : null};
    telemetry.push(record); fs.writeFileSync(join(output, 'git-' + calls + '-after.json'), JSON.stringify(record, null, 2) + '\n', {flag: 'wx'});
    assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.stderr.length, 0);
    assert.equal(record.stdoutSha256, expected[selected].sha256); assert.deepEqual(snapshot(), before.effectiveEnvironment); verifyToolPath(binding, {...process.env}, nativeRoot); return result.stdout;
  };
  assert.equal(digest(recipe.helper.excerpt), recipe.helper.excerptSha256);
  const result = {}, before = snapshot(), handle = route();
  await handle.run('prerequisites', () => vm.runInNewContext(recipe.helper.excerpt, {result, execFileSync: boundedExec, repository, source, candidate, assert, sha: digest, readFileSync: fs.readFileSync, join}, {timeout: 15000}));
  assert.equal(calls, 2); assert.equal(result.authorities.length, 2); assert.deepEqual(snapshot(), before); handle.assertIdle();
  return {fixtureCommit: candidate, tree: treeId, expected, calls, excerptSha256: recipe.helper.excerptSha256, productCandidateRead: false, actualPrerequisitesInvoked: false};
});

await check('E10.3', async () => {
  const direct = binding.aliases.find(row => row.name === 'git');
  const sufficient = row => row.before?.command === 'git' && row.before.envOptionPresent === false &&
    row.before.resolvedTarget === direct.physical && row.before.binarySha256 === direct.sha256 &&
    row.before.candidates.length === 1 && Number.isInteger(row.pid) && row.pid > 0 && row.error === null &&
    row.status === 0 && row.signal === null && row.stderr === '' &&
    JSON.stringify(row.afterEnvironment) === JSON.stringify(row.before.effectiveEnvironment);
  assert.equal(telemetry.length, 2);
  for (const row of telemetry) {
    assert.ok(sufficient(row));
    assert.equal(sufficient({...row, before: {...row.before, resolvedTarget: undefined}}), false);
    assert.equal(sufficient({...row, before: {...row.before, binarySha256: 'wrong'}}), false);
    assert.equal(sufficient({...row, before: {...row.before, envOptionPresent: true}}), false);
    assert.equal(sufficient({...row, status: 1}), false);
  }
  return {dispatches: 2, rejectedReceiptMutations: 8, receipt: 'Authenticated unique pre-dispatch inherited bare-name route and actual PID/stdio/status; not kernel exec-event trace'};
});

assert.deepEqual(snapshot(), initial);
save();
console.log(JSON.stringify({group, rows: rows.map(row => ({id: row.id, status: row.status})), actualGitCalls: telemetry.length}));
process.exitCode = rows.some(row => row.status === 'FAIL') ? 1 : 0;

