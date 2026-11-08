import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = process.cwd();
assert.equal(repository, '/Users/kjopek/Workspace/safe-bash');
const previous = join(directory, '../released-run-v3-qualified-h11');
const launcher = join(directory, '../launcher-v3');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const packedJson = path => JSON.parse(gunzipSync(Buffer.from(readFileSync(path, 'utf8'), 'base64')));
const seal = json(join(previous, 'RESULT-SEAL.json'));
const evidence = json(join(previous, 'EVIDENCE.json'));
const summary = json(join(previous, 'SUMMARY.json'));
const tap = json(join(previous, 'TAP-NONPASSING.json'));
const report = json(join(evidence.rawRoots.inner, 'REPORT.json'));
const source = join(report.temporary, 'source');
const profile = packedJson(join(launcher, 'PROFILE.json.gz.base64'));
const external = packedJson(join(launcher, 'EXTERNAL.json.gz.base64'));
assert.equal(report.candidate, 'f5e9fc49b6abb38e180cc9de16c95fced102ff75');
assert.equal(profile.candidate, report.candidate);
assert.equal(seal.candidate, report.candidate);
assert.deepEqual(tap.counts, { pass: 19425, fail: 132, skipped: 7, todo: 0, cancelled: 0 });
for (const entry of seal.files) assert.equal(sha(readFileSync(join(repository, entry.path))), entry.sha256, entry.path);
for (const entry of evidence.artifacts) {
  const encoded = readFileSync(join(repository, entry.artifact));
  assert.equal(sha(encoded), entry.encodedSha256, entry.artifact);
  const compressed = Buffer.from(encoded.toString(), 'base64');
  assert.equal(sha(compressed), entry.compressedSha256);
  const original = readFileSync(join(evidence.rawRoots[entry.role], entry.path));
  assert.equal(original.length, entry.rawBytes);
  assert.equal(sha(original), entry.sha256, entry.path);
  assert.equal(sha(gunzipSync(compressed)), entry.sha256);
}

const groups = [
  ['G01', 4, 'native-route', 'diff-patch fixtures / gate tool-route owner', 'Explicit /usr/bin/git spawn returns EPERM before the requested native operation.', 'The path is an explicitly denied selector in TOOL-ROUTES.json; syscall-level denial origin is not traced. Do not claim virtual diff/patch failed.'],
  ['G02', 68, 'native-scratch-authority', 'diff-patch fixture owner', 'Pinned GNU patch reports inability to create /tmp/pp* temporary files, status 2.', 'Native prerequisites/effect comparators fail. Some virtual invocations executed, but this failure does not establish a semantic defect against a valid live oracle.'],
  ['G03', 5, 'native-calibration-authority', 'diff-patch fixture owner', 'Apple patch --version identity probe reports /tmp/patcho* creation denied, before the reverse-corruption replay.', 'These are Apple alternate calibration cases, not five GNU product failures. The later replay already sets TMPDIR; the earlier identity probe does not.'],
  ['G04', 6, 'unresolved-structural-signal-boundary', 'expr / regex-execution / contracts owners', 'RegexSession constructor rejects the test StructuralSignal at AbortSignal.any before the intended third Budget.yield cancellation checkpoint.', 'Verified direct-handler input rejection, not yet a verified ordinary Shell/native-AbortSignal defect or authorized fixture migration. Public structural-vs-branded signal contract requires adjudication.'],
  ['G05', 2, 'native-fixture-precondition', 'metadata fixture owner', 'qualifyModeFixtures.setMode cannot establish the initial directory mode.', 'Wrapped cause is absent from TAP. Do not infer errno or generalize the two historical file 2755/6755 observations to directory/Node operations.'],
  ['G06', 1, 'unresolved-host-mode-differential', 'metadata / Real filesystem owners', '384-transition comparator records directory setid status/mode differences (native status 1 versus virtual status 0).', 'The test preserves its mismatch list. Native stderr/cause is not in this assertion; host permission/profile mismatch is plausible, not a proven product fix or NA-2755/6755 waiver.'],
  ['G07', 2, 'frozen-runtime-profile', 'metadata characterization owner / gate profile owner', 'Node22.22.2-only Darwin characterization rejects the actual Node24.11.1 runtime.', 'Do not edit the original Node22 capture or call Node24 equivalent. A new qualified profile/control is separate work.'],
  ['G08', 5, 'native-pipeline-path', 'search fixture / gate route owners', 'Native Bash cannot find cut/sort/tee/xargs/cat on its inherited finite PATH.', 'Native reference commands did not execute correctly. No virtual rg failure is established by the exit/output comparison.'],
  ['G09', 2, 'fixture-reporter-protocol', 'search fixture owner', 'Nested Node24 test runs print non-TAP summaries while wrappers require # pass N.', 'Captured children report 10/10 and 6/6; original two wrapper failures remain failures. Explicit TAP is a prospective fixture correction, not a rescore.'],
  ['G10', 1, 'native-scratch-authority', 'stream-inspection oracle fixture owner', 'Live tac rows report /var/tmp/cutmp* creation denied; exact observation-array comparison fails.', 'The explicit child environment omits TMPDIR. Frozen native-vector product tests are separate; no native-success credit here.'],
  ['G11', 1, 'unresolved-host-socket-setup', 'Real filesystem fixture / gate namespace owners', 'server.listen rejects EINVAL on the 110-byte retained socket pathname before filesystem assertions.', 'Long pathname is a concrete suspect, not a proven kernel cause. No new socket/native probe is authorized.'],
  ['G12', 1, 'native-route', 'S3 HTTP public-consumer fixture owner / gate route owner', 'Nested packed verifier resets PATH and bare git rev-parse returns EPERM at source-revision resolution.', 'The failed test does not run its build/package/export assertions; do not classify it as S3 HTTP behavior failure.'],
  ['G13', 1, 'fixture-command-route', 'root native-data fixture / gate route owner', 'Script-positional smoke cannot spawn bare npm (ENOENT).', 'The later TAP assertion is not reached. The outer driver uses an admitted explicit npm CLI; this child uses a missing bare alias.'],
  ['G14', 1, 'stale-supported-shebang-expectation', 'script-entrypoint fixture owner', 'Old strict-header loop expects status126 but selected runtime accepts env -S bash and returns0.', 'Source locates the last header as the supported case; raw loop assertion does not label the header. Preserve the original failure and validate any narrowly proposed migration independently.'],
  ['G15', 32, 'native-temp-effect-fixture', 'shell native-reference fixture owner', 'Native runBash returns an additional sh-thd-* file in its snapshotted cwd for expansion failures.', 'The helper sets TMPDIR equal to the observed cwd. Expected/native file assertion runs first; later virtual effect assertions are unreached. Why native Bash retains the file is not established by these captures.'],
].map(([id, expectedFailures, category, route, observed, qualification]) => ({ id, expectedFailures, category, route, observed, qualification }));
const descriptions = new Map(groups.map(group => [group.id, group]));
function classify(row, path) {
  const detail = row.detail;
  if (path.includes('/diff-patch-stress/editflows/')) { assert.match(detail, /spawnSync \/usr\/bin\/git EPERM/u); return 'G01'; }
  if (path.includes('/diff-patch-stress/gnu-target/calibration')) { assert.match(detail, /can.t create \/tmp\/patcho/u); return 'G03'; }
  if (path.includes('/diff-patch-stress/')) { assert.match(detail, /Can.t create temporary file \/tmp\/pp/u); return 'G02'; }
  if (path.includes('/expr/inactive-prefix')) { assert.match(detail, /signals\[0\].*instance of AbortSignal.*StructuralSignal/u); return 'G04'; }
  if (path.includes('/metadata-stress/permission-profile/darwin-profile')) { assert.match(detail, /exact Node version required/u); return 'G07'; }
  if (path.includes('/metadata-stress/native-differential')) { assert.match(detail, /actualMode: '6051'/u); return 'G06'; }
  if (path.includes('/metadata-stress/')) { assert.match(detail, /cannot establish initial mode for directory/u); return 'G05'; }
  if (path.includes('/search-stress/pipelines')) { assert.match(detail, /command not found/u); return 'G08'; }
  if (path.includes('/search-stress/')) { assert.match(detail, /ℹ fail 0/u); assert.match(detail, /# pass (?:10|6)/u); return 'G09'; }
  if (path.includes('/stream-inspection/')) { assert.match(detail, /7461633a206661696c656420746f20637265617465/u); return 'G10'; }
  if (path.includes('/fs/real/')) { assert.match(detail, /listen EINVAL/u); return 'G11'; }
  if (path.includes('/s3-http-exports/')) { assert.match(detail, /spawnSync git EPERM/u); return 'G12'; }
  if (path.includes('/qualified-current-release-native-data/')) { assert.match(detail, /spawnSync npm ENOENT/u); return 'G13'; }
  if (path.includes('/script-entrypoint/')) { assert.match(detail, /0 !== 126/u); return 'G14'; }
  if (path.endsWith('/heredoc.test.ts') || path.endsWith('/inline-input-fatal-scope.test.ts')) { assert.match(detail, /sh-thd-\d+/u); return 'G15'; }
  throw new Error('Unclassified failure: ' + row.id);
}
const sourcePaths = new Set();
const failures = tap.groups.filter(group => group.status === 'fail').flatMap(group => group.cases.map(row => {
  const groupId = classify(row, group.path);
  sourcePaths.add(group.path);
  const stackPaths = [...row.detail.matchAll(/\/source\/([^\s():]+\.(?:ts|mjs)):(\d+):(\d+)/gu)].map(match => ({ path: match[1], line: Number(match[2]), column: Number(match[3]) }));
  for (const entry of stackPaths) sourcePaths.add(entry.path);
  const errorStart = row.detail.indexOf('  error:');
  const errorEnd = row.detail.indexOf('  code:', errorStart);
  return { id: row.id, phase: 'canonical', status: row.status, tapLine: row.line, ordinal: row.ordinal,
    name: row.name, sourcePath: group.path, originalLocation: row.location, stackPaths,
    group: groupId, category: descriptions.get(groupId).category, route: descriptions.get(groupId).route,
    originalDetailSha256: sha(Buffer.from(row.detail)), observedExcerpt: row.detail.slice(errorStart, errorEnd > errorStart ? errorEnd : undefined).slice(0,900),
    productDefectEstablishedByThisDiagnosis: false };
}));
assert.equal(failures.length, 132);
assert.equal(new Set(failures.map(row => row.id)).size, 132);
for (const group of groups) assert.equal(failures.filter(row => row.group === group.id).length, group.expectedFailures, group.id);
const skipRules = [
  [/Python standard-library/u, 'tests/commands/bytes-stress/encoding.test.ts', 'nativePrograms.python false after PATH-only python3 access discovery; no native/virtual body execution.'],
  [/xxd tiny-width/u, 'tests/commands/bytes-stress/encoding.test.ts', 'nativePrograms.xxd false after PATH-only xxd access discovery; no native/virtual body execution.'],
  [/^cksum:/u, 'tests/commands/bytes/checksums/native.test.ts', 'discover(cksum) exhausted declared candidates with ENOENT; the skip string is not proof that this machine has no cksum.'],
  [/native Vim xxd:/u, 'tests/commands/bytes/encoding/oracle.test.ts', 'bare xxd -v returned an error; the fixture skips on any error, not only ENOENT. Raw reason does not establish system-wide absence.'],
  [/optional GNU replay/u, 'tests/commands/grep-aliases/native.test.ts', 'GREP_ALIASES_GNU_NATIVE not 1; GNU capture/profile availability additionally guarded inside the body. No new replay.'],
  [/optional BSD replay/u, 'tests/commands/grep-aliases/native.test.ts', 'GREP_ALIASES_NATIVE not 1; opt-in pinned BSD replay not run.'],
];
const skips = tap.groups.filter(group => group.status === 'skipped').flatMap(group => group.cases.map(row => {
  const rule = skipRules.find(([pattern]) => pattern.test(row.name)); assert.ok(rule, row.name); sourcePaths.add(rule[1]);
  return { id: row.id, phase: 'canonical', status: 'skipped', tapLine: row.line, name: row.name,
    originalReason: row.reason, sourcePath: rule[1], classification: 'oracle-unexecuted', condition: rule[2],
    originalDetailSha256: sha(Buffer.from(row.detail)), noPassCredit: true };
}));
assert.equal(skips.length, 7);
for (const path of [
  'tests/commands/table-text-stress/support.ts', 'tests/commands/table-text-stress/corpus.test.ts',
  'tests/commands/table-text-stress/frozen-corpus.json', 'tests/commands/table-text-stress/shared-stdin-fix/support.ts',
  'tests/commands/table-text-stress/shared-stdin-fix/acceptance216.test.ts',
  'tests/fs/mount/identity-authority-review/implementation/public-comparison.test.ts',
  'tests/commands/diff-patch-stress/gnu-target/oracle.ts', 'tests/commands/diff-patch-stress/gnu-auxiliary/helpers.ts',
  'tests/commands/diff-patch-stress/gnu-target-followup/helpers.ts',
  'tests/commands/metadata-stress/permission-profile/fixtures.ts',
  'tests/commands/search-stress/harness.ts', 'tests/commands/bytes-stress/helpers.ts',
  'tests/commands/stream-inspection/oracle.ts', 'tests/shell-stress/helpers.ts',
  'src/commands/expr/index.ts', 'src/commands/regex-execution/client.ts', 'src/contracts/command.ts', 'src/contracts/command.md',
  'src/shell/runtime.ts', 'benchmarks/package.json', 'benchmarks/package-lock.json', 'benchmarks/tsconfig.json',
  'package.json', 'package-lock.json',
]) sourcePaths.add(path);
const sourceBindings = [...sourcePaths].sort().map(path => {
  assert.ok(!path.split('/').includes('AGENTS.md'));
  const bytes = readFileSync(join(source,path));
  const archive = report.archive.files[path]; assert.ok(archive, path);
  const blob = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  assert.equal(blob, archive.blob, path); assert.equal(sha(bytes), archive.sha256, path);
  assert.equal(profile.scopeInputs.find(entry => entry.path === path)?.blob, blob, path);
  assert.equal(lstatSync(join(source,path)).mode & 0o777, archive.mode, path);
  return { path, bytes: bytes.length, mode: archive.mode, gitBlob: blob, sha256: sha(bytes) };
});
const added = summary.integrityHalt.paths.map(path => {
  assert.equal(report.afterAuthorizedSetup.entries.some(entry => entry.path === path), false, path);
  const absolute = join(source,path), stat = lstatSync(absolute);
  assert.equal(stat.isSymbolicLink(), false, path);
  return { path, kind: stat.isDirectory() ? 'directory' : 'file', mode: stat.mode & 0o777,
    ...(stat.isDirectory() ? { children: readdirSync(absolute).sort() } : { bytes: stat.size, sha256: sha(readFileSync(absolute)) }) };
});
assert.equal(added.length,286);
const roots = added.filter(entry => /^tests\/commands\/table-text-stress\/\.native-[^/]+$/u.test(entry.path));
assert.equal(roots.length,71);
const corpus = json(join(source,'tests/commands/table-text-stress/frozen-corpus.json'));
assert.equal(corpus.length,71);
const nativeRoots = roots.map(entry => {
  assert.deepEqual(entry.children,['left','right','sentinel']);
  assert.equal(readFileSync(join(source,entry.path,'sentinel'),'utf8'),'independent-table-text-owned');
  const files = Object.fromEntries(['left','right'].map(name => [name, readFileSync(join(source,entry.path,name)).toString('hex')]));
  const compatibleRows = corpus.flatMap((row,index) => JSON.stringify(row.fixture.files) === JSON.stringify(files) ? [{ index, name: row.fixture.name }] : []);
  return { path: entry.path, compatibleInputRows: compatibleRows, qualification: 'Input matches are not invocation-order telemetry; repeated input pairs need not identify a unique case.' };
});
for (const path of summary.integrityHalt.otherAdded) assert.deepEqual(readdirSync(join(source,path)),[],path);
const mainCompiler = external.directories.main.entries.find(entry => entry.path === 'typescript/bin/tsc');
assert.ok(mainCompiler);
assert.equal(external.directories.benchmarks.entries.some(entry => entry.path === 'typescript' || entry.path.startsWith('typescript/')),false);
assert.equal(existsSync(join(source,'benchmarks/node_modules/typescript')),false);
assert.equal(sha(readFileSync(join(source,'node_modules/typescript/bin/tsc'))),mainCompiler.sha256);
const observations = {
  schema:1, recordedAt:new Date().toISOString(), mode:'read-only-source-and-captured-data-analysis',
  candidate:report.candidate, driverSha256:report.driverSha256, profileSha256:report.profileSha256,
  previousEvidenceCommit:'c23a8de855f4f51423ee21c35ef5bbcc4d2d56a5',
  oldResultSealSha256:sha(readFileSync(join(previous,'RESULT-SEAL.json'))),
  rawFilesAuthenticated:evidence.artifacts.length, rawBytes:evidence.rawBytes,
  canonicalRawUnchanged:tap.counts, phasesExecuted:report.phases.length, phasesDeclared:14,
  newProductTestNativeBuildPrivateExecutions:0, newPassCredit:0,
  sourceBindings, addedEntries:added, nativeRoots,
  retainedRoot:source, retainedRootsNotChangedOrRemoved:true,
  scratchAttribution:{ tableNative:{ roots:71, entries:284, caller:'tests/commands/table-text-stress/corpus.test.ts:27', creator:'tests/commands/table-text-stress/support.ts:52', disposal:'none in native(); snapshot/manual review cleanup is not canonical cleanup' },
    tableRuntime:{ entries:1, creator:'tests/commands/table-text-stress/shared-stdin-fix/support.ts:49', disposal:'child native-* removed in finally; .runtime parent remains' },
    mountRuns:{ entries:1, creator:'tests/fs/mount/identity-authority-review/implementation/public-comparison.test.ts:38', disposal:'context.after removes mkdtemp child, not .runs parent' },
    timing:'Absent from post-setup baseline; observed after canonical. Native-71 corpus caller and fixture inputs agree with survivors. No syscall write/PID attribution trace; no retroactive clean sweep.' },
  benchmark:{ phaseStatus:1, checkerExecuted:false, requestedCompiler:report.phases.find(row=>row.label==='benchmark-types').args[0],
    observedError:'ENOENT in build-audit.mjs:8 while realpath-ing missing benchmark-local compiler',
    benchmarkTypeScriptEntries:0, mainCompiler, dependencyProjection:report.dependencyProjection,
    manifest:json(join(source,'benchmarks/package.json')),
    proposal:'Use the already authenticated source/node_modules/typescript/bin/tsc with benchmarks cwd and unchanged benchmark tsconfig. Preserve build audit; prove --noEmit does not count as a second production build. No execution or dependency staging performed.' },
  routeNames:report.toolRoutes.aliases.map(entry=>entry.name), nativeTopLevelEntries:readdirSync(join(report.temporary,'native')).sort(),
  hostSocketPathBytes:Buffer.byteLength('/private/tmp/unified76-os-write-9hZxpj/tmp/unified76-execution-FQM0aw/tmp/virtual-bash-real-ZN0iVJ/root/socket'),
  integrityCleanupStillUnqualified:true, historicalConsumedAttemptsUnchanged:true,
  qualifications:['No raw failure removed/reclassified as a pass. Category is attribution, not score.', 'No source execution/import or OS/native probe; no private reads or state refresh.', 'All downstream eight phases remain unexecuted. No new packed artifact or package success.'],
};
const payloads = { 'GROUPS.json':groups, 'FAILURES.json':failures, 'SKIPS.json':skips, 'OBSERVATIONS.json':observations };
for (const entry of seal.files) assert.equal(sha(readFileSync(join(repository,entry.path))),entry.sha256);
for (const entry of evidence.artifacts) assert.equal(sha(readFileSync(join(evidence.rawRoots[entry.role],entry.path))),entry.sha256);
let patch='*** Begin Patch\n';
for (const [name,value] of Object.entries(payloads)) {
  const path=join(directory,name); assert.equal(existsSync(path),false,path);
  const content=JSON.stringify(value,null,2)+'\n';
  patch+='*** Add File: '+relative(repository,path)+'\n'+content.trimEnd().split('\n').map(line=>'+'+line).join('\n')+'\n';
}
process.stdout.write(patch+'*** End Patch\n');
