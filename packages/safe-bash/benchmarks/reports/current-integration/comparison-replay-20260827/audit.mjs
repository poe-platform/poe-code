import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { cpus, loadavg, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = dirname(fileURLToPath(import.meta.url));
const read = async path => JSON.parse(await readFile(join(output, path)));
const write = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const { freeze, repo } = await read('location.json'), source = join(freeze, 'product');
const sourceManifest = await read('source-manifest.json'), sealed = await read('frozen-files.json'), profiles = await read('profiles.json');
const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
const engines = ['virtual-bash', 'just-bash'];
const fields = ['stdout', 'stderr', 'exitCode', 'entries'];
const different = (left, right) => fields.filter(field => JSON.stringify(left?.[field]) !== JSON.stringify(right?.[field]));
const historyPath = 'benchmarks/reports/expanded-20260827/corrected-bd2cacb/functional.json';
const historicalBytes = git('show', `8e09db9:${historyPath}`);
assert.equal(digest(await readFile(join(repo, historyPath))), digest(historicalBytes));
const historical = JSON.parse(historicalBytes);
const histories = { authorCommit: git('rev-parse', '8e09db9').toString().trim(), docsCommit: git('rev-parse', 'd484f98').toString().trim(), productCommit: git('rev-parse', 'bd2cacb').toString().trim(), harnessCommit: profiles.original.revision, functionalSha256: digest(historicalBytes), counts: Object.fromEntries(engines.map(engine => [engine, { pass: historical.filter(row => row[engine].status === 'pass').length, fail: historical.filter(row => row[engine].status !== 'pass').length }])) };
assert.deepEqual(histories.counts, { 'virtual-bash': { pass: 206, fail: 18 }, 'just-bash': { pass: 155, fail: 69 } });
const scores = {}, failures = [], allRows = {}, inputs = {}, reports = {};
for (const phase of ['original', 'scratch-aligned']) {
  const rows = await read(`${phase}/functional.json`), report = await read(`${phase}/report.json`), inventory = await read(`${phase}/inventory.json`), lifecycle = await read(`${phase}/lifecycle.json`), corpus = await read(`${phase}/case-inputs.json`);
  allRows[phase] = rows; inputs[phase] = corpus; reports[phase] = report;
  assert.equal(rows.length, 224); assert.equal(new Set(rows.map(row => row.id)).size, 224);
  assert.deepEqual(rows.map(row => row.id), corpus.map(row => row.id));
  assert.equal(lifecycle.gate, 'PASS'); assert.deepEqual(lifecycle.sourceIntegrity.mismatches, []);
  assert.equal(report.instrumentation.total, 24); assert.equal(report.instrumentation.pass, 24);
  assert.deepEqual(report.dispatch.missingUnshadowed, []);
  assert.ok(report.dispatch.curlCases.every(row => row.events.some(event => event.name === 'curl')));
  scores[phase] = { ...report.totals, lifecycle: lifecycle.gate, importWorkers: lifecycle.importAudit.workers.length, loadedModules: lifecycle.importAudit.uniqueModules, registeredDefault: inventory.virtual.registered.length, unshadowedRequired: inventory.virtual.unshadowedRegistry.length, unshadowedReached: report.dispatch.requiredUnshadowed.length, curlCases: report.dispatch.curlCases.length, bothPass: report.bothPass, bothNonPass: report.bothNonPass, instrumentation: report.instrumentation };
  for (const row of rows) for (const engine of engines) if (row[engine].status !== 'pass') {
    const result = row[engine], expectedBytes = Buffer.from(row.expected.stdout, 'base64'), actualBytes = Buffer.from(result.observation?.stdout ?? '', 'base64');
    let validUtf8 = true; try { new TextDecoder('utf-8', { fatal: true }).decode(expectedBytes); } catch { validUtf8 = false; }
    const boundaryPattern = !validUtf8 && Buffer.from(expectedBytes.toString('latin1'), 'utf8').equals(actualBytes);
    const missing = engine === 'just-bash' && row.group === 'command' && !inventory.baseline.union.includes(row.command);
    const ownType = engine === 'virtual-bash' && row.id === 'kernel/type/type';
    const scratch = engine === 'virtual-bash' && row.id === 'command/patch/dry-run';
    failures.push({ phase, id: row.id, engine, status: result.status, failedFields: result.comparison?.assertions.filter(assertion => !assertion.pass).map(assertion => assertion.field),
      ownerRoute: ownType ? 'Root -> shell/introspection owner (historical Sagan); preserve truthful registry classification, not false builtin labels' : scratch ? 'Root -> benchmark/fairness owner; original native scratch fixture mismatch, not an instruction to add product directory effects' : 'Root -> comparator/fairness owner; pinned just-bash upstream semantics/coverage triage',
      category: ownType ? 'Architectural introspection profile mismatch: command/command/function versus builtin/file/function' : scratch ? 'Documented original scratch profile defect retained as exact mismatch' : missing ? 'Baseline command absent from installed union' : boundaryPattern ? 'Returned byte API mismatch consistent with UTF8 re-encoding; NOT internal pipe/file corruption proof' : 'Exact native profile mismatch; no waiver or assumed cause',
      recipe: corpus.find(specimen => specimen.id === row.id), expected: row.expected, actual: result,
      diagnostics: { expectedStdoutUtf8: Buffer.from(row.expected.stdout, 'base64').toString('utf8'), expectedStderrUtf8: Buffer.from(row.expected.stderr, 'base64').toString('utf8'), actualStdoutUtf8: Buffer.from(result.observation?.stdout ?? '', 'base64').toString('utf8'), actualStderrUtf8: Buffer.from(result.observation?.stderr ?? '', 'base64').toString('utf8'), rawHarnessError: result.error ?? null },
    });
  }
}
assert.deepEqual(inputs.original, inputs['scratch-aligned']);
const goldOriginal = JSON.parse(await readFile(profiles.original.goldPath)), goldAligned = JSON.parse(await readFile(profiles['scratch-aligned'].goldPath));
assert.deepEqual(goldOriginal.recipes, goldAligned.recipes); assert.deepEqual(goldOriginal.performanceRecipes, goldAligned.performanceRecipes);
const goldenDelta = goldAligned.observations.flatMap(row => { const previous = goldOriginal.observations.find(other => other.id === row.id), changedFields = different(previous, row); return changedFields.length ? [{ id: row.id, changedFields, before: previous, after: row }] : []; });
assert.deepEqual(goldenDelta.map(row => ({ id: row.id, fields: row.changedFields })), [{ id: 'command/patch/dry-run', fields: ['entries'] }]);
const profileObservationDelta = [], profileScoreDelta = [], historicalDelta = [];
for (const row of allRows.original) {
  const aligned = allRows['scratch-aligned'].find(other => other.id === row.id), old = historical.find(other => other.id === row.id);
  for (const engine of engines) {
    const changedFields = different(row[engine].observation, aligned[engine].observation);
    if (changedFields.length) profileObservationDelta.push({ id: row.id, engine, changedFields, before: row[engine].observation, after: aligned[engine].observation });
    if (row[engine].status !== aligned[engine].status) profileScoreDelta.push({ id: row.id, engine, original: row[engine].status, aligned: aligned[engine].status });
    if (row[engine].status !== old[engine].status || different(row[engine].observation, old[engine].observation).length) historicalDelta.push({ id: row.id, engine, historicalStatus: old[engine].status, currentOriginalStatus: row[engine].status, changedFields: different(old[engine].observation, row[engine].observation) });
  }
}
assert.deepEqual(profileScoreDelta, [{ id: 'command/patch/dry-run', engine: 'virtual-bash', original: 'fail', aligned: 'pass' }]);
await write('failure-routes.json', failures);
await write('profile-delta.json', { goldenDelta, profileObservationDelta, profileScoreDelta, profileHashes: Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [name, profile.hashes])), recipesEqual: true, statusAndStdoutAndStderrGoldensEqual: true });
await write('historical-delta.json', { histories, delta: historicalDelta, caveat: 'Historical 206/18 versus 155/69 stays immutable. Current freeze is dirty c2902a6, not retroactive score attribution to later fixes or a passing full product gate.' });
const dirtySource = [];
for (const [path, entry] of Object.entries(sourceManifest.paths)) if (entry.tracked) {
  const headBytes = git('show', `${sourceManifest.head}:${path}`);
  if (digest(headBytes) !== entry.sha256) dirtySource.push({ path, headSha256: digest(headBytes), frozenSha256: entry.sha256 });
}
const liveDelta = [];
for (const [path, entry] of Object.entries(sourceManifest.paths)) {
  let current;
  try { current = digest(await readFile(join(repo, path))); } catch (error) { current = `unavailable:${error.code}`; }
  if (current !== entry.sha256) liveDelta.push({ path, frozenSha256: entry.sha256, liveSha256: current });
}
const mismatches = [];
for (const [path, entry] of Object.entries(sealed)) {
  const info = await lstat(join(source, path));
  if (!info.isFile() || digest(await readFile(join(source, path))) !== entry.sha256 || (info.mode & 0o222)) mismatches.push(path);
}
assert.deepEqual(mismatches, []);
const historicalGoldens = {};
for (const profile of Object.values(profiles)) for (const [path, expected] of Object.entries(profile.hashes)) if (path.includes('/native')) {
  if (!path.endsWith('/native.json')) continue;
  assert.equal(digest(await readFile(join(repo, path))), expected); historicalGoldens[path] = expected;
}
const toolVersions = Object.fromEntries(Object.entries(profiles.original.oracle.toolIdentities).map(([name, identity]) => [name, { ...identity, availability: 'Historical capture provenance only; no current native executable invoked or recapture performed in this replay' }]));
await write('oracle-identities.json', { toolVersions, originalGoldSha256: digest(await readFile(profiles.original.goldPath)), alignedGoldSha256: digest(await readFile(profiles['scratch-aligned'].goldPath)), historicalGoldens });
await write('live-after.json', { at: new Date().toISOString(), head: git('rev-parse', 'HEAD').toString().trim(), status: git('status', '--porcelain=v1').toString(), changedComparedWithFreeze: liveDelta, notCreditedToReplay: true });
await write('final-integrity.json', { at: new Date().toISOString(), files: Object.keys(sealed).length, mismatches, allRegularReadOnly: true, frozenFilesManifestSha256: digest(await readFile(join(output, 'frozen-files.json'))), originalAndAlignedBeforeAfterSame: true });
const archive = join(output, 'source-harness-goldens.tar.gz');
execFileSync('/usr/bin/tar', ['-czf', archive, '-C', source, 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'profiles', 'audit', 'benchmarks/package.json', 'benchmarks/package-lock.json'], { env: { PATH: '/usr/bin:/bin', HOME: join(freeze, 'home'), TMPDIR: join(freeze, 'tmp'), LC_ALL: 'C' } });
const summary = { createdAt: new Date().toISOString(), freeze, sourceHead: sourceManifest.head, dirtySource, untrackedSource: Object.entries(sourceManifest.paths).filter(([, entry]) => !entry.tracked).map(([path]) => path), sourceManifestDigest: sourceManifest.sourceTreeSha256, sourceManifestFileSha256: digest(await readFile(join(output, 'source-manifest.json'))), sourceFiles: Object.keys(sourceManifest.paths).length, frozenFiles: Object.keys(sealed).length,
  scores, histories, preservedSetupFailure: 'prepare-attempt-1.json', functionalRuns: { original: 1, 'scratch-aligned': 1 }, rawObservationRows: 448, engineObservations: 896, functionalRetries: 0, performanceRuns: 0,
  controlResults: { harness: '15/15', neutralityPerProfile: '24/24', transportPerProfile: '8/9; intentional observed baseline invalid-UTF8 terminal API mismatch retained, internal pipe and file controls pass' },
  profileScoreDelta, actualProfileObservationDeltaCount: profileObservationDelta.length, historicalDelta,
  sourceArchive: { path: archive, sha256: digest(await readFile(archive)), includesDependencies: false, dependencyCopiesRetained: join(source, 'node_modules') + ' and ' + join(source, 'benchmarks/node_modules') },
  runtime: { node: process.version, platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0]?.model, auditTimeLoadOnlyNotBenchmarkControl: loadavg() },
  caveats: ['Exact 224-case native profile comparison, not full-product parity, backend interoperability, performance or superiority evidence.', 'Source current at freeze only; dirty tracked SafeJS public adapter files included alongside parser/runtime, but SafeJS plugin/tests/private runtime never invoked. Untracked stream-inspection files copied but not registered or credited by this 56-default aggregate.', 'Native provenance is GNU Bash5.3/coreutils9.7 on Darwin plus mixed individually hashed utilities, not uniformly GNU/Linux.', 'Do not relabel registered commands as builtins to satisfy the type profile. Original patch scratch directory mismatch stays a failure; corrected profile delta is separately sealed.', 'Read-only copied dependencies verified by per-file hashes, installed versions and lock/hidden-lock metadata; no registry tarball redownload, no fresh supply-chain certification.', 'ESM loader load URLs and disk hashes cover actually loaded modules; process group plus child event logs cover observed child lifecycle. This is not an OS-wide sandbox/network confinement proof.', 'Native executable availability not needed for committed byte-exact gold replay; no native oracle was recaptured.', 'Performance not run. Existing expanded CLI automatically repeats functional224 and performance matrix; sort-review hardcodes old derived sources. A separately approved bounded adapter could reuse existing performance recipes once, but no such run is claimed.', 'Baseline-only union fairness and primary manifest assessment belong to the other leaf; independent final reviewer should inspect artifacts without rerunning224.'] };
await write('summary.json', summary);
const routeLines = ['# Exact nonpass routing', '', 'Every listed nonpass remains in its profile denominator. Raw expected/actual byte fields, stdout/stderr text views, scripts and filesystem entries are in failure-routes.json; complete both-engine rows are in each functional.json.', '', '| Profile | Case ID | Engine | Fields | Route/category |', '|---|---|---|---|---|'];
for (const failure of failures) routeLines.push(`| ${failure.phase} | ${failure.id.replaceAll('|', '\\|')} | ${failure.engine} | ${failure.failedFields?.join(', ') ?? failure.status} | ${failure.category} |`);
await writeFile(join(output, 'FAILURE_ROUTES.md'), routeLines.join('\n') + '\n', { flag: 'wx' });
await copyFile('/tmp/safe-bash-comparison-replay-plan.txt', join(output, 'EARLY_PLAN.txt'));
const detail = `Independent comparison replay complete, awaiting root/final review; no staging or commits.\nEvidence: ${output}\nFreeze: ${freeze}\nHEAD at freeze: ${sourceManifest.head} DIRTY; source digest ${sourceManifest.sourceTreeSha256}.\nDirty tracked source: ${dirtySource.map(row => row.path).join(', ')}. Seven untracked stream-inspection files included.\nOriginal224 ONCE: virtual-bash 222 pass/2 fail; baseline155/69.\nScratch-aligned d1b10a3 ONCE SAME SOURCE: virtual-bash223/1; baseline155/69.\nOriginal nonpasses: command/patch/dry-run (only native original extra empty tmp entry; benchmark/fairness route), kernel/type/type (command/command/function vs builtin/file/function; shell/introspection route, no false builtin labels).\nAligned nonpass: kernel/type/type only. All 69 baseline failures preserved per profile with exact IDs, fields, raw outputs and VFS effects in failure-routes.json and functional.json.\nBoth lifecycle gates PASS, 26 workers/profile all loaded exactly one frozen product/baseline entry; 310 unique modules/profile, no outside imports or hash mismatch; zero leaked children. Controls15/15, neutrality24/24 each; baseline transport8/9 with terminal invalid-UTF8 mismatch retained and internal pipe/file controls passing.\nDispatch53/53 required unshadowed plugins plus8/8 curl cases; actual default inventory56 (unchanged inventory assertion). No default curl.\nAll4046 source/dependency/harness/golden/audit files unchanged and read-only at final verification; deps copied/verified once, no installs, no runtime dependencies. Historical goldens preserved byte-exact.\nProduct observations across profiles changed in ${profileObservationDelta.length} row/engine pairs; exact delta sealed, no recapture. Historical206/18 vs155/69 not relabeled as current.\nOne pre-case ENOBUFS setup attempt preserved; seal resumed only unfinished golden copy with same source/deps. No failed scoring attempts or full224 retries.\nPerformance NOT RUN: existing expanded CLI repeats224 and matrix; hardcoded sort-review is wrong source. Historical30 is total5x2x3 eligible trials, not30 sort trials. Root can authorize an owned bounded adapter of existing candidates once; no automatic rerun.\nNo private poe-code, SafeJS runtime/tests, S3 HTTP tests, native-bvNFwI/search-native touches, external service calls, live source/harness/golden edits, npm suites, staging or commits. Functional elapsed is not performance evidence.\nSource-only archive retained in report; full regular-file dependency copies retained under freeze. Check summary.json, profile-delta.json, final-integrity.json, oracle-identities.json and per-profile lifecycle/import/functional logs. Other fairness leaf and final reviewer remain separate; this scoped near-parity result does not prove full completion or much-better.\n`;
await writeFile('/tmp/safe-bash-comparison-replay-detail.txt', detail);
await writeFile('/tmp/safe-bash-comparison-replay-checkpoint.txt', detail);
console.log(JSON.stringify({ scores, dirtySource: dirtySource.map(row => row.path), actualProfileObservationDeltaCount: profileObservationDelta.length, historicalDeltaCount: historicalDelta.length, failureRows: failures.length, archiveSha256: summary.sourceArchive.sha256 }, null, 2));
