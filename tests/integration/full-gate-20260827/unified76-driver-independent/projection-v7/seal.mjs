import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream, existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, rmSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {createGzip, createGunzip, gunzipSync} from 'node:zlib';

const owned = dirname(fileURLToPath(import.meta.url)), repository = resolve(owned, '../../../../..');
const scope = relative(repository, owned), prefix = 'tests/integration/full-gate-20260827/unified76-driver/launcher-v3/';
const read = path => JSON.parse(readFileSync(join(owned, path)));
const bindings = read('BINDINGS.json'), plan = read('PLAN.json'), preinspection = read('PREINSPECTION.json');
const report = read('raw-followup/REPORT.json'), initial = read('raw/REPORT.json');
const work = report.work, source = join(work, 'source');
assert.ok(work.startsWith('/private/tmp/unified76-independent-projection-v7-'));
assert.equal(report.fatal, undefined); assert.equal(report.controls.length, 9); assert.ok(report.controls.every(row => row.status === 'PASS')); assert.deepEqual(report.activeOwnedChildren, []);
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const metadata = args => execFileSync(git, ['--no-replace-objects', ...args], {cwd: repository, timeout: 15000, maxBuffer: plan.limits.metadataBytes});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = path => metadata(['show', `${bindings.source}:${prefix}${path}`]);
const write = (name, value) => {
  const text = JSON.stringify(value, null, 2) + '\n';
  execFileSync('apply_patch', [], {cwd: repository, input: '*** Begin Patch\n*** Add File: ' + scope + '/' + name + '\n' + text.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch\n', maxBuffer: 1024 * 1024});
};
async function identity(path) { const hash = createHash('sha256'); let bytes = 0; for await (const chunk of createReadStream(path, {highWaterMark: 65536})) { bytes += chunk.length; hash.update(chunk); } return {bytes, sha256: hash.digest('hex')}; }
function paths(root, prefix = '') { return readdirSync(root, {withFileTypes: true}).sort((left, right) => left.name < right.name ? -1 : 1).flatMap(entry => { const path = prefix ? prefix + '/' + entry.name : entry.name; return entry.isDirectory() ? [path, ...paths(join(root, entry.name), path)] : [path]; }); }
const external = JSON.parse(gunzipSync(Buffer.from(blob('EXTERNAL.json.gz.base64').toString().trim(), 'base64')));
const projection = bindings.projection.body;
const physical = read('raw-followup/PHYSICAL.json');
const typing = read('raw-followup/typecheck-all/report.json');
const emit = read('raw-followup/EMIT.json');
const expectedModules = new Map(Object.entries(physical.files).map(([path, entry]) => [join(source, path), entry.sha256]));
const dependencyProof = [];
for (const role of ['main', 'benchmarks']) {
  const tree = external.directories[role], destination = join(source, role === 'main' ? 'node_modules' : 'benchmarks/node_modules');
  const omitted = role === 'benchmarks' ? projection.dependencyEntries : [];
  const wanted = tree.entries.filter(entry => entry.path !== '.' && !omitted.some(omit => omit.path === entry.path));
  assert.deepEqual(paths(destination).sort(), wanted.map(entry => entry.path).sort(), 'complete dependency namespace, including dirs/wrappers: ' + role);
  const witnesses = [];
  for (const entry of wanted) {
    const path = join(destination, entry.path), stat = lstatSync(path);
    if (entry.kind === 'directory') { assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); witnesses.push({path: entry.path, kind: 'directory', mode: stat.mode & 0o777}); continue; }
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
    const actual = await identity(path);
    if (entry.kind === 'symlink') {
      assert.ok(entry.path.startsWith('.bin/')); assert.equal(entry.insideOrigin, true);
      const installed = join(destination, relative(tree.origin, entry.physical));
      const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
      const expected = '#!/bin/sh\nexec ' + quote(installed) + ' "$@"\n';
      assert.equal(actual.sha256, sha(expected)); assert.equal(stat.mode & 0o777, 0o755);
      witnesses.push({path: entry.path, kind: 'declared-generated-bin-wrapper', ...actual, originalSymlink: entry});
    } else { assert.equal(entry.kind, 'file'); assert.equal(actual.bytes, entry.bytes); assert.equal(actual.sha256, entry.sha256); assert.equal(stat.mode & 0o777, entry.mode); witnesses.push({path: entry.path, kind: 'file', ...actual, mode: entry.mode}); }
    expectedModules.set(path, actual.sha256);
  }
  dependencyProof.push({role, logicalTreeSha256: tree.sha256, omitted, physicalEntries: wanted.length, physicalReceiptSha256: sha(JSON.stringify(witnesses)), binWrappers: witnesses.filter(row => row.kind === 'declared-generated-bin-wrapper'), allRegularFileAndDirectoryMembershipVerified: true});
}
for (const entry of external.directories.npm.entries) if (entry.kind === 'file') expectedModules.set(entry.origin, entry.sha256);
expectedModules.set(join(work, 'harness/build-audit.mjs'), bindings.runtimeFiles['build-audit.mjs']);
expectedModules.set(join(work, 'harness/import-guard.mjs'), sha(metadata(['show', `${bindings.candidate}:tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs`])));
const importsRoot = join(owned, 'raw-followup/imports'), logFiles = paths(importsRoot).filter(path => lstatSync(join(importsRoot, path)).isFile());
const loaded = new Map(); let loadRows = 0;
for (const path of logFiles) for (const line of readFileSync(join(importsRoot, path), 'utf8').split('\n').filter(Boolean)) { const row = JSON.parse(line); assert.equal(row.sha256, expectedModules.get(row.resolved), 'unbound actual module: ' + row.resolved); loaded.set(row.resolved, row.sha256); loadRows++; }
write('LOAD-AND-DEPENDENCIES.json', {dependencyProof, hostNpm: {origin: external.directories.npm.origin, sha256: external.directories.npm.sha256, entries: external.directories.npm.entries.length, beforeAfter: report.externalBefore.readableBindingsVerified && report.externalAfter.readableBindingsVerified, copied: false}, childLogFiles: logFiles.length, childLoadRows: loadRows, uniqueModules: [...loaded].map(([path, sha256]) => ({path, sha256})), parentLoads: report.loads, extraTools: bindings.additionalTools, systemBoundary: report.externalBefore.systemBoundary, qualification: 'Static validation of actual captured load identities and complete physical dependency namespace. .bin links are exact declared generated wrappers, not undeclared omissions. No complete syscall/process-image or full OS attestation.'});

const original = join(work, 'original'), packs = paths(join(original, '.git/objects')).filter(path => path.endsWith('.pack'));
assert.equal(packs.length, 1); const opaque = await identity(join(original, '.git/objects', packs[0]));
const transmitted = report.children.find(row => row.opaqueStream)?.opaqueStream; assert.deepEqual(opaque, transmitted);
assert.equal(readFileSync(join(original, '.git/HEAD'), 'utf8').trim(), bindings.candidate);
assert.equal(existsSync(join(original, '.git/objects/info/alternates')), false); assert.equal(existsSync(join(source, '.git/objects/info/alternates')), false);
const allPaths = paths(work); const instructionPaths = allPaths.filter(path => path.split('/').at(-1).toLowerCase() === 'agents.md'); assert.deepEqual(instructionPaths, []);
const workDigest = createHash('sha256'); let totalBytes = 0, regularFiles = 0; const links = [];
for (const path of allPaths) {
  const absolute = join(work, path), stat = lstatSync(absolute);
  if (stat.isDirectory()) continue;
  if (stat.isSymbolicLink()) { links.push({path, target: readlinkSync(absolute)}); continue; }
  assert.ok(stat.isFile()); const row = await identity(absolute); totalBytes += row.bytes; regularFiles++; workDigest.update(JSON.stringify({path, mode: stat.mode & 0o777, ...row}) + '\n');
}
assert.ok(totalBytes < plan.limits.temporaryBytes);
const observer = read('raw-followup/OBSERVER.json'), probe = read('raw-followup/OBSERVER-PROBE.json'); assert.equal(probe.controls.length, 13); assert.ok(probe.controls.every(row => row.status === 'PASS'));
const slice = read('raw-followup/SLICE.json'), duplicate = read('raw-followup/P06-real-duplicate-build.json').evidence;
const recorded = [...slice.phases.flatMap(row => row.observed), ...duplicate.result.observed, ...observer.observed.groups, observer.observed.root, observer.before];
const unique = [...new Map(recorded.map(row => [`${row.pid}:${row.born}`, row])).values()];
const ps = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart=,command='], {encoding: 'utf8', timeout: 2000, maxBuffer: 8 * 1024 * 1024}).split('\n').filter(Boolean).map(line => { const parts = line.trim().split(/\s+/u); return {pid: Number(parts[0]), parent: Number(parts[1]), group: Number(parts[2]), born: parts.slice(3, 8).join(' '), command: parts.slice(8).join(' ')}; });
const survivors = ps.filter(row => unique.some(known => known.pid === row.pid && known.born === row.born)); assert.deepEqual(survivors, []);
const unknownAlive = ps.filter(row => row.command.includes(work) && !row.command.includes('projection-v7/seal.mjs')); assert.deepEqual(unknownAlive, []);
for (const row of preinspection.prior) assert.equal((await identity(join(repository, row.path))).sha256, row.sha256, row.path);
const frozenFiles = metadata(['ls-files', '-z', scope]).toString().split('\0').filter(Boolean); for (const path of frozenFiles) assert.equal(sha(readFileSync(join(repository, path))), sha(metadata(['show', `HEAD:${path}`])), path);
write('CLEANUP.json', {checkedAt: new Date().toISOString(), recordedIdentities: unique, matchingSurvivors: survivors, otherProcessesUsingOwnedTemp: unknownAlive, childLifecycle: report.children, sentinelCleanup: report.foreignCleanup, work: {root: work, regularFiles, regularBytes: totalBytes, links, contentManifestSha256: workDigest.digest('hex'), instructionPaths, opaqueGitPack: opaque, originalStore: 'Separate isolated original/ Git object store used for archive and extraction. Typing source .git is an exact candidate metadata index, not a second history copy; no alternates/live object fallback.'}, priorFilesUnchanged: preinspection.prior.length, priorHashes: preinspection.prior, instructionWriteInterceptions: report.writes.instructionAttempts, qualifiedCleanup: 'Natural positive phase/transport closure; expected negative transports can kill their own failed Git groups. Foreign sentinel explicitly stopped after survival proof. No unrelated real user group signalled.'});
rmSync(work, {recursive: true}); assert.equal(existsSync(work), false);
for (const name of [...Object.keys(bindings.runtimeFiles), 'DRIVER.json']) assert.equal(existsSync(join(owned, name)), false);

const rawIndex = []; let rawBytes = 0;
for (const path of paths(join(owned, 'raw-followup')).filter(path => lstatSync(join(owned, 'raw-followup', path)).isFile())) {
  const originalPath = join(owned, 'raw-followup', path), original = await identity(originalPath); rawBytes += original.bytes;
  const row = {path: 'raw-followup/' + path, ...original};
  if (original.bytes > 1024 * 1024) {
    assert.equal(metadata(['ls-files', '--', relative(repository, originalPath)]).length, 0);
    const target = originalPath + '.gz'; await pipeline(createReadStream(originalPath, {highWaterMark: 65536}), createGzip({level: 9, chunkSize: 65536}), createWriteStream(target, {flags: 'wx'}));
    const decoded = createHash('sha256'); let bytes = 0; for await (const chunk of createReadStream(target).pipe(createGunzip())) { decoded.update(chunk); bytes += chunk.length; } assert.equal(bytes, original.bytes); assert.equal(decoded.digest('hex'), original.sha256);
    row.storedPath = 'raw-followup/' + path + '.gz'; row.encoding = 'lossless-gzip-text'; row.stored = await identity(target); rmSync(originalPath);
  } else row.storedPath = row.path;
  rawIndex.push(row);
}
assert.ok(rawBytes < plan.limits.rawEvidenceBytes); write('RAW-INDEX.json', {rawOriginalBytes: rawBytes, files: rawIndex, method: 'Only new raw metadata/trace files are losslessly gzip-streamed with roundtrip hash verification. No tar, instruction payload, Git pack or compiler copied to evidence.'});
const byId = id => report.controls.find(row => row.id === id);
const matrix = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08'].map(id => ({id, status: 'SCOPED_PASS', records: report.controls.filter(row => row.id.startsWith(id)).map(row => ({id: row.id, status: row.status, startedAt: row.startedAt, finishedAt: row.finishedAt}))}));
write('RESULTS.json', {schema: 'unified76-projection-v7-independent-results', source: bindings.source, evidence: bindings.evidence, candidate: bindings.candidate, startedAt: report.startedAt, finishedAt: report.finishedAt, matrix, topLevelRecords: report.controls.length, authorPassesCounted: 0, initialSetupFailure: {command: initial.command, exitStatus: 1, controls: 0, copies: 0, builds: 0, reason: initial.fatal, preserved: true}, correctedCommand: {command: report.command, exitStatus: 0, freeze: 'cf4ac115', hiddenRetries: 0}, projection: byId('P01-complete-projection-and-archive').evidence, opaqueHistory: byId('P04-original-reachable-objects').evidence, dependencyProjection: report.dependencies, typing: {status: typing.status, productionBuilds: typing.builds, phases: typing.phases.map(({label, status}) => ({label, status})), maintained: typing.consumers.groups, source: typing.sourceConsumers.groups, negative: typing.consumers.negativeTypes, runtimeExecutions: typing.runtimeExecutions, declarations: typing.candidateBinding.declarations.length, metadataSha256: typing.candidateBinding.metadataSha256, emittedFiles: emit.files.length, emittedReceiptSha256: sha(JSON.stringify(emit)), actualPositiveAudit: byId('P06-shared-A10-positive').evidence.buildAudit}, duplicate: {actualCompilerStatus: duplicate.result.status, events: duplicate.events, refusal: duplicate.denied, meaning: 'Second real production compiler finishes0; actual default audit throws, caught by negative control. Not a CLI78 claim.'}, observer: {subcontrols: probe.controls.map(({id, status}) => ({id, status})), groups: observer.observed.groups, foreignBefore: observer.before, foreignAfter: observer.after, outerStatus: observer.result, instructionWrites: report.writes.instructionAttempts}, bounds: {plan: plan.limits, actualDriver: {phasePositiveOutputBytes: 268435456, setupStderrBytes: 1048576, setupTimeoutMs: 600000, historyTransferBytes: 8589934592, chunkBytes: 65536}, reviewEnforcement: {phaseTimeoutMs: 360000, duplicateOutputBytes: 67108864, opaqueStreamBytes: 4294967296, archiveStreamBytes: 4294967296, workBytes: 8589934592, rawBytes: 268435456, observerEachOutputBytes: 1048576, observerMs: 60000, diskSamplingMs: 10000}, measured: {peakWorkBytes: report.peakWorkBytes, peakRawBytes: report.peakRawBytes, finalRawBytes: rawBytes}, qualification: 'The plan64MiB child cap is passed to duplicate supervise, not configurable in frozen positive phaseRunner, whose actual256MiB cap remains. Positive captured output stayed below64MiB. Both are finite; no universal64MiB, hard-RSS/kernel-deadline/fullOS claim. Whole40min watchdog begins after bounded external setup.'}, limitations: ['No fullgate/valid --run/native semantics/private engine/runtime consumer suite/new package.', 'Literal physical AGENTS-presence negative not materialized; safe metadata negatives and actual benign-extra physical rejection are separate.', 'Archive digest negatives use an independent static predicate on two actual full archive streams; frozen extraction API consumes verified Git blobs, not an archive hash argument.', 'Complete original history remains a separate isolated store during review; full runner places history in its source .git. That final full14phase composition is unexecuted.', 'Fresh final launch must recheck runtime/tool/native/dependency/support/permission/loader/private prerequisites under new root release.'], sevenNew76Proofs: [{id: 'binding-complete', status: 'HOLD_NEW_ROOT_RELEASE_AND_FULLGATE_UNEXECUTED'}, {id: 'binding-pending-template', status: 'NEW_BOUNDED_API_REFUSAL'}, {id: 'binding-mutable-head', status: 'PRIOR_BOUNDED_REFUSAL_NOT_RERUN'}, {id: 'binding-missing-asset', status: 'PRIOR_BOUNDED_REFUSAL_NOT_RERUN'}, {id: 'binding-missing-classification', status: 'PRIOR_BOUNDED_REFUSAL_NOT_RERUN'}, {id: 'binding-missing-cleanup-manifest', status: 'PRIOR_BOUNDED_REFUSAL_NOT_RERUN'}, {id: 'binding-skipped-case', status: 'PRIOR_BOUNDED_REFUSAL_NOT_RERUN'}], publicPrerequisites: 'HTML/DU/Expr accepted by root8dd78d7d, not pending; old source release not transferred', original22Ledger: 'Unchanged21 inherited+1 scoped5c32 history; not rerun here', stoppedFullGateHistory: 'a9ec3561/31d354e8 remains0/14 before materialization; no rescore', package: {sha256: bindings.expectedPackageSha256, freshPack: false, lineage: 'Same f5/base44/source tree and exact832 emit receipt; prior independent c109 pack proof carried only as history'}, scopedDriverAcceptance: 'QUALIFIED_PROJECTION_SHARED_A10_OUTER_OBSERVER', rootRelease: 'HOLD_NEW_AUTHORIZATION_ABSENT', fullGateLaunched: false, cleanup: {temporaryRemoved: !existsSync(work), stagedDriverRemoved: true, prior220Unchanged: true, recordedSurvivors: 0}});
console.log(JSON.stringify({groups: 8, resultRecords: 9, status: 'SCOPED_PASS', priorPreserved: preinspection.prior.length, temporaryRemoved: true, instructionWrites: 0, rootRelease: 'HOLD'}));
