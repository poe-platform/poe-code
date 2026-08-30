import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
import {gzipSync} from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
assert.deepEqual(process.argv.slice(2), ['--cohort-once']);
const recipeBytes = fs.readFileSync(join(here, 'RECIPE.json'));
const recipe = JSON.parse(recipeBytes);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const repository = '/Users/kjopek/Workspace/safe-bash';
const prefix = 'tests/integration/full-gate-20260827/unified76-driver/launcher-v3/';
const git = recipe.tools.find(row => row.origin === '/Applications/Xcode.app/Contents/Developer/usr/bin/git');
const node = recipe.tools.find(row => row.origin.endsWith('/v24.11.1/bin/node'));
assert.equal(fs.realpathSync(process.execPath), node.physical);
const parentEnvironment = {PATH: '/dev/null', LANG: 'C', LC_ALL: 'C', TZ: 'UTC'};
const metadataEnvironment = {...parentEnvironment, GIT_EXEC_PATH: recipe.gitCore.origin, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1'};
for (const tool of recipe.tools) {
  const stat = fs.lstatSync(tool.physical);
  assert.ok(stat.isFile()); assert.equal(stat.size, tool.bytes); assert.equal(stat.mode & 0o777, tool.mode);
  assert.equal(digest(fs.readFileSync(tool.physical)), tool.sha256, 'tool changed before cohort');
}
const readBlob = name => execFileSync(git.physical, ['--no-replace-objects', 'show', recipe.reseal + ':' + prefix + name], {cwd: repository, env: metadataEnvironment, timeout: 10000, maxBuffer: 3 * 1024 * 1024});
const sourceBytes = new Map();
for (const row of recipe.closure) {const bytes = readBlob(row.name); assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256); sourceBytes.set(row.name, bytes);}
assert.equal(digest(JSON.stringify(JSON.parse(sourceBytes.get('DRIVER.json')))), recipe.driverSha256);
const candidate = JSON.parse(sourceBytes.get('CANDIDATE.json'));
assert.equal(candidate.candidate, recipe.product); assert.equal(candidate.expectedPackageSha256, recipe.packageSha256);
const shipping = sourceBytes.get('execute.mjs').toString();
const adapter = sourceBytes.get('tool-routing.mjs').toString();
const start = {startedAt: new Date().toISOString(), source: recipe.source, reseal: recipe.reseal, evidence: recipe.evidence,
  recipeSha256: digest(recipeBytes), reviewSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))), workerSha256: digest(fs.readFileSync(join(here, 'worker.mjs'))),
  invocation: {executable: process.execPath, args: process.argv.slice(1)}, cohortLimit: 1};
fs.writeFileSync(join(here, 'COHORT-START.json'), JSON.stringify(start, null, 2) + '\n', {flag: 'wx'});
const rows = [], groups = [], roots = [], raw = [], imports = [];
const started = Date.now(); let captureBytes = 0, stopped = false, failure;
const resultFile = join(here, 'RESULTS.json');
const summary = () => ({pass: rows.filter(row => row.status === 'PASS').length, fail: rows.filter(row => row.status === 'FAIL').length, unexecuted: rows.filter(row => row.status === 'UNEXECUTED').length});
const save = () => fs.writeFileSync(resultFile, JSON.stringify({schema: 'scoped-env-independent-v13-results/1', start, rows, groups, raw, roots, imports, counts: summary(), stopped, failure, runtime: {fullGate: false, A10: false, privateOperations: false, pack: false}}, null, 2) + '\n');
const staticCheck = (id, callback) => {try {rows.push({id, status: 'PASS', kind: 'STATIC_ONLY', detail: callback()});} catch (error) {rows.push({id, status: 'FAIL', kind: 'STATIC_ONLY', error: {message: error.message, stack: error.stack}});} save();};
const predicates = {
  'E02.1': text => text.includes("report.prerequisites=await helperRoute.run('prerequisites',()=>privateModule.prerequisites({repository,source,temporary,environment,candidate:candidate.candidate}));"),
  'E02.2': text => text.includes("await helperRoute.run('private-final-sweep',()=>privateModule.privateState())"),
  'E02.3': text => text.includes("if(report.privateBefore&&privateModule)") && text.includes("report.privateAfter=await helperRoute.run('private-finally',()=>privateModule.privateState());")
};
for (const [id, predicate] of Object.entries(predicates)) staticCheck(id, () => {assert.ok(predicate(shipping)); return {sourceSha256: digest(shipping), sourceFacts: recipe.sourceFacts, qualification: 'Exact shipping callsite source proof only; no actual private function or execute entry invoked'};});
staticCheck('E02.4', () => {
  const mutants = ['prerequisites', 'private-final-sweep', 'private-finally'].map((label, index) => {
    const text = shipping.replace("helperRoute.run('" + label + "'", "unwrappedCall('");
    assert.equal(predicates['E02.' + (index + 1)](text), false); return {label, rejected: true};
  });
  return {mutants, originalSourceUntouched: true};
});
staticCheck('E04.2', () => {
  assert.deepEqual(recipe.closure.filter(row => !row.unchangedFromFe15).map(row => row.name), ['DRIVER.json', 'execute.mjs', 'tool-routing.mjs']);
  assert.ok(adapter.includes("const inheritedKeys = ['PATH', 'GIT_EXEC_PATH', 'GIT_OPTIONAL_LOCKS'];"));
  assert.ok(shipping.includes('helperRoute.assertIdle();await verifyExternal();'));
  return {unchangedShippingMembers: 35, inheritedNotFreshGuardExecution: true};
});
staticCheck('E09.3', () => {
  assert.ok(shipping.indexOf('helperRoute=createInheritedHelperRoute') < shipping.indexOf('report.privateBefore=report.prerequisites.safejs.before'));
  assert.ok(predicates['E02.3'](shipping));
  return {eligibleFinallyRetained: true, uncleanPhaseOrRemoteTimeoutNotProvenClosed: true, noActualPrivateGuard: true};
});
staticCheck('E11.1', () => {
  assert.ok(!recipe.copyFiles.includes('execute.mjs')); assert.ok(!recipe.copyFiles.includes('run.mjs')); assert.ok(!recipe.copyFiles.includes('worker.mjs'));
  assert.ok(recipe.copyFiles.every(name => !/AGENTS|prerequisites|build-types|consumer|tsx/.test(name)));
  return {allowedModules: recipe.importModules, noPrivateProductEntryCopied: true, helperAuthorityExcerptOnly: recipe.helper.excerptSha256};
});
staticCheck('E12.1', () => {assert.equal(recipe.closure.length, 38); assert.equal(recipe.closure.filter(row => row.unchangedFromFe15).length, 35); return {inheritedOnly: recipe.closure.filter(row => row.unchangedFromFe15), originalAttemptRescored: false};});
staticCheck('E12.2', () => {
  const valid = value => value.freeze === 'bdb49d758809134e5aeb2aef57f8656a580f142e' && value.reseal === '96daebc077381fb63ab6447a26ab707ce790ff25' && value.permission.rootGo.startsWith('Current user permits one independent');
  assert.ok(valid(recipe)); assert.equal(valid({...recipe, reseal: 'HEAD'}), false); assert.equal(valid({...recipe, permission: {...recipe.permission, rootGo: 'author-only GO'}}), false);
  return {kind: 'Independent review admission-policy check, not shipping ROOT_RELEASE runtime test', fullGatePermission: false};
});

const tree = root => {
  const entries = []; let bytes = 0;
  const visit = relative => {
    const filename = join(root, relative), stat = fs.lstatSync(filename);
    const row = {path: relative, device: stat.dev, inode: stat.ino, mode: stat.mode & 0o777, kind: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file'};
    if (stat.isSymbolicLink()) row.target = fs.readlinkSync(filename);
    else if (stat.isFile()) {bytes += stat.size; assert.ok(bytes <= recipe.bounds.ownedDiskBytes, 'owned disk bound'); row.bytes = stat.size; row.sha256 = digest(fs.readFileSync(filename));}
    entries.push(row);
    if (stat.isDirectory()) for (const name of fs.readdirSync(filename).sort()) visit(relative === '.' ? name : relative + '/' + name);
  };
  visit('.'); return {bytes, entries};
};
const recordRoot = root => {const stat = fs.lstatSync(root); const row = {path: root, device: stat.dev, inode: stat.ino, removed: false}; roots.push(row); return row;};
const capture = (name, filename) => {
  const bytes = fs.readFileSync(filename); captureBytes += bytes.length;
  assert.ok(captureBytes <= recipe.bounds.totalCaptureBytes, 'total capture bound');
  const compressed = gzipSync(bytes); const target = join(here, 'raw', name + '.gz');
  fs.writeFileSync(target, compressed, {flag: 'wx'});
  raw.push({path: 'raw/' + name + '.gz', bytes: bytes.length, sha256: digest(bytes), compressedBytes: compressed.length, compressedSha256: digest(compressed)});
};
let container;
try {
  container = fs.mkdtempSync('/private/tmp/unified76-env-independent-'); recordRoot(container);
  const copiedDriver = join(container, 'driver'); fs.mkdirSync(copiedDriver);
  for (const name of recipe.copyFiles) fs.writeFileSync(join(copiedDriver, name), sourceBytes.get(name), {flag: 'wx'});
  fs.writeFileSync(join(container, 'RECIPE.json'), recipeBytes, {flag: 'wx'});
  fs.copyFileSync(join(here, 'worker.mjs'), join(container, 'worker.mjs'), fs.constants.COPYFILE_EXCL);
  fs.mkdirSync(join(here, 'raw'));
  const allowed = new Map(recipe.importModules.map(name => [pathToFileURL(join(copiedDriver, name)).href, recipe.closure.find(row => row.name === name).sha256]));
  registerHooks({resolve(specifier, context, next) {const result = next(specifier, context); assert.ok(result.url.startsWith('node:') || allowed.has(result.url), 'unbound coordinator import'); return result;},
    load(url, context, next) {const result = next(url, context); if (url.startsWith('file:')) {const hash = digest(result.source ?? fs.readFileSync(fileURLToPath(url))); assert.equal(hash, allowed.get(url)); imports.push({url, sha256: hash});} return result;}});
  const {superviseFencedWorker} = await import(pathToFileURL(join(copiedDriver, 'fenced-supervisor.mjs')));
  for (const group of recipe.groups) {
    if (Date.now() - started > recipe.bounds.cohortMs) throw Error('cohort deadline before next worker');
    const outer = join(container, group); fs.mkdirSync(outer);
    const output = '/tmp/full-gate-unified76-env13-' + container.split('-').at(-1) + '-' + group;
    assert.equal(fs.existsSync(output), false); assert.equal(digest(fs.readFileSync(join(container, 'worker.mjs'))), start.workerSha256);
    const fence = await superviseFencedWorker({output, outer, script: join(container, 'worker.mjs'), args: [group, container, output], cwd: container,
      environment: parentEnvironment, phases: [], limits: {timeoutMs: Math.min(group === 'authority' ? recipe.bounds.authorityWorkerMs : recipe.bounds.workerMs, recipe.bounds.cohortMs - (Date.now() - started)), maxOutputBytes: recipe.bounds.workerOutputBytes, observeSockets: true}});
    for (const entry of fence.envelope.roots) recordRoot(entry.path);
    const reportPath = join(output, 'worker.json'); let worker;
    if (fs.existsSync(reportPath)) {worker = JSON.parse(fs.readFileSync(reportPath)); rows.push(...worker.rows);}
    groups.push({group, workerStatus: fence.result.status, workerRows: worker?.rows.map(row => row.id) ?? [], fence});
    for (const entry of fs.readdirSync(outer).sort()) if (fs.lstatSync(join(outer, entry)).isFile()) capture(group + '-outer-' + entry, join(outer, entry));
    for (const entry of fs.readdirSync(output).sort()) if (fs.lstatSync(join(output, entry)).isFile()) capture(group + '-inner-' + entry, join(output, entry));
    for (const row of recipe.closure.filter(row => recipe.copyFiles.includes(row.name))) assert.equal(digest(fs.readFileSync(join(copiedDriver, row.name))), row.sha256, 'copied module/data integrity');
    save();
    if (!fence.clean || !fence.result.closed || fence.result.signals.length || fence.result.survivors.length || fence.result.timedOut || fence.result.outputExceeded) throw Error('unsafe capture/cleanup boundary; stop remaining workers');
    if (!worker) throw Error('worker produced no structured result; no retry');
  }
  staticCheck('E10.3', () => {
    const authority = groups.find(row => row.group === 'authority'); assert.ok(authority);
    const worker = JSON.parse(fs.readFileSync(join(authority.fence.envelope.roots[1].path, 'worker.json')));
    const sufficient = row => row.before?.command === 'git' && row.before.envOptionPresent === false && row.before.resolvedTarget === git.physical && row.before.binarySha256 === git.sha256 && row.before.candidates.length === 1 && Number.isInteger(row.pid) && Object.hasOwn(row, 'error') && Object.hasOwn(row, 'status');
    assert.equal(worker.telemetry.length, 2); for (const row of worker.telemetry) {assert.ok(sufficient(row)); assert.equal(sufficient({...row, before: {...row.before, resolvedTarget: undefined}}), false);}
    return {dispatches: 2, evidence: 'Unique authenticated pre-dispatch PATH resolution plus actual bare-name child outcome; not a kernel event or historical target attribution', incompleteReceiptRejected: true};
  });
  const clean = groups.length === recipe.groups.length && groups.every(row => row.fence.clean && row.fence.result.closed && !row.fence.result.signals.length && !row.fence.result.survivors.length);
  rows.push({id: 'E11.2', status: clean ? 'PASS' : 'FAIL', kind: 'EXERCISED_LIFECYCLE', detail: {workers: groups.length, clean, forcedSignals: groups.flatMap(row => row.fence.result.signals), backgroundClosureNotInferred: true, foreignIsolation: 'Unchanged shipping ownership protocol; no new foreign-sentinel experiment'}});
} catch (error) {stopped = true; failure = {message: error.message, stack: error.stack};}
finally {
  for (const entry of recipe.contractCases) if (!rows.some(row => row.id === entry.id)) rows.push({id: entry.id, status: 'UNEXECUTED', kind: 'NOT_REACHED', reason: failure?.message ?? 'No mapped executable evidence'});
  for (const row of [...roots].reverse()) {
    try {
      const stat = fs.lstatSync(row.path); assert.equal(stat.dev, row.device); assert.equal(stat.ino, row.inode); assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
      assert.ok(row.path.startsWith('/private/tmp/unified76-env-independent-') || row.path.startsWith('/private/tmp/unified76-os-write-') || row.path.startsWith('/private/tmp/full-gate-unified76-env13-'));
      row.finalTree = tree(row.path); fs.rmSync(row.path, {recursive: true}); row.removed = !fs.existsSync(row.path);
    } catch (error) {row.cleanupError = error.message; stopped = true;}
  }
  rows.sort((left, right) => left.id.localeCompare(right.id, undefined, {numeric: true}));
  assert.equal(new Set(rows.map(row => row.id)).size, 33); assert.equal(rows.length, 33);
  save();
}
const counts = summary();
const exitCode = counts.fail || counts.unexecuted || stopped || roots.some(row => !row.removed) ? 1 : 0;
const terminal = {finishedAt: new Date().toISOString(), counts, status: exitCode ? 'QUALIFIED_HOLD' : 'SCOPED_PASS_NOT_RELEASE', coordinatorExitCode: exitCode, workers: groups.length, stopped, rootsRemoved: roots.every(row => row.removed), failure};
fs.writeFileSync(join(here, 'TERMINAL.json'), JSON.stringify(terminal, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify(terminal));
process.exitCode = exitCode;
