import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
import {gzipSync} from 'node:zlib';
import vm from 'node:vm';
import {exactArgv, collectChild, successful} from './controls.mjs';

const here = dirname(fileURLToPath(import.meta.url));
assert.deepEqual(process.argv.slice(2), ['--cohort-once']);
const recipeBytes = fs.readFileSync(join(here, 'RECIPE.json'));
const recipe = JSON.parse(recipeBytes);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const metadataEnv = {...recipe.environment, GIT_EXEC_PATH: recipe.gitCore, GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1'};
assert.equal(digest(fs.readFileSync(recipe.git)), recipe.gitSha256);
const blob = (revision, filename) => execFileSync(recipe.git, ['--no-replace-objects', 'show', revision + ':' + filename],
  {cwd: recipe.repository, env: metadataEnv, timeout: 10000, maxBuffer: 4 * 1024 * 1024});
const inheritedBytes = blob(recipe.priorSeal, recipe.inheritedRecipe.path);
assert.equal(digest(inheritedBytes), recipe.inheritedRecipe.sha256);
const bindings = JSON.parse(inheritedBytes);
for (const row of recipe.code) assert.equal(digest(fs.readFileSync(join(here, row.name))), row.sha256);
for (const row of recipe.inherited) assert.equal(digest(fs.readFileSync(join(recipe.repository, row.path))), row.sha256);
for (const row of bindings.tools) {
  const stat = fs.lstatSync(row.physical);
  assert.ok(stat.isFile()); assert.equal(stat.size, row.bytes); assert.equal(stat.mode & 0o777, row.mode);
  assert.equal(digest(fs.readFileSync(row.physical)), row.sha256);
}
const sources = new Map();
for (const row of bindings.closure) {
  const bytes = blob(bindings.reseal, recipe.driverPrefix + row.name);
  assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256); sources.set(row.name, bytes);
}
assert.equal(digest(JSON.stringify(JSON.parse(sources.get('DRIVER.json')))), recipe.driverSha256);
assert.equal(bindings.closure.length, 38); assert.equal(bindings.closure.filter(row => row.unchangedFromFe15).length, 35);
const helper = blob(bindings.product, bindings.helper.path);
assert.equal(digest(helper), bindings.helper.sha256);
assert.ok(helper.toString().includes(bindings.helper.excerpt));
const rows = [], children = [], roots = [], raw = [], imports = [];
let failure, fence, worker, container, captureBytes = 0;
const started = Date.now();
fs.mkdirSync(join(here, 'raw'));
const capture = (name, bytes) => {
  captureBytes += bytes.length; assert.ok(captureBytes <= recipe.bounds.totalCaptureBytes);
  const compressed = gzipSync(bytes), filename = 'raw/' + name + '.gz';
  fs.writeFileSync(join(here, filename), compressed, {flag: 'wx'});
  raw.push({path: filename, bytes: bytes.length, sha256: digest(bytes), compressedBytes: compressed.length, compressedSha256: digest(compressed)});
};
const check = async (id, kind, callback) => {
  try {rows.push({id, kind, status: 'PASS', detail: await callback() ?? null});}
  catch (error) {rows.push({id, kind, status: 'FAIL', error: {message: error.message, stack: error.stack}});}
};
const ownRoot = filename => {
  const stat = fs.lstatSync(filename); roots.push({path: filename, device: stat.dev, inode: stat.ino, removed: false});
};
const tree = root => {
  const entries = []; let bytes = 0;
  const visit = relative => {
    const filename = join(root, relative), stat = fs.lstatSync(filename);
    const row = {path: relative, device: stat.dev, inode: stat.ino, mode: stat.mode & 0o777,
      kind: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file'};
    if (stat.isSymbolicLink()) row.target = fs.readlinkSync(filename);
    else if (stat.isFile()) {bytes += stat.size; assert.ok(bytes <= recipe.bounds.ownedDiskBytes); row.bytes = stat.size; row.sha256 = digest(fs.readFileSync(filename));}
    entries.push(row);
    if (stat.isDirectory()) for (const name of fs.readdirSync(filename).sort()) visit(relative === '.' ? name : relative + '/' + name);
  };
  visit('.'); return {bytes, entries};
};
try {
  const expected = ['--no-replace-objects', 'show', 'owned:path'];
  await check('C01', 'OFFLINE_COMPARATOR', () => {
    assert.deepEqual(exactArgv(vm.runInNewContext(JSON.stringify(expected), {}, {timeout: 1000}), expected), expected);
    return {crossRealmRealArray: true};
  });
  await check('C02', 'OFFLINE_COMPARATOR', () => {
    assert.throws(() => exactArgv(['--no-replace-objects', 'wrong', 'owned:path'], expected));
    assert.throws(() => exactArgv(['show', '--no-replace-objects', 'owned:path'], expected));
    return {wrongPrimitiveAndOrderRejected: true};
  });
  await check('C03', 'OFFLINE_COMPARATOR', () => assert.throws(() => exactArgv([...expected, 'extra'], expected)));
  await check('C04', 'OFFLINE_COMPARATOR', () => assert.throws(() => exactArgv(['--no-replace-objects', 'show', 1], expected)));
  await check('C05', 'OFFLINE_COMPARATOR', () => assert.throws(() => exactArgv(new Set(expected), expected)));
  await check('C06', 'OFFLINE_COMPARATOR', () => {
    assert.ok(Buffer.from('\ud800').equals(Buffer.from('\ud801')));
    assert.throws(() => exactArgv(['\ud800'], ['\ud801'])); return {unequalPrimitiveRejectedDespiteEqualUtf8Replacement: true};
  });
  await check('C07', 'OFFLINE_COMPARATOR', () => {
    let reads = 0; const args = [...expected]; Object.defineProperty(args, '1', {get() {reads++; return 'show';}});
    assert.throws(() => exactArgv(args, expected)); assert.equal(reads, 0); return {getterInvocations: reads};
  });
  for (const [id, mode, status, stdout] of [['C08', 'ordinary', 0, 'stdout-only\n'], ['C09', 'late-pass-nonzero', 7, 'ALL_PASS\n']]) {
    const receipt = await collectChild(recipe.node, [join(here, 'capture-child.mjs'), mode], {
      cwd: here, env: recipe.environment, timeoutMs: recipe.bounds.collectorChildMs, maxOutputBytes: recipe.bounds.workerOutputBytes});
    const {stdout: out, stderr: err, ...metadata} = receipt;
    children.push({id, command: [recipe.node, join(here, 'capture-child.mjs'), mode], ...metadata});
    capture(id + '-stdout', out); capture(id + '-stderr', err);
    if (!receipt.closed || receipt.signal || receipt.error || receipt.timedOut || receipt.outputExceeded || receipt.signals.length) throw Error('collector child safety/capture boundary; no continuation');
    await check(id, 'EXERCISED_COLLECTOR', () => {
      assert.equal(receipt.status, status); assert.equal(out.toString(), stdout); assert.equal(err.toString(), 'stderr-only\n');
      assert.equal(successful(receipt), status === 0); return {actualStatus: receipt.status, successful: successful(receipt), channelsExact: true};
    });
    if (mode === 'ordinary') await check('C10', 'OFFLINE_COLLECTOR_RECEIPT', () => {
      const mutations = [{status: 1}, {signal: 'SIGTERM'}, {closed: false}, {error: {code: 'EPERM'}}, {timedOut: true}, {outputExceeded: true}, {signals: [{signal: 'SIGTERM'}]}];
      for (const mutation of mutations) assert.equal(successful({...receipt, ...mutation}), false);
      return {mutationsRejected: mutations, notActualTimeoutOrSignalExperiments: true};
    });
  }
  if (rows.some(row => row.status !== 'PASS')) throw Error('corrected harness sensitivity prerequisite failed; no authority execution');
  container = fs.mkdtempSync('/private/tmp/unified76-env-v2-'); ownRoot(container);
  const driver = join(container, 'driver'); fs.mkdirSync(driver);
  for (const name of bindings.copyFiles) fs.writeFileSync(join(driver, name), sources.get(name), {flag: 'wx'});
  fs.writeFileSync(join(container, 'BINDINGS.json'), inheritedBytes, {flag: 'wx'});
  for (const name of ['worker.mjs', 'controls.mjs']) fs.copyFileSync(join(here, name), join(container, name), fs.constants.COPYFILE_EXCL);
  const allowed = new Map(bindings.importModules.map(name => [pathToFileURL(join(driver, name)).href, bindings.closure.find(row => row.name === name).sha256]));
  registerHooks({resolve(specifier, context, next) {const result = next(specifier, context); assert.ok(result.url.startsWith('node:') || allowed.has(result.url)); return result;},
    load(url, context, next) {const result = next(url, context); if (url.startsWith('file:')) {const hash = digest(result.source ?? fs.readFileSync(fileURLToPath(url))); assert.equal(hash, allowed.get(url)); imports.push({url, sha256: hash});} return result;}});
  const {superviseFencedWorker} = await import(pathToFileURL(join(driver, 'fenced-supervisor.mjs')));
  const outer = join(container, 'outer'); fs.mkdirSync(outer);
  const output = '/tmp/full-gate-unified76-env13v2-' + container.split('-').at(-1);
  assert.equal(fs.existsSync(output), false);
  fence = await superviseFencedWorker({output, outer, script: join(container, 'worker.mjs'), args: ['authority', container, output], cwd: container,
    environment: recipe.environment, phases: [], limits: {timeoutMs: Math.min(recipe.bounds.authorityWorkerMs, recipe.bounds.cohortMs - (Date.now() - started)), maxOutputBytes: recipe.bounds.workerOutputBytes, observeSockets: true}});
  for (const root of fence.envelope.roots) ownRoot(root.path);
  for (const [label, folder] of [['outer', outer], ['inner', output]]) for (const name of fs.readdirSync(folder).sort()) {
    const filename = join(folder, name); if (fs.lstatSync(filename).isFile()) capture(label + '-' + name, fs.readFileSync(filename));
  }
  if (!fence.clean || !fence.result.closed || fence.result.signals.length || fence.result.survivors.length || fence.result.timedOut || fence.result.outputExceeded) throw Error('shipping capture/cleanup breach');
  worker = JSON.parse(fs.readFileSync(join(output, 'worker.json'))); rows.push(...worker.rows);
  for (const name of bindings.copyFiles) assert.equal(digest(fs.readFileSync(join(driver, name))), bindings.closure.find(row => row.name === name).sha256);
  for (const name of ['worker.mjs', 'controls.mjs']) assert.equal(digest(fs.readFileSync(join(container, name))), recipe.code.find(row => row.name === name).sha256);
  assert.equal(fence.result.status, 0, 'worker actual nonzero cannot be overridden by PASS rows');
  assert.equal(fence.result.signal, null); assert.equal(fence.phaseReceipt.completed, 0);
} catch (error) {failure = {message: error.message, stack: error.stack};}
finally {
  if (!fence || (fence.clean && fence.result.closed && !fence.result.survivors.length)) {
    for (const root of [...roots].reverse()) {
      try {
        const stat = fs.lstatSync(root.path); assert.equal(stat.dev, root.device); assert.equal(stat.ino, root.inode);
        assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
        assert.ok(root.path.startsWith('/private/tmp/unified76-env-v2-') || root.path.startsWith('/private/tmp/unified76-os-write-') || root.path.startsWith('/private/tmp/full-gate-unified76-env13v2-'));
        root.finalTree = tree(root.path); fs.rmSync(root.path, {recursive: true}); root.removed = !fs.existsSync(root.path);
      } catch (error) {root.cleanupError = error.message; failure ??= {message: 'owned root cleanup failed'};}
    }
  }
}
for (const id of recipe.caseIds) if (!rows.some(row => row.id === id)) rows.push({id, status: 'UNEXECUTED', reason: failure?.message ?? 'Not reached'});
assert.equal(rows.length, recipe.caseIds.length); assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
for (const row of recipe.inherited) assert.equal(digest(fs.readFileSync(join(recipe.repository, row.path))), row.sha256);
const counts = {pass: rows.filter(row => row.status === 'PASS').length, fail: rows.filter(row => row.status === 'FAIL').length, unexecuted: rows.filter(row => row.status === 'UNEXECUTED').length};
const exitCode = failure || counts.fail || counts.unexecuted || roots.some(root => !root.removed) ? 1 : 0;
const result = {schema: 'scoped-env-v13-corrected-continuation/2', startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(),
  source: recipe.source, reseal: recipe.reseal, evidence: recipe.evidence, recipeSha256: digest(recipeBytes), counts, rows, children, fence, worker, imports, raw, roots, failure: failure ?? null,
  coordinatorExitCode: exitCode, prior33Rescored: false, originalE03_3: 'UNEXECUTED unsupported inadmissible nonempty-GIT restoration setup',
  fullGate: false, privateOperations: false, A10: false, pack: false, originalEpermTarget: 'UNKNOWN'};
fs.writeFileSync(join(here, 'RESULTS.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({counts, coordinatorExitCode: exitCode, actualGitReads: worker?.telemetry.length ?? 0, workerStatus: fence?.result.status,
  rootsRemoved: roots.every(root => root.removed), failure: failure ?? null}));
process.exitCode = exitCode;
