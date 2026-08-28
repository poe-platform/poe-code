import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {spawnSync} from 'node:child_process';
import {deflateSync} from 'node:zlib';
import vm from 'node:vm';

const [group, container, output] = process.argv.slice(2);
const recipe = JSON.parse(fs.readFileSync(join(container, 'RECIPE.json')));
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
const stages = handle => handle.records.at(-1).failures.map(row => row.stage);
const defer = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};

if (group === 'core') {
  await check('E01.1', async () => {
    const handle = route(), before = snapshot();
    assert.equal(await handle.run('prerequisites', () => {assert.equal(process.env.PATH, environment.PATH); assert.equal(process.env.GIT_EXEC_PATH, environment.GIT_EXEC_PATH); assert.equal(process.env.GIT_OPTIONAL_LOCKS, '0'); return 41;}), 41);
    handle.assertIdle(); assert.deepEqual(snapshot(), before);
    return {record: handle.records[0]};
  });
  await check('E01.2', async () => {
    const original = fs.readlinkSync(join(binding.path, 'git'));
    let calls = 0;
    fs.unlinkSync(join(binding.path, 'git')); fs.symlinkSync('/usr/bin/git', join(binding.path, 'git'));
    try { const error = await rejection(() => route().run('prerequisites', () => {calls++;})); assert.equal(calls, 0); return {error: errorData(error), callbackCalls: calls, targetExecuted: false}; }
    finally {fs.unlinkSync(join(binding.path, 'git')); fs.symlinkSync(original, join(binding.path, 'git'));}
  });
  await check('E01.3', async () => {
    let calls = 0;
    const error = await rejection(() => route({...environment, PATH: '/usr/bin:/bin'}).run('prerequisites', () => {calls++;}));
    assert.equal(calls, 0);
    const before = snapshot();
    process.env.GIT_CONFIG_COUNT = '1';
    try {assert.throws(() => rejectAmbientInjection(process.env)); await rejection(() => route().run('prerequisites', () => {calls++;}));}
    finally {delete process.env.GIT_CONFIG_COUNT;}
    assert.deepEqual(snapshot(), before); assert.equal(calls, 0);
    return {error: errorData(error), callbackCalls: calls};
  });
  for (const [id, mode] of [['E03.1', 'absent'], ['E03.2', 'empty'], ['E03.4', 'mixed']]) await check(id, async () => {
    const original = snapshot();
    try {
      for (const key of ['PATH', 'GIT_EXEC_PATH', 'GIT_OPTIONAL_LOCKS']) if (mode === 'absent') delete process.env[key]; else process.env[key] = '';
      if (mode === 'mixed') {process.env.PATH = '/owned/original-nonempty'; delete process.env.GIT_EXEC_PATH;}
      const before = snapshot(), handle = route();
      await handle.run('private-final-sweep', async () => {await Promise.resolve();});
      assert.deepEqual(snapshot(), before); handle.assertIdle();
      return {mode, states: ['PATH', 'GIT_EXEC_PATH', 'GIT_OPTIONAL_LOCKS'].map(key => ({key, present: Object.hasOwn(process.env, key), value: process.env[key] ?? null}))};
    } finally {for (const key of ['PATH', 'GIT_EXEC_PATH', 'GIT_OPTIONAL_LOCKS']) if (Object.hasOwn(original, key)) process.env[key] = original[key]; else delete process.env[key];}
  });
  await check('E03.3', async () => {
    const original = snapshot(); let calls = 0;
    try {
      process.env.PATH = '/owned/original'; process.env.GIT_EXEC_PATH = '/owned/original-core'; process.env.GIT_OPTIONAL_LOCKS = '1';
      const before = snapshot();
      const error = await rejection(() => route().run('prerequisites', () => {calls++;}));
      assert.equal(calls, 0); assert.deepEqual(snapshot(), before);
      return {unexecuted: true, reason: 'Nonempty GIT_* is rejected before installation. No safe shipping seam permits the frozen all-three-nonempty restoration case; refusal is not a restoration pass.', error: errorData(error)};
    } finally {for (const key of ['PATH', 'GIT_EXEC_PATH', 'GIT_OPTIONAL_LOCKS']) if (Object.hasOwn(original, key)) process.env[key] = original[key]; else delete process.env[key];}
  });
  await check('E04.1', async () => {
    process.env.INDEPENDENT_ENV_SENTINEL = 'unchanged';
    try {const before = snapshot(); await route().run('private-finally', () => {for (const key of Object.keys(before).filter(key => !Object.hasOwn(environment, key))) assert.equal(process.env[key], before[key]);}); assert.deepEqual(snapshot(), before);}
    finally {delete process.env.INDEPENDENT_ENV_SENTINEL;}
  });
  await check('E05.1', async () => {
    let innerCalls = 0; const handle = route();
    await handle.run('prerequisites', async () => {const error = await rejection(() => route().run('private-finally', () => {innerCalls++;})); assert.match(error.message, /already owned/);});
    assert.equal(innerCalls, 0); handle.assertIdle();
  });
  await check('E05.2', async () => {
    const gate = defer(), handle = route(); let calls = 0;
    const pending = handle.run('prerequisites', () => gate.promise);
    try {await Promise.resolve(); assert.equal(process.env.PATH, environment.PATH); const error = await rejection(() => route().run('private-final-sweep', () => {calls++;})); assert.match(error.message, /already owned/); assert.equal(calls, 0);}
    finally {gate.resolve(9); await pending;}
    handle.assertIdle();
  });
  await check('E05.3', async () => {
    const original = process.env, backing = {...original}; let restoring = false, observed, calls = 0;
    process.env = new Proxy(backing, {set(target, key, value) {if (restoring && key === 'PATH') {restoring = false; observed = rejection(() => route().run('private-finally', () => {calls++;}));} return Reflect.set(target, key, value);}});
    try {await route().run('prerequisites', () => {restoring = true;}); assert.match((await observed).message, /already owned/); assert.equal(calls, 0); assert.deepEqual(backing, {...original});}
    finally {process.env = original;}
  });
  await check('E06.1', async () => {
    const handle = route(); await rejection(() => handle.run('prerequisites', () => {process.env.PATH = '/owned/drift';}));
    assert.deepEqual(stages(handle), ['drift']); assert.equal(handle.records[0].restored, true); handle.assertIdle();
  });
  await check('E06.2', async () => {
    const selected = {...environment}, handle = route(selected);
    await rejection(() => handle.run('prerequisites', async () => {await Promise.resolve(); selected.PATH = '/owned/mutable'; process.env.PATH = selected.PATH;}));
    assert.deepEqual(stages(handle), ['drift']); assert.equal(handle.records[0].installed.PATH, environment.PATH); handle.assertIdle();
  });
  await check('E07.1', async () => {
    for (const reason of [new Error('independent callback'), 0, undefined]) {const handle = route(); assert.equal(await rejection(() => handle.run('prerequisites', async () => {await Promise.resolve(); throw reason;})), reason); assert.deepEqual(stages(handle), ['callback']); handle.assertIdle();}
  });
  await check('E07.2', async () => {
    const reason = new Error('independent dual error'), handle = route();
    const error = await rejection(() => handle.run('prerequisites', () => {process.env.PATH = '/owned/drift'; throw reason;}));
    assert.ok(error instanceof AggregateError); assert.ok(error.errors.includes(reason)); assert.deepEqual(stages(handle), ['callback', 'drift']); handle.assertIdle();
  });
  await check('E09.1', async () => {
    const controller = new AbortController(), gate = defer(), handle = route(), reason = new Error('owned cancellation');
    const pending = handle.run('prerequisites', async () => {await gate.promise; if (controller.signal.aborted) throw controller.signal.reason;});
    const outcome = rejection(() => pending); controller.abort(reason); assert.throws(() => handle.assertIdle(), /already owned/);
    gate.resolve(); assert.equal(await outcome, reason); handle.assertIdle();
  });
  await check('E09.2', async () => {
    const gate = defer(), handle = route(); let settled = false;
    const pending = handle.run('prerequisites', () => gate.promise); pending.then(() => {settled = true;}, () => {settled = true;});
    await new Promise(resolve => setTimeout(resolve, recipe.bounds.controlledDeadlineMs));
    try {assert.equal(settled, false); assert.throws(() => handle.assertIdle(), /already owned/); await rejection(() => route().run('private-finally', () => {})); assert.equal(process.env.PATH, environment.PATH);}
    finally {gate.resolve(); await pending;}
    handle.assertIdle();
    return {deadlineObservation: 'HOLD_UNSETTLED_OWNER', adapterDeadlineClaim: false, teardown: 'controller explicitly settled its own deferred callback, then awaited restoration; no process signals', detachedWorkClaim: false};
  });
  await check('E10.2', async () => {
    const wrong = structuredClone(binding); wrong.aliases.find(row => row.name === 'git').sha256 = '0'.repeat(64); let calls = 0;
    const error = await rejection(() => route(environment, wrong).run('prerequisites', () => {calls++;})); assert.equal(calls, 0);
    return {error: errorData(error), unauthorizedDispatches: 0};
  });
}

if (group === 'compound-errors' || group === 'poison-restoration') await check(group === 'compound-errors' ? 'E07.3' : 'E08.1', async () => {
  const original = process.env, backing = {...original}; delete backing.GIT_EXEC_PATH;
  const callbackError = new Error('independent callback sentinel'), restoreError = new Error('independent restore sentinel');
  const attempts = []; let armed = false;
  process.env = new Proxy(backing, {
    set(target, key, value) {if (armed) attempts.push('set:' + key); return Reflect.set(target, key, value);},
    deleteProperty(target, key) {if (armed) {attempts.push('delete:' + key); if (key === 'GIT_EXEC_PATH') throw restoreError;} return Reflect.deleteProperty(target, key);}
  });
  try {
    const handle = route(); const error = await rejection(() => handle.run('prerequisites', () => {armed = true; if (group === 'compound-errors') {backing.PATH = '/owned/drift'; throw callbackError;} return 'successful callback';}));
    assert.ok(error instanceof AggregateError); assert.ok(error.errors.includes(restoreError));
    if (group === 'compound-errors') {assert.ok(error.errors.includes(callbackError)); assert.ok(stages(handle).includes('drift'));}
    assert.equal(handle.records[0].poisoned, true); assert.equal(handle.records[0].restored, false);
    assert.deepEqual(attempts, ['set:PATH', 'delete:GIT_EXEC_PATH', 'delete:GIT_OPTIONAL_LOCKS']);
    assert.throws(() => handle.assertIdle(), /poisoned/); let calls = 0; await rejection(() => route().run('private-finally', () => {calls++;})); assert.equal(calls, 0);
    return {failures: handle.records[0].failures, originalValuesRetained: true, attemptedRestores: attempts, poisonedReuseRefused: true};
  } finally {process.env = original;}
});

if (group === 'partial-installation') await check('E08.2', async () => {
  const original = process.env, backing = {...original}; let armed = true, calls = 0; const marker = new Error('independent install interruption');
  process.env = new Proxy(backing, {set(target, key, value) {if (armed && key === 'GIT_EXEC_PATH') {armed = false; throw marker;} return Reflect.set(target, key, value);}});
  try {const handle = route(), error = await rejection(() => handle.run('prerequisites', () => {calls++;})); assert.equal(calls, 0); assert.ok(error.errors.includes(marker)); assert.ok(stages(handle).includes('installation')); assert.equal(handle.records[0].restored, true); assert.deepEqual(backing, {...original}); handle.assertIdle(); return {stages: stages(handle), callbackCalls: calls};}
  finally {process.env = original;}
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
    const selected = args[2].slice(candidate.length + 1); assert.ok(paths.includes(selected)); assert.deepEqual(args, ['--no-replace-objects', 'show', candidate + ':' + selected]);
    verifyToolPath(binding, {...process.env}, nativeRoot);
    const candidates = process.env.PATH.split(':').map(folder => join(folder, command)).filter(path => fs.existsSync(path));
    assert.deepEqual(candidates, [join(binding.path, 'git')]); const resolved = fs.realpathSync(candidates[0]);
    assert.equal(resolved, direct.physical); assert.equal(digest(fs.readFileSync(resolved)), direct.sha256);
    const before = {command, args, cwd: options.cwd, envOptionPresent: false, effectiveEnvironment: snapshot(), candidates, resolvedTarget: resolved, binarySha256: direct.sha256, gitCore: binding.gitCore,
      dispatchEvidence: 'Unique first PATH route authenticated before actual bare-name spawn; no kernel exec-event trace, no TOCTOU guarantee'};
    fs.writeFileSync(join(output, 'git-' + calls + '-before.json'), JSON.stringify(before, null, 2) + '\n', {flag: 'wx'});
    const result = spawnSync(command, args, {...options, timeout: recipe.bounds.gitTimeoutMs, maxBuffer: recipe.bounds.gitOutputBytes, killSignal: 'SIGKILL'});
    const record = {before, pid: result.pid, status: result.status, signal: result.signal, error: result.error ? errorData(result.error) : null,
      stdout: result.stdout?.toString() ?? '', stderr: result.stderr?.toString() ?? '', stdoutBytes: result.stdout?.length ?? 0, stdoutSha256: result.stdout ? digest(result.stdout) : null};
    telemetry.push(record); fs.writeFileSync(join(output, 'git-' + calls + '-after.json'), JSON.stringify(record, null, 2) + '\n', {flag: 'wx'});
    assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.stderr.length, 0);
    assert.equal(record.stdoutSha256, expected[selected].sha256); verifyToolPath(binding, {...process.env}, nativeRoot); return result.stdout;
  };
  assert.equal(digest(recipe.helper.excerpt), recipe.helper.excerptSha256);
  const result = {}, before = snapshot(), handle = route();
  await handle.run('prerequisites', () => vm.runInNewContext(recipe.helper.excerpt, {result, execFileSync: boundedExec, repository, source, candidate, assert, sha: digest, readFileSync: fs.readFileSync, join}, {timeout: 15000}));
  assert.equal(calls, 2); assert.equal(result.authorities.length, 2); assert.deepEqual(snapshot(), before); handle.assertIdle();
  return {fixtureCommit: candidate, tree: treeId, expected, calls, excerptSha256: recipe.helper.excerptSha256, productCandidateRead: false, actualPrerequisitesInvoked: false};
});

assert.deepEqual(snapshot(), initial);
save();
console.log(JSON.stringify({group, rows: rows.map(row => ({id: row.id, status: row.status})), actualGitCalls: telemetry.length}));
process.exitCode = rows.some(row => row.status === 'FAIL') ? 1 : 0;
