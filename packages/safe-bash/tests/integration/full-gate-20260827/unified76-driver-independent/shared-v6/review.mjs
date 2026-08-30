import assert from 'node:assert/strict';
import childProcess, {execFileSync, spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream, copyFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {registerHooks, syncBuiltinESMExports} from 'node:module';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';

const owned = dirname(fileURLToPath(import.meta.url));
const repository = realpathSync(join(owned, '../../../../..'));
const prefix = 'tests/integration/full-gate-20260827/unified76-driver/launcher-v3/';
const plan = JSON.parse(readFileSync(join(owned, 'PLAN.json')));
const node = plan.bindings.node;
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
const object = (path, revision = plan.bindings.driver) => execFileSync(git, ['--no-replace-objects', 'show', `${revision}:${path}`], {cwd: repository, timeout: 15000, maxBuffer: plan.limits.metadataBytes});
const metadata = args => execFileSync(git, ['--no-replace-objects', ...args], {cwd: repository, timeout: 15000, maxBuffer: plan.limits.metadataBytes}).toString();
const work = join(owned, 'work');
const output = join(owned, 'raw');
assert.equal(existsSync(work), false);
assert.equal(existsSync(output), false);
mkdirSync(work); mkdirSync(output);
const report = {startedAt: new Date().toISOString(), command: [process.execPath, ...process.argv.slice(1)], planCommit: '59ffe78652669796db19592c48c9cd5c0b1477c6', planSha256: hash(readFileSync(join(owned, 'PLAN.json'))), bindings: plan.bindings, controls: [], fullGateLaunched: false, workspaceBefore: metadata(['status', '--porcelain=v1', '-uall']), stagedBefore: metadata(['diff', '--cached', '--raw'])};
const staged = [];
const prior = {};
for (const path of metadata(['ls-files', '-z', 'tests/integration/full-gate-20260827/unified76-driver-independent']).split('\0').filter(Boolean)) {
  if (path.includes('/shared-v6/')) continue;
  prior[path] = hash(readFileSync(join(repository, path)));
  assert.equal(prior[path], hash(object(path, 'HEAD')), path);
}
report.priorHashes = prior;
let sourceGuard;
let foreign;
let originalSpawn;
let deadline;
const loads = [];
const adapter = [];
async function fileHash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path, {highWaterMark: 65536})) digest.update(chunk);
  return digest.digest('hex');
}
async function control(id, body) {
  const row = {id, startedAt: new Date().toISOString()};
  try { row.evidence = await body(); row.status = 'PASS'; }
  catch (error) { row.status = 'FAIL'; row.error = {message: error.message, stack: error.stack}; }
  row.finishedAt = new Date().toISOString(); report.controls.push(row);
  save(join(output, `${id}.json`), row); console.log(JSON.stringify({id, status: row.status, error: row.error?.message}));
  return row;
}
const cleanEnvironment = {PATH: `${dirname(node)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: join(work, 'home'), TMPDIR: join(work, 'tmp'), TMP: join(work, 'tmp'), TEMP: join(work, 'tmp'), LANG: 'C', LC_ALL: 'C', TZ: 'UTC', NO_COLOR: '1', TSX_DISABLE_CACHE: '1', npm_config_cache: join(work, 'npm-cache'), npm_config_userconfig: join(work, 'npmrc'), npm_config_globalconfig: join(work, 'global-npmrc'), npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_registry: 'http://127.0.0.1:1'};
for (const name of ['home', 'tmp', 'harness']) mkdirSync(join(work, name));
writeFileSync(cleanEnvironment.npm_config_userconfig, '', {flag: 'wx'});
writeFileSync(cleanEnvironment.npm_config_globalconfig, '', {flag: 'wx'});
try {
  assert.equal(realpathSync(process.execPath), node);
  assert.equal(await fileHash(node), plan.bindings.nodeSha256);
  report.inspectionReceipt = {importsNotYetStarted: true, source: plan.bindings.driver, evidence: plan.bindings.evidence, candidate: plan.bindings.candidate};
  for (const [name, expected] of Object.entries(plan.bindings.runtimeFiles)) {
    const bytes = object(prefix + name); assert.equal(hash(bytes), expected, name);
    writeFileSync(join(owned, name), bytes, {flag: 'wx'}); staged.push(join(owned, name));
  }
  const sealBytes = object(prefix + 'DRIVER.json'); assert.equal(hash(sealBytes), plan.bindings.driverJsonSha256);
  writeFileSync(join(owned, 'DRIVER.json'), sealBytes, {flag: 'wx'}); staged.push(join(owned, 'DRIVER.json'));
  report.driverRawSha256 = hash(sealBytes); report.driverCanonicalSha256 = hash(JSON.stringify(JSON.parse(sealBytes)));
  for (const name of ['CANDIDATE.json', 'PROFILE.json.gz.base64', 'PROFILE-RECEIPT.json', 'CLEANUP.json', 'EXTERNAL.json.gz.base64', 'EXTERNAL-RECEIPT.json']) assert.equal(hash(object(prefix + name, '2713defc1f53a00dd975931946de4782a980836d')), plan.bindings.runtimeFiles[name], name);
  assert.equal(hash(object(prefix + 'review-v5/HANDOFF.md', plan.bindings.evidence)), plan.bindings.handoffSha256);
  assert.equal(metadata(['rev-parse', `${plan.bindings.candidate}^{tree}`]).trim(), plan.bindings.tree);
  report.fourPaths = metadata(['diff', '--name-only', plan.bindings.base, plan.bindings.candidate]).trim().split('\n');
  assert.equal(report.fourPaths.length, 4);
  report.srcTree = metadata(['rev-parse', `${plan.bindings.candidate}:src`]).trim();
  assert.equal(report.srcTree, metadata(['rev-parse', `${plan.bindings.base}:src`]).trim());
  report.carriedPack = {sha256: plan.bindings.packageSha256, priorIndependentSeal: '37b3c9c3c9c3e911286d0d8542c494f762e17015', reproducedHere: false, identicalCandidateAndSourceProfile: true};
  const allowed = new Map(Object.entries(plan.bindings.runtimeFiles).map(([name, digest]) => [join(owned, name), digest]));
  for (const name of ['execute.mjs', 'public.mjs', 'worker.mjs', 'run.mjs', 'review-build-types.mjs', 'review-build-types-worker.mjs']) allowed.delete(join(owned, name));
  const source = join(work, 'source');
  registerHooks({load(url, context, next) {
    if (url.startsWith('node:')) return next(url, context);
    assert.ok(url.startsWith('file:'));
    const path = realpathSync(fileURLToPath(url));
    assert.ok(allowed.has(path), `INDEPENDENT_LOAD_REFUSED: ${path}`);
    const sha256 = hash(readFileSync(path)); assert.equal(sha256, allowed.get(path));
    loads.push({path, sha256}); return next(url, context);
  }});
  const {verifyDriverSeal} = await import('./admission.mjs');
  const {readProfile} = await import('./profile.mjs');
  const {verifyExternal, externalReceipt} = await import('./external-admission.mjs');
  const {fileIdentity} = await import('./external.mjs');
  const {extractCommitted} = await import('./transport.mjs');
  const {capture, createTreeGuard, verifyArchive} = await import('./inventory.mjs');
  const {createBuildAudit, readBuildAudit, runBuildTypes} = await import('./build-types.mjs');
  const {createPhaseRunner} = await import('./phase-runner.mjs');
  const {supervise, processes} = await import('./supervise.mjs');
  const {attachProcessObserver} = await import('./process-observer.mjs');
  const {BOUNDS} = await import('./policy.mjs');
  verifyDriverSeal(); report.externalBefore = await verifyExternal(cleanEnvironment);
  report.extraTools = [await fileIdentity('/usr/bin/sandbox-exec')];
  const profile = readProfile();
  const external = externalReceipt().report;
  report.scope = {fullMetadataEntries: profile.scopeInputs.length, selectedRegularEntries: plan.sliceClosure.entries.length, selectedBytes: plan.sliceClosure.bytes, noAgentsCopies: true, fullRuntimeGateClosureClaimed: false};
  console.log('Authenticated tools/dependencies; streaming selected candidate objects.');
  report.selectedTransport = await extractCommitted({git, repository, candidate: plan.bindings.candidate, entries: plan.sliceClosure.entries, destination: source, environment: cleanEnvironment, bounds: {...BOUNDS, archiveEntries: plan.sliceClosure.entries.length, archiveBytes: plan.sliceClosure.bytes}});
  const authenticated = await verifyArchive(source, plan.sliceClosure.entries);
  report.selectedManifestSha256 = hash(JSON.stringify(authenticated));
  save(join(output, 'selected-manifest.json'), authenticated);
  execFileSync(git, ['init', '--quiet', '--template=', source], {env: cleanEnvironment, timeout: 10000});
  execFileSync(git, ['update-index', '-z', '--index-info'], {cwd: source, env: cleanEnvironment, input: profile.scopeInputs.map(entry => `${entry.mode} ${entry.blob}\t${entry.path}\0`).join(''), timeout: 10000});
  writeFileSync(join(source, '.git/HEAD'), plan.bindings.candidate + '\n');
  assert.deepEqual(execFileSync(git, ['ls-files', '-z'], {cwd: source, env: cleanEnvironment, maxBuffer: plan.limits.metadataBytes}).toString().split('\0').filter(Boolean).sort(), profile.scopeInputs.map(entry => entry.path).sort());
  const copied = [];
  for (const name of ['main', 'benchmarks']) {
    const tree = external.directories[name];
    const destination = join(source, name === 'main' ? 'node_modules' : 'benchmarks/node_modules');
    for (const entry of tree.entries) {
      const path = join(destination, entry.path);
      if (entry.kind === 'directory') { mkdirSync(path, {recursive: true}); continue; }
      if (entry.kind === 'symlink') { assert.ok(entry.path.startsWith('.bin/')); continue; }
      assert.equal(entry.kind, 'file'); assert.equal(await fileHash(entry.origin), entry.sha256);
      mkdirSync(dirname(path), {recursive: true}); copyFileSync(entry.origin, path); chmodSync(path, entry.mode);
      assert.equal(await fileHash(path), entry.sha256); copied.push({path: relative(source, path), bytes: entry.bytes, sha256: entry.sha256});
    }
  }
  save(join(output, 'copied-dependencies.json'), copied);
  for (const [path, entry] of Object.entries(authenticated.files)) if (path.endsWith('.mjs')) allowed.set(join(source, path), entry.sha256);
  const guard = join(work, 'harness/import-guard.mjs');
  const guardBytes = object('tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs', plan.bindings.candidate);
  writeFileSync(guard, guardBytes, {flag: 'wx'});
  const expected = join(work, 'harness/critical.json');
  save(expected, Object.fromEntries(['src/commands/execution.ts', 'src/commands/env-split.ts'].map(path => [path, profile.sourceBindings[path]])));
  Object.assign(cleanEnvironment, {FULL_GATE_ROOT: work, FULL_GATE_SOURCE: source, FULL_GATE_EXPECTED: expected, FULL_GATE_TOOL_ROOTS: JSON.stringify([external.directories.npm.root])});
  report.guard = {path: guard, sha256: hash(guardBytes), critical: JSON.parse(readFileSync(expected))};
  const policy = '(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath ' + JSON.stringify(work) + ') (subpath ' + JSON.stringify(output) + ') (literal "/dev/null"))\n(deny network*)\n(deny process-exec)\n(allow process-exec ' + [node, git, '/usr/bin/git', '/bin/sh'].map(path => '(literal ' + JSON.stringify(path) + ')').join(' ') + ')\n';
  const sandbox = join(work, 'slice.sb'); writeFileSync(sandbox, policy, {flag: 'wx'});
  report.sliceSandbox = {policy, sha256: hash(policy), qualification: 'Writes confined to owned work/output; network denied. Reads not universal sandboxed; exact clean environment and actual module guard/authenticated dependency trees. Trusted exact11 system metadata references only.'};
  originalSpawn = childProcess.spawn;
  childProcess.spawn = function (executable, args, options) {
    if (executable === node && options?.env?.UNIFIED76_BUILD_AUDIT) {
      const actualArgs = ['-f', sandbox, executable, ...args];
      adapter.push({executable, args, actualExecutable: '/usr/bin/sandbox-exec', actualArgs, cwd: options.cwd, nodeOptions: options.env.NODE_OPTIONS});
      return originalSpawn('/usr/bin/sandbox-exec', actualArgs, options);
    }
    return originalSpawn(executable, args, options);
  };
  syncBuiltinESMExports();
  const beforeAuthorizedBuild = await capture(source);
  const protectedInputs = await Promise.all(['src', 'tests', 'scripts', 'docs', 'benchmarks', 'node_modules', '.git'].filter(name => existsSync(join(source, name))).map(async name => ({name, guard: await createTreeGuard(join(source, name))})));
  const audit = createBuildAudit(source, work);
  const harnessGuard = await createTreeGuard(join(work, 'harness'));
  const verify = async () => {
    verifyDriverSeal();
    if (sourceGuard) assert.deepEqual((await sourceGuard.check()).changes, []);
    else for (const entry of protectedInputs) assert.deepEqual((await entry.guard.check()).changes, [], entry.name);
  };
  const slice = {phases: [], startedAt: new Date().toISOString(), fullGateLaunched: false};
  const completed = [];
  const order = ['cold-typecheck', 'typecheck-all'];
  const runner = createPhaseRunner({completed, report: slice, source, output, environment: cleanEnvironment, guard, verify, extraGuards: [harnessGuard], requireOrdered(previous, next) { assert.deepEqual(previous, order.slice(0, previous.length)); assert.equal(next, order[previous.length]); }, audit});
  const positive = await control('A10-shared-positive', async () => {
    const receipt = await runBuildTypes({phase: (label, args, cwd, expectedStatus) => runner(label, args, cwd, expectedStatus, plan.limits.phaseMs), source, output, report: slice, beforeAuthorizedBuild, tracked: verify, freezeSource: guard => { sourceGuard = guard; }, audit});
    await verify(); assert.deepEqual(completed, order);
    assert.equal(slice.phases[0].status, 78); assert.equal(slice.phases[1].status, 0);
    assert.equal(receipt.files.length, 832); assert.equal(readBuildAudit(audit).length, 1);
    const typing = JSON.parse(readFileSync(join(output, 'typecheck-all/report.json')));
    assert.equal(typing.status, 'typecheck-passed-not-runtime-acceptance');
    assert.equal(typing.candidateBinding.declarations.length, 208);
    save(join(output, 'positive-emit.json'), receipt);
    save(join(output, 'positive-audit.json'), readBuildAudit(audit));
    slice.finishedAt = new Date().toISOString();
    return {receiptSha256: hash(JSON.stringify(receipt)), builds: readBuildAudit(audit), typing, phases: slice.phases};
  });
  save(join(output, 'slice.json'), slice);
  if (positive.status === 'PASS') await control('A10-real-duplicate', async () => {
    const args = [join(source, 'node_modules/typescript/bin/tsc'), '-p', join(source, 'tsconfig.build.json')];
    const result = await supervise(node, args, {cwd: source, env: {...cleanEnvironment, ...audit.environment, FULL_GATE_IMPORTS: join(output, 'imports/duplicate'), NODE_OPTIONS: `--import=${pathToFileURL(guard).href} --import=${pathToFileURL(audit.preload).href}`}, timeoutMs: plan.limits.phaseMs, maxOutputBytes: plan.limits.childOutputBytes, stdout: join(output, 'duplicate.stdout'), stderr: join(output, 'duplicate.stderr'), observeSockets: true});
    assert.equal(result.status, 0); assert.ok(result.clean && result.closed && !result.signals.length && !result.survivors.length);
    let refusal; try { readBuildAudit(audit); } catch (error) { refusal = error.message; }
    assert.match(refusal, /unexpected duplicate driver production build/u);
    const events = readBuildAudit(audit, 2); assert.equal(events.length, 2); assert.notEqual(events[0].pid, events[1].pid);
    await verify();
    return {args, result, refusal, events, qualification: 'Two real production compiler commands: first positive shared slice, second intentional negative duplicate. Positive receipt frozen before second invocation.'};
  });
  childProcess.spawn = originalSpawn; syncBuiltinESMExports(); originalSpawn = undefined;
  report.externalAfter = await verifyExternal(cleanEnvironment);
  assert.deepEqual(await fileIdentity('/usr/bin/sandbox-exec'), report.extraTools[0]);
  await control('outer-observer-transport-and-foreign-isolation', async () => {
    const target = join(work, 'observer'); mkdirSync(target);
    const repo = join(target, 'objects'); execFileSync(git, ['init', '--bare', '--quiet', '--template=', repo], {env: cleanEnvironment, timeout: 10000});
    const put = bytes => execFileSync(git, ['--git-dir', repo, 'hash-object', '-w', '--stdin'], {input: bytes, env: cleanEnvironment, timeout: 10000}).toString().trim();
    const entries = [];
    const add = (path, bytes, mode = '100644') => entries.push({path, mode, blob: put(bytes), bytes: bytes.length});
    add('ordinary', Buffer.from('independent transport bytes\n'));
    add('contained', Buffer.from('ordinary'), '120000');
    const historicalBackslashes = profile.scopeInputs.filter(entry => entry.path.endsWith('controls/back\\slash'));
    assert.equal(historicalBackslashes.length, 2);
    for (const entry of historicalBackslashes) { const bytes = object(entry.path, plan.bindings.candidate); assert.equal(put(bytes), entry.blob); entries.push(entry); }
    add('literal\\name', Buffer.from('POSIX backslash is data\n'));
    add('literal-link', Buffer.from('literal\\name'), '120000');
    const escaping = Buffer.from('../ESCAPED'); const escapingBlob = put(escaping);
    const foreignChild = spawn(node, ['-e', 'process.stdout.write("READY\\n");setInterval(()=>{},1000)'], {cwd: work, env: cleanEnvironment, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
    foreign = foreignChild;
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('foreign sentinel start timeout')), 5000); foreignChild.stdout.once('data', () => { clearTimeout(timeout); resolve(); }); foreignChild.once('error', reject); });
    const foreignBefore = processes().find(row => row.pid === foreign.pid); assert.ok(foreignBefore); assert.equal(foreignBefore.group, foreign.pid);
    const config = join(target, 'config.json');
    const forbidden = join(work, 'FORBIDDEN-OBSERVER-WRITE');
    save(config, {owned, target, forbidden, foreignPid: foreign.pid, git, repo, candidate: plan.bindings.candidate, entries, escapingBlob, escapingBytes: escaping.length, environment: cleanEnvironment, driverHashes: plan.bindings.runtimeFiles, bounds: {...BOUNDS, archiveEntries: entries.length, archiveBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0)}});
    const policy = '(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath ' + JSON.stringify(target) + ') (literal "/dev/null"))\n(deny network*)\n(deny process-exec)\n(allow process-exec ' + [node, git, '/bin/ps'].map(path => '(literal ' + JSON.stringify(path) + ')').join(' ') + ')\n';
    const sandbox = join(target, 'observer.sb'); writeFileSync(sandbox, policy, {flag: 'wx'});
    const token = randomUUID(); const args = ['-f', sandbox, node, join(owned, 'observer-probe.mjs'), config];
    const child = spawn('/usr/bin/sandbox-exec', args, {cwd: target, env: {...cleanEnvironment, UNIFIED76_OBSERVER_TOKEN: token}, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
    const observer = attachProcessObserver(child, token);
    let stdout = '', stderr = '', forced = false;
    const timeout = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, 60000);
    for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', bytes => { if (name === 'stdout') stdout += bytes; else stderr += bytes; if (stdout.length + stderr.length > plan.limits.smallTransportBytes) { forced = true; child.kill('SIGKILL'); } });
    const result = await new Promise(resolve => { child.once('error', error => resolve({error: error.message})); child.once('close', (status, signal) => resolve({status, signal})); });
    clearTimeout(timeout);
    const observed = observer.finish();
    const foreignAfter = processes().find(row => row.pid === foreign.pid);
    const raw = {args, policy, stdout, stderr, result, forced, observed, foreignBefore, foreignAfter, forbiddenExists: existsSync(forbidden)};
    save(join(output, 'observer-raw.json'), raw);
    if (existsSync(join(target, 'probe.json'))) copyFileSync(join(target, 'probe.json'), join(output, 'observer-probe.json'));
    assert.equal(forced, false); assert.equal(result.status, 0, stderr); assert.equal(result.signal, null); assert.deepEqual(observed.survivors, []);
    assert.ok(observed.groups.length >= 4); assert.ok(foreignAfter.born); assert.equal(foreignAfter.born, foreignBefore.born); assert.equal(foreignAfter.group, foreignBefore.group); assert.equal(existsSync(forbidden), false);
    return raw;
  });
} catch (error) {
  report.fatal = {message: error.message, stack: error.stack}; console.error(error.stack);
} finally {
  if (originalSpawn) { childProcess.spawn = originalSpawn; syncBuiltinESMExports(); }
  if (foreign) {
    const pid = foreign.pid;
    const closed = new Promise(resolve => foreign.once('close', (status, signal) => resolve({status, signal})));
    foreign.kill('SIGTERM'); report.foreignFinalCleanup = {pid, action: 'Intentional controller cleanup after survival proof; not watched-group cleanup', result: await closed};
  }
  report.adapter = adapter; report.parentLoads = loads;
  report.priorPreserved = Object.entries(prior).every(([path, digest]) => hash(readFileSync(join(repository, path))) === digest);
  report.stagedAfter = metadata(['diff', '--cached', '--raw']);
  report.finishedAt = new Date().toISOString(); report.workRetainedUntilEvidenceSeal = true;
  for (const path of staged) rmSync(path);
  report.stagedDriverRemoved = staged.every(path => !existsSync(path));
  save(join(output, 'REPORT.json'), report);
  console.log(JSON.stringify({controls: report.controls.map(({id, status}) => ({id, status})), fatal: report.fatal?.message, priorPreserved: report.priorPreserved}));
  process.exitCode = report.fatal || report.controls.some(row => row.status !== 'PASS') ? 1 : 0;
}
