import assert from 'node:assert/strict';
import childProcess, {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import fs, {createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import fsPromises from 'node:fs/promises';
import {registerHooks, syncBuiltinESMExports} from 'node:module';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, '../../../../..');
const prefix = 'tests/integration/full-gate-20260827/unified76-driver/launcher-v3/';
const plan = JSON.parse(readFileSync(join(owned, 'PLAN.json')));
const bindings = JSON.parse(readFileSync(join(owned, 'BINDINGS.json')));
const node = bindings.node.path;
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
const output = join(owned, 'raw'); assert.equal(existsSync(output), false); mkdirSync(output);
const work = realpathSync(mkdtempSync('/tmp/unified76-independent-projection-v7-'));
const source = join(work, 'source'), original = join(work, 'original');
for (const name of ['harness', 'home', 'tmp', 'original']) mkdirSync(join(work, name));
const environment = {PATH: `${dirname(node)}:${dirname(git)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: join(work, 'home'), TMPDIR: join(work, 'tmp'), TMP: join(work, 'tmp'), TEMP: join(work, 'tmp'), LANG: 'C', LC_ALL: 'C', TZ: 'UTC', NO_COLOR: '1', TSX_DISABLE_CACHE: '1', npm_config_cache: join(work, 'npm-cache'), npm_config_userconfig: join(work, 'npmrc'), npm_config_globalconfig: join(work, 'global-npmrc'), npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_registry: 'http://127.0.0.1:1'};
for (const path of [environment.npm_config_userconfig, environment.npm_config_globalconfig]) writeFileSync(path, '', {flag: 'wx'});
const metadata = (args, cwd = repository, input) => execFileSync(git, ['--no-replace-objects', ...args], {cwd, env: environment, input, timeout: 15000, maxBuffer: plan.limits.metadataBytes});
const blob = (path, revision = bindings.source) => metadata(['show', `${revision}:${path}`]);
const report = {startedAt: new Date().toISOString(), bindings, command: [process.execPath, ...process.argv.slice(1)], work, output, controls: [], children: [], loads: [], writes: {count: 0, instructionAttempts: []}, fullGateLaunched: false, workspaceBefore: metadata(['status', '--porcelain=v1', '-uall']).toString(), indexBefore: metadata(['diff', '--cached', '--raw']).toString()};
save(join(output, 'START.json'), {startedAt: report.startedAt, work, bindings, command: report.command});
const staged = [], active = new Map(), originalSpawn = childProcess.spawn;
const writeDigest = createHash('sha256');
let deadline, diskTimer, resourceFailure, foreign;
const diskBytes = root => readdirSync(root, {withFileTypes: true}).reduce((sum, entry) => sum + (entry.isDirectory() ? diskBytes(join(root, entry.name)) : lstatSync(join(root, entry.name)).size), 0);
const stop = reason => { resourceFailure = reason; report.resourceFailure = reason; for (const child of active.values()) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') report.cleanupError = error.message; } };
async function fileHash(path) { const digest = createHash('sha256'); for await (const chunk of createReadStream(path, {highWaterMark: 65536})) digest.update(chunk); return digest.digest('hex'); }
async function control(id, body) {
  const row = {id, startedAt: new Date().toISOString()};
  try { row.evidence = await body(); row.status = 'PASS'; }
  catch (error) { row.status = 'FAIL'; row.error = {message: error.message.slice(0, 8192), code: error.code, stack: error.stack?.slice(0, 16384)}; }
  row.finishedAt = new Date().toISOString(); report.controls.push(row); save(join(output, id + '.json'), row); console.log(JSON.stringify({id, status: row.status, error: row.error?.message})); return row;
}
async function refusal(label, body) {
  let error; try { await body(); } catch (caught) { error = {message: caught.message.slice(0, 8192), code: caught.code}; }
  assert.ok(error, label + ' was unexpectedly admitted'); return {label, expected: 'throw/HOLD', error};
}
const checkWrite = path => {
  const absolute = resolve(String(path));
  assert.ok(absolute.startsWith(work + '/') || absolute.startsWith(owned + '/'), 'outside owned write boundary: ' + absolute);
  if (basename(absolute).toLowerCase() === 'agents.md') { report.writes.instructionAttempts.push(absolute); throw Error('INDEPENDENT_INSTRUCTION_WRITE_INTERCEPTED: ' + absolute); }
  report.writes.count++; writeDigest.update(absolute + '\n');
};
const originalOpen = fsPromises.open, originalCopy = fs.cpSync;
fsPromises.open = async function(path, flags, ...rest) { if (typeof flags === 'string' && /[wax+]/u.test(flags)) checkWrite(path); return originalOpen.call(this, path, flags, ...rest); };
fs.cpSync = function(from, to, ...rest) { checkWrite(to); return originalCopy.call(this, from, to, ...rest); };
syncBuiltinESMExports();
try {
  assert.equal(realpathSync(process.execPath), node); assert.equal(await fileHash(node), bindings.node.sha256);
  for (const [name, expected] of Object.entries(bindings.runtimeFiles)) { const bytes = blob(prefix + name); assert.equal(sha(bytes), expected); writeFileSync(join(owned, name), bytes, {flag: 'wx'}); staged.push(join(owned, name)); }
  const sealBytes = blob(prefix + 'DRIVER.json'); assert.equal(sha(sealBytes), bindings.driverFileSha256); writeFileSync(join(owned, 'DRIVER.json'), sealBytes, {flag: 'wx'}); staged.push(join(owned, 'DRIVER.json'));
  const allowed = new Map(Object.entries(bindings.runtimeFiles).map(([name, digest]) => [join(owned, name), digest]));
  for (const name of ['execute.mjs', 'public.mjs', 'worker.mjs', 'run.mjs', 'review-build-types.mjs', 'review-build-types-worker.mjs']) allowed.delete(join(owned, name));
  registerHooks({load(url, context, next) { if (url.startsWith('node:')) return next(url, context); assert.ok(url.startsWith('file:')); const path = realpathSync(fileURLToPath(url)); assert.ok(allowed.has(path), 'UNBOUND_OR_GATE_MODULE: ' + path); const sha256 = sha(readFileSync(path)); assert.equal(sha256, allowed.get(path)); report.loads.push({path, sha256}); return next(url, context); }});
  const {readProfile, validateProfile} = await import('./profile.mjs');
  const {verifyDriverSeal, requireRelease} = await import('./admission.mjs');
  const {verifyAssembly, copyDependencies, npm} = await import('./common.mjs');
  const {readProjection, selectProjection, projectionReceipt, verifyProjectionReceipt, dependencyProjection, assertLinkProjection} = await import('./projection.mjs');
  const {extractCommitted, transferHistory, cleanGitEnvironment} = await import('./transport.mjs');
  const {capture, createTreeGuard, verifyArchive} = await import('./inventory.mjs');
  const {verifyExternal, externalReceipt, rejectAmbientInjection} = await import('./external-admission.mjs');
  const {fileIdentity} = await import('./external.mjs');
  const {createBuildAudit, readBuildAudit, runBuildTypes} = await import('./build-types.mjs');
  const {createPhaseRunner} = await import('./phase-runner.mjs');
  const {supervise, processes} = await import('./supervise.mjs');
  const {attachProcessObserver} = await import('./process-observer.mjs');
  const {BOUNDS} = await import('./policy.mjs');
  Object.assign(environment, cleanGitEnvironment(environment));
  const seal = verifyDriverSeal(), profile = readProfile(), projection = readProjection();
  report.assembly = verifyAssembly(); report.externalBefore = await verifyExternal(environment); report.externalReceipt = externalReceipt().receipt;
  for (const tool of bindings.additionalTools) assert.equal((await fileIdentity(tool.path)).sha256, tool.sha256);
  const external = externalReceipt().report;
  assert.equal(sha(JSON.stringify(seal)), bindings.driverCanonicalSha256); assert.equal(sha(JSON.stringify(projection)), bindings.projection.canonicalSha256);
  report.profileSha256 = sha(JSON.stringify(profile)); report.projection = projection;
  const policy = '(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath ' + JSON.stringify(work) + ') (subpath ' + JSON.stringify(output) + ') (literal "/dev/null"))\n(deny network*)\n(deny process-exec)\n(allow process-exec ' + [node, git, '/bin/sh', '/bin/bash'].map(path => '(literal ' + JSON.stringify(path) + ')').join(' ') + ')\n';
  const sandbox = join(work, 'containment.sb'); writeFileSync(sandbox, policy); report.sandbox = {policy, sha256: sha(policy)};
  childProcess.spawn = function(executable, args, options = {}) {
    const confined = executable === git || executable === node && options.env?.UNIFIED76_BUILD_AUDIT;
    const actualArgs = confined ? ['-f', sandbox, executable, ...args] : args;
    const child = originalSpawn(confined ? '/usr/bin/sandbox-exec' : executable, actualArgs, options);
    const row = {executable, args, actualExecutable: confined ? '/usr/bin/sandbox-exec' : executable, actualArgs, pid: child.pid, cwd: options.cwd, detached: options.detached, startedAt: new Date().toISOString()}; report.children.push(row);
    if (options.detached && child.pid) active.set(child.pid, child);
    const pack = executable === git && args.includes('pack-objects');
    if (pack) { const hash = createHash('sha256'); let bytes = 0; child.stdout.on('data', chunk => { hash.update(chunk); bytes += chunk.length; if (bytes > plan.limits.opaqueGitBytes) stop('opaque Git stream bound exceeded'); }); child.stdout.once('end', () => { row.opaqueStream = {bytes, sha256: hash.digest('hex')}; }); }
    child.once('close', (status, signal) => { row.status = status; row.signal = signal; row.closed = true; row.finishedAt = new Date().toISOString(); active.delete(child.pid); });
    return child;
  }; syncBuiltinESMExports();
  deadline = setTimeout(() => stop('whole execution deadline exceeded'), plan.limits.wholeExecutionMs);
  diskTimer = setInterval(() => { const bytes = diskBytes(work), raw = diskBytes(output); report.peakWorkBytes = Math.max(report.peakWorkBytes ?? 0, bytes); report.peakRawBytes = Math.max(report.peakRawBytes ?? 0, raw); if (bytes > plan.limits.temporaryBytes || raw > plan.limits.rawEvidenceBytes) stop('temporary/capture disk bound exceeded'); }, 10000);
  const early = await control('P02-projection-metadata-negatives', async () => {
    const rows = []; const entries = profile.scopeInputs; const selected = selectProjection(entries, bindings.candidate); assert.equal(selected.length, 5);
    for (const field of ['path', 'mode', 'bytes', 'sha256']) { const changed = structuredClone(projection); changed.candidateEntries[0][field] = field === 'bytes' ? changed.candidateEntries[0][field] + 1 : 'bad-' + changed.candidateEntries[0][field]; rows.push(await refusal('manifest-' + field, () => readProjection(changed))); }
    const mutated = field => entries.map(entry => entry.path === selected[0].path ? {...entry, [field]: field === 'bytes' ? entry.bytes + 1 : field === 'mode' ? '100755' : field === 'blob' ? '0'.repeat(40) : 'renamed-instruction'} : entry);
    for (const field of ['path', 'mode', 'bytes', 'blob']) rows.push(await refusal('logical-' + field, () => selectProjection(mutated(field), bindings.candidate)));
    rows.push(await refusal('missing-six-list-member', () => readProjection({...projection, candidateEntries: projection.candidateEntries.slice(1)})));
    rows.push(await refusal('wrong-original-candidate', () => selectProjection(entries, '0'.repeat(40))));
    rows.push(await refusal('noninstruction-omission', () => validateProfile({...profile, scopeInputs: entries.filter(entry => entry.path !== 'package.json')})));
    rows.push(await refusal('instruction-body-renamed-alias', () => selectProjection([{...selected[0], path: 'benign-alias.txt'}], bindings.candidate)));
    rows.push(await refusal('unknown-basename-not-exempt', () => selectProjection([{path: 'unknown/AGENTS.md', mode: '100644', blob: '1'.repeat(40), bytes: 0}], bindings.candidate)));
    rows.push(await refusal('link-to-instruction', () => assertLinkProjection('benign-link', 'AGENTS.md')));
    const dependency = projection.dependencyEntries[0]; const descriptor = {...dependency, mode: 0o644};
    assert.equal(dependencyProjection([descriptor], dependency.origin).length, 1);
    rows.push(await refusal('dependency-renamed-body', () => dependencyProjection([{...descriptor, path: 'benign-alias.txt'}], dependency.origin)));
    rows.push(await refusal('dependency-wrong-digest', () => dependencyProjection([{...descriptor, sha256: '0'.repeat(64)}], dependency.origin)));
    rows.push(await refusal('dependency-wrong-origin', () => dependencyProjection([descriptor], work)));
    rows.push(await refusal('dependency-name-not-exempt', () => dependencyProjection([{path: 'extra/AGENTS.md', mode: 0o644, bytes: 0, sha256: sha('')}], work)));
    for (const key of ['GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_REPLACE_REF_BASE', 'NODE_OPTIONS']) rows.push(await refusal('ambient-' + key, () => rejectAmbientInjection({[key]: '/unbound'})));
    rows.push(await refusal('fresh-release-empty', () => requireRelease({}, seal, profile)));
    assert.deepEqual(report.writes.instructionAttempts, []); return {selected, rows, instructionWrites: 0, physicalPresenceNegative: 'Not materialized: user forbids any new AGENTS path. Exact logical metadata and positive physical absence exercised instead.'};
  });
  if (early.status !== 'PASS') throw Error('Projection negative admission contradiction; dependent execution stopped');
  console.log('Transferring original reachable Git objects, no checkout.');
  const originalProof = await control('P04-original-reachable-objects', async () => {
    metadata(['init', '--quiet', '--template=', original]);
    const transfer = await transferHistory({git, repository, candidate: bindings.candidate, destination: original, environment});
    assert.ok(transfer.bytes <= plan.limits.opaqueGitBytes); assert.ok(transfer.lifecycle.every(row => row.status === 0 && row.closed && !row.survivors.length));
    writeFileSync(join(original, '.git/HEAD'), bindings.candidate + '\n'); metadata(['read-tree', bindings.candidate], original);
    assert.equal(metadata(['rev-parse', 'HEAD'], original).toString().trim(), bindings.candidate);
    assert.equal(metadata(['rev-parse', 'HEAD^{tree}'], original).toString().trim(), projection.tree);
    const commit = metadata(['cat-file', 'commit', bindings.candidate], original); assert.equal(sha(commit), JSON.parse(readFileSync(join(owned, 'CANDIDATE.json'))).rawCommitSha256);
    assert.equal(existsSync(join(original, '.git/objects/info/alternates')), false);
    assert.equal(metadata(['for-each-ref', 'refs/replace'], original).length, 0);
    metadata(['fsck', '--connectivity-only', '--no-dangling', bindings.candidate], original);
    const tree = metadata(['ls-tree', '-rlz', bindings.candidate], original); assert.deepEqual(tree, metadata(['ls-tree', '-rlz', bindings.candidate]));
    return {transfer, rawCommitSha256: sha(commit), treeMetadataSha256: sha(tree), noAlternates: true, noReplaceRefs: true, checkoutPerformed: false, originalIdsPreserved: true};
  }); if (originalProof.status !== 'PASS') throw Error('Original Git reconstruction failed; stop');
  async function archiveHash(cwd) {
    const args = ['--no-replace-objects', 'archive', '--format=tar', bindings.candidate];
    const child = childProcess.spawn(git, args, {cwd, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
    let bytes = 0, stderr = ''; const hash = createHash('sha256');
    const timeout = setTimeout(() => stop('archive hash deadline'), plan.limits.setupChildMs);
    child.stdout.on('data', chunk => { bytes += chunk.length; hash.update(chunk); if (bytes > plan.limits.archiveBytes) stop('archive hash byte bound'); });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 1048576) stop('archive stderr bound'); });
    const result = await new Promise(resolve => { child.once('error', error => resolve({error: error.message})); child.once('close', (status, signal) => resolve({status, signal})); }); clearTimeout(timeout);
    assert.equal(result.status, 0, stderr); assert.equal(result.signal, null); return {cwd, args, ...result, bytes, sha256: hash.digest('hex'), stderr, storedArchive: false};
  }
  const complete = await control('P01-complete-projection-and-archive', async () => {
    const originalArchive = await archiveHash(repository), reconstructedArchive = await archiveHash(original);
    assert.equal(originalArchive.bytes, reconstructedArchive.bytes); assert.equal(originalArchive.sha256, reconstructedArchive.sha256);
    const requireArchiveBinding = value => assert.deepEqual({bytes: value.bytes, sha256: value.sha256}, {bytes: originalArchive.bytes, sha256: originalArchive.sha256}, 'independent complete-original-archive binding');
    const archiveBindingNegatives = [await refusal('review-archive-digest', () => requireArchiveBinding({...reconstructedArchive, sha256: '0'.repeat(64)})), await refusal('review-archive-size', () => requireArchiveBinding({...reconstructedArchive, bytes: reconstructedArchive.bytes + 1}))];
    console.log('Original archive streams agree; extracting complete projected candidate.');
    const transport = await extractCommitted({git, repository: original, candidate: bindings.candidate, entries: profile.scopeInputs, destination: source, environment});
    const archive = await verifyArchive(source, profile.scopeInputs, transport);
    assert.deepEqual(transport.projection.logical, projection.logical); assert.deepEqual(transport.projection.physical, projection.physical);
    assert.equal(archive.count, 37392); assert.equal(archive.metadataOnly.length, 5);
    for (const entry of projection.candidateEntries) assert.equal(existsSync(join(source, entry.path)), false);
    for (const [path, entry] of Object.entries(archive.files)) assert.equal(entry.sha256, transport.hashes[path]);
    save(join(output, 'TRANSPORT.json'), transport); save(join(output, 'PHYSICAL.json'), archive);
    report.fullTransport = transport; report.fullArchive = archive;
    for (const [path, entry] of Object.entries(archive.files)) if (path.endsWith('.mjs')) allowed.set(join(source, path), entry.sha256);
    return {originalArchive, reconstructedArchive, archiveBindingNegatives, archiveGuardQualification: 'Independent static digest/length predicate on actual full archive streams; frozen extractor itself consumes original Git blobs, not an archive-hash parameter.', logical: transport.projection.logical, physical: transport.projection.physical, projection: transport.projection, transportSha256: sha(JSON.stringify(transport)), physicalSha256: sha(JSON.stringify(archive)), instructionWrites: report.writes.instructionAttempts};
  }); if (complete.status !== 'PASS') throw Error('Complete projection failed; stop');
  await control('P03-physical-and-receipt-negatives', async () => {
    const rows = [], transport = report.fullTransport, entries = profile.scopeInputs;
    const wrongDigest = structuredClone(transport); wrongDigest.hashes[projection.candidateEntries[0].path] = '0'.repeat(64);
    rows.push(await refusal('omitted-content-digest', () => verifyProjectionReceipt(entries, wrongDigest)));
    const wrongTotals = structuredClone(transport); wrongTotals.projection.physical.bytes--;
    rows.push(await refusal('physical-count-byte-mismatch', () => verifyProjectionReceipt(entries, wrongTotals)));
    rows.push(await refusal('missing-stream-receipt', () => verifyProjectionReceipt(entries, undefined)));
    const target = join(source, 'package.json'), saved = join(work, 'package.json.saved');
    fs.renameSync(target, saved); try { rows.push(await refusal('missing-noninstruction-physical', () => verifyArchive(source, entries, transport))); } finally { fs.renameSync(saved, target); }
    const extra = join(source, 'INDEPENDENT-EXTRA'); writeFileSync(extra, 'benign extra'); try { rows.push(await refusal('extra-physical-entry', () => verifyArchive(source, entries, transport))); } finally { rmSync(extra); }
    const linked = join(work, 'package-hardlink'); fs.linkSync(target, linked); try { rows.push(await refusal('hardlink-physical-alias', () => verifyArchive(source, entries, transport))); } finally { rmSync(linked); }
    const originalMode = lstatSync(target).mode & 0o777; fs.chmodSync(target, 0o600); try { rows.push(await refusal('changed-physical-mode', () => verifyArchive(source, entries, transport))); } finally { fs.chmodSync(target, originalMode); }
    const originalBytes = readFileSync(target); writeFileSync(target, Buffer.concat([originalBytes, Buffer.from('\n')])); try { rows.push(await refusal('changed-physical-content', () => verifyArchive(source, entries, transport))); } finally { writeFileSync(target, originalBytes); }
    const restored = await verifyArchive(source, entries, transport); assert.equal(sha(JSON.stringify(restored)), sha(JSON.stringify(report.fullArchive)));
    return {rows, unmodifiedPositiveWitnessRestored: true};
  });
  if (report.controls.some(row => row.status === 'FAIL')) throw Error('Projection physical contradiction; dependent build stopped');
  console.log('Authenticating complete main/benchmark projections and host npm tool closure.');
  const deps = await control('P05-complete-dependency-integration', async () => {
    const receipts = [copyDependencies(join(source, 'node_modules')), copyDependencies(join(source, 'benchmarks/node_modules'), join(repository, 'benchmarks/node_modules'))];
    for (const [index, role] of ['main', 'benchmarks'].entries()) {
      const tree = external.directories[role], destination = join(source, role === 'main' ? 'node_modules' : 'benchmarks/node_modules');
      const originals = tree.entries.filter(entry => entry.kind === 'file' && !entry.path.startsWith('.bin/'));
      const omissions = receipts[index].metadataOnly; assert.equal(omissions.length, role === 'main' ? 0 : 1);
      const expected = originals.filter(entry => !omissions.some(omitted => omitted.path === entry.path)).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
      const actual = await capture(destination); const files = actual.entries.filter(entry => entry.kind === 'file' && !entry.path.startsWith('.bin/'));
      assert.deepEqual(files.map(entry => ({path: entry.path, bytes: entry.bytes, mode: entry.mode, sha256: entry.sha256})), expected.map(entry => ({path: entry.path, bytes: entry.bytes, mode: entry.mode, sha256: entry.sha256})));
      for (const entry of omissions) assert.equal(existsSync(join(destination, entry.path)), false);
    }
    report.dependencies = receipts; return {receipts, npm: {origin: external.directories.npm.origin, sha256: external.directories.npm.sha256, entries: external.directories.npm.entries.length, bytes: external.directories.npm.bytes, copied: false, qualification: 'Actual fixed npm CLI reads the entire authenticated readonly host tree; no substitute executable, install or projection exemption.'}};
  }); if (deps.status !== 'PASS') throw Error('Dependency reconciliation failed; stop');
  metadata(['init', '--quiet', '--template=', source]); metadata(['update-index', '-z', '--index-info'], source, profile.scopeInputs.map(entry => `${entry.mode} ${entry.blob}\t${entry.path}\0`).join('')); writeFileSync(join(source, '.git/HEAD'), bindings.candidate + '\n');
  const guard = join(work, 'harness/import-guard.mjs'); writeFileSync(guard, blob('tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs', bindings.candidate));
  const expected = join(work, 'harness/critical.json'); save(expected, Object.fromEntries(['src/commands/execution.ts', 'src/commands/env-split.ts'].map(path => [path, profile.sourceBindings[path]])));
  Object.assign(environment, {FULL_GATE_ROOT: work, FULL_GATE_SOURCE: source, FULL_GATE_EXPECTED: expected, FULL_GATE_TOOL_ROOTS: JSON.stringify([external.directories.npm.root])});
  const beforeAuthorizedBuild = await capture(source), protectedInputs = await Promise.all(['src', 'tests', 'scripts', 'docs', 'benchmarks', 'node_modules', '.git'].map(async name => ({name, guard: await createTreeGuard(join(source, name))})));
  const audit = createBuildAudit(source, work), harnessGuard = await createTreeGuard(join(work, 'harness')); let sourceGuard;
  const verify = async () => { assert.equal(resourceFailure, undefined); verifyDriverSeal(); if (sourceGuard) assert.deepEqual((await sourceGuard.check()).changes, []); else for (const entry of protectedInputs) assert.deepEqual((await entry.guard.check()).changes, [], entry.name); };
  const slice = {phases: []}, completed = [], order = ['cold-typecheck', 'typecheck-all'];
  const runner = createPhaseRunner({completed, report: slice, source, output, environment, guard, verify, extraGuards: [harnessGuard], requireOrdered(previous, next) { assert.deepEqual(previous, order.slice(0, previous.length)); assert.equal(next, order[previous.length]); }, audit});
  const positive = await control('P06-shared-A10-positive', async () => {
    const receipt = await runBuildTypes({phase: (label, args, cwd, expectedStatus) => runner(label, args, cwd, expectedStatus, plan.limits.phaseMs), source, output, report: slice, beforeAuthorizedBuild, tracked: verify, freezeSource: value => { sourceGuard = value; }, audit});
    assert.deepEqual(slice.phases.map(row => row.status), [78, 0]); assert.equal(receipt.files.length, 832); assert.equal(readBuildAudit(audit).length, 1);
    const typing = JSON.parse(readFileSync(join(output, 'typecheck-all/report.json'))); assert.equal(typing.status, 'typecheck-passed-not-runtime-acceptance'); assert.equal(typing.consumers.groups.length, 23); assert.equal(typing.sourceConsumers.groups.length, 3); assert.equal(typing.consumers.negativeTypes.length, 3); assert.ok([...typing.consumers.groups, ...typing.sourceConsumers.groups, ...typing.consumers.negativeTypes].every(row => row.status === 'pass')); assert.deepEqual(typing.consumers.negativeTypes.map(row => row.diagnostics), [1, 2, 5]); assert.equal(typing.candidateBinding.declarations.length, 208); assert.equal(typing.runtimeExecutions, 0);
    assert.equal(sha(JSON.stringify(receipt)), 'f628eb40fdd27ec3980f98c6b026238b316d345fc0eb759584c0b82d22a675b4');
    save(join(output, 'EMIT.json'), receipt); save(join(output, 'POSITIVE-AUDIT.json'), readBuildAudit(audit));
    return {phases: slice.phases, typingSummary: {status: typing.status, maintained: typing.consumers.groups, source: typing.sourceConsumers.groups, negatives: typing.consumers.negativeTypes, declarations: 208, runtimeExecutions: 0}, buildAudit: readBuildAudit(audit), emitReceiptSha256: sha(JSON.stringify(receipt)), metadataSha256: typing.candidateBinding.metadataSha256};
  }); save(join(output, 'SLICE.json'), slice);
  if (positive.status === 'PASS') await control('P06-real-duplicate-build', async () => {
    const args = [join(source, 'node_modules/typescript/bin/tsc'), '-p', join(source, 'tsconfig.build.json')];
    const result = await supervise(node, args, {cwd: source, env: {...environment, ...audit.environment, FULL_GATE_IMPORTS: join(output, 'imports/duplicate'), NODE_OPTIONS: `--import=${pathToFileURL(guard).href} --import=${pathToFileURL(audit.preload).href}`}, timeoutMs: plan.limits.phaseMs, maxOutputBytes: plan.limits.childCaptureBytes, stdout: join(output, 'duplicate.stdout'), stderr: join(output, 'duplicate.stderr'), observeSockets: true});
    assert.equal(result.status, 0); assert.ok(result.clean && result.closed && !result.signals.length && !result.survivors.length);
    const denied = await refusal('real-duplicate-audit', () => readBuildAudit(audit)); assert.match(denied.error.message, /unexpected duplicate driver production build/u); const events = readBuildAudit(audit, 2); assert.equal(events.length, 2); assert.notEqual(events[0].pid, events[1].pid); await verify(); return {args, result, denied, events};
  });
  await control('P07-outer-observer-and-foreign-isolation', async () => {
    const target = join(work, 'observer'); mkdirSync(target); const repo = join(target, 'objects'); metadata(['init', '--bare', '--quiet', '--template=', repo]);
    const put = bytes => metadata(['--git-dir', repo, 'hash-object', '-w', '--stdin'], repository, bytes).toString().trim();
    const entries = [], add = (path, bytes, mode = '100644') => entries.push({path, mode, blob: put(bytes), bytes: bytes.length});
    add('ordinary', Buffer.from('independent transport bytes\n')); add('contained', Buffer.from('ordinary'), '120000');
    const backslashes = profile.scopeInputs.filter(entry => entry.path.endsWith('controls/back\\slash')); assert.equal(backslashes.length, 2); for (const entry of backslashes) { const bytes = metadata(['cat-file', 'blob', entry.blob], original); assert.equal(put(bytes), entry.blob); entries.push(entry); }
    add('literal\\name', Buffer.from('POSIX backslash is data\n')); add('literal-link', Buffer.from('literal\\name'), '120000'); const escaping = Buffer.from('../ESCAPED');
    foreign = childProcess.spawn(node, ['-e', 'process.stdout.write("READY\\n");setInterval(()=>{},1000)'], {cwd: work, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe']}); await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(Error('sentinel timeout')), 5000); foreign.stdout.once('data', () => { clearTimeout(timeout); resolve(); }); foreign.once('error', reject); });
    const before = processes().find(row => row.pid === foreign.pid); assert.equal(before.group, foreign.pid);
    const config = join(target, 'config.json'), forbidden = join(work, 'FORBIDDEN-OBSERVER-WRITE');
    save(config, {owned, target, forbidden, foreignPid: foreign.pid, git, repo, candidate: bindings.candidate, entries, escapingBlob: put(escaping), escapingBytes: escaping.length, environment, driverHashes: bindings.runtimeFiles, bounds: {...BOUNDS, archiveEntries: entries.length, archiveBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0)}});
    const targetPolicy = '(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath ' + JSON.stringify(target) + ') (literal "/dev/null"))\n(deny network*)\n(deny process-exec)\n(allow process-exec ' + [node, git, '/bin/ps'].map(path => '(literal ' + JSON.stringify(path) + ')').join(' ') + ')\n';
    const policyPath = join(target, 'observer.sb'); writeFileSync(policyPath, targetPolicy); const token = randomUUID();
    const args = ['-f', policyPath, node, join(owned, 'observer-probe.mjs'), config]; const child = childProcess.spawn('/usr/bin/sandbox-exec', args, {cwd: target, env: {...environment, UNIFIED76_OBSERVER_TOKEN: token}, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc']}); const observer = attachProcessObserver(child, token);
    let stdout = '', stderr = '', forced = false; const timeout = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, 60000);
    child.stdout.on('data', bytes => { stdout += bytes; if (stdout.length > plan.limits.smallTransportBytes) { forced = true; child.kill('SIGKILL'); } }); child.stderr.on('data', bytes => { stderr += bytes; if (stderr.length > plan.limits.smallTransportBytes) { forced = true; child.kill('SIGKILL'); } });
    const result = await new Promise(resolve => child.once('close', (status, signal) => resolve({status, signal}))); clearTimeout(timeout); const observed = observer.finish(), after = processes().find(row => row.pid === foreign.pid);
    const raw = {args, policy: targetPolicy, stdout, stderr, result, observed, before, after, forced}; save(join(output, 'OBSERVER.json'), raw); if (existsSync(join(target, 'probe.json'))) save(join(output, 'OBSERVER-PROBE.json'), JSON.parse(readFileSync(join(target, 'probe.json'))));
    assert.equal(result.status, 0, stderr); assert.equal(result.signal, null); assert.equal(forced, false); assert.deepEqual(observed.survivors, []); assert.equal(after.born, before.born); assert.equal(after.group, before.group); assert.equal(existsSync(forbidden), false); return raw;
  });
  report.externalAfter = await verifyExternal(environment); for (const tool of bindings.additionalTools) assert.equal((await fileIdentity(tool.path)).sha256, tool.sha256);
  await control('P08-postrun-integrity-and-HOLD', async () => {
    await verify(); const found = [];
    const visit = (root, prefix = '') => { for (const entry of readdirSync(root, {withFileTypes: true})) { const path = join(root, entry.name), local = prefix ? prefix + '/' + entry.name : entry.name; if (entry.name.toLowerCase() === 'agents.md') found.push(local); if (entry.isDirectory()) visit(path, local); } }; visit(source); assert.deepEqual(found, []); assert.deepEqual(report.writes.instructionAttempts, []);
    const rootRefusal = await refusal('no-new-root-release', () => requireRelease({action: 'PENDING_ROOT_RELEASE_UNIFIED76'}, seal, profile));
    return {sourceGuardPassed: true, appendProof: true, instructionFiles: found, completeLogicalInputCount: profile.scopeInputs.length, physicalCandidateFiles: report.fullArchive.count, rootRefusal, publicPrerequisites: 'Root accepted HTML/DU/Expr; not a new release', fullGateLaunched: false};
  });
} catch (error) {
  report.fatal = {message: error.message.slice(0, 8192), stack: error.stack?.slice(0, 16384)}; console.error(report.fatal.stack);
} finally {
  clearTimeout(deadline); clearInterval(diskTimer);
  if (foreign) { const closed = new Promise(resolve => foreign.once('close', (status, signal) => resolve({status, signal}))); foreign.kill('SIGTERM'); report.foreignCleanup = {pid: foreign.pid, result: await closed, explicitAfterSurvival: true}; }
  childProcess.spawn = originalSpawn; fsPromises.open = originalOpen; fs.cpSync = originalCopy; syncBuiltinESMExports();
  report.activeOwnedChildren = [...active.keys()]; report.writes.pathDigest = writeDigest.digest('hex'); report.finishedAt = new Date().toISOString(); report.workRetainedForStaticSeal = true;
  for (const path of staged) rmSync(path);
  report.stagedDriverRemoved = staged.every(path => !existsSync(path)); save(join(output, 'REPORT.json'), report);
  console.log(JSON.stringify({controls: report.controls.map(({id, status}) => ({id, status})), fatal: report.fatal?.message, activeOwnedChildren: report.activeOwnedChildren, work}));
  process.exitCode = report.fatal || report.controls.some(row => row.status !== 'PASS') ? 1 : 0;
}
