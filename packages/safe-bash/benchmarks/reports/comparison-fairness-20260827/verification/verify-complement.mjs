import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { bytes, compareRaw, emitReport, json, regularBytes, repo, safeRelative, same, sha256 } from './offline.mjs';

const replay = 'benchmarks/reports/current-integration/comparison-replay-20260827';
const audit = 'benchmarks/reports/comparison-fairness-20260827/audit';
const breadth = 'benchmarks/reports/baseline-only-20260827';
const expanded = 'benchmarks/reports/expanded-20260827';
const consumed = {};
const read = async path => { const content = await regularBytes(join(repo, path)); consumed[path] = sha256(content); return content; };
const data = async path => JSON.parse((await read(path)).toString());
const result = { kind: 'OFFLINE_COMPLEMENT_AND_ARCHIVE_REVIEW', productExecutions: 0, blockers: [] };
try {
  const originalManifest = await data(`${replay}/artifact-manifest.json`);
  const mapping = await data(`${replay}/qualification-files.json`);
  assert.equal(sha256(await read(`${replay}/artifact-manifest.json`)), mapping.preservation.initialArtifactManifestSha256);
  for (const [path, entry] of Object.entries(originalManifest.files)) {
    const retained = path === 'README.md' ? 'README.pre-qualification.md' : path;
    const content = await read(`${replay}/${retained}`);
    assert.equal(sha256(content), entry.sha256, `original artifact changed: ${path}`);
    assert.equal(content.length, entry.bytes);
  }
  for (const entry of mapping.changedFiles) assert.equal(sha256(await read(`${replay}/${entry.path}`)), entry.sha256);
  result.preservation = { originalManifestEntries: Object.keys(originalManifest.files).length, originalReadmeViaExactBackup: true, summaryByteExact: true };
  const frozen = await data(`${replay}/frozen-files.json`);
  const deps = await data(`${replay}/dependency-manifest.json`);
  const historicalManifest = await data(`${breadth}/coverage-execution/attempt-002/manifest.json`);
  for (const [directory, evidence] of Object.entries(deps)) {
    const copied = Object.fromEntries(Object.entries(evidence.paths).map(([path, entry]) => [path, { ...entry, originalSymlink: null }]));
    assert.equal(sha256(JSON.stringify(copied)), evidence.copiedTreeSha256);
    for (const [path, entry] of Object.entries(evidence.paths)) assert.equal(frozen[`${directory}/${path}`]?.sha256, entry.sha256);
    const prior = historicalManifest.dependencies.find(entry => entry.directory === directory);
    assert.equal(prior.entries.length, Object.keys(evidence.paths).length);
    for (const entry of prior.entries) assert.equal(evidence.paths[entry.path]?.sha256, entry.sha256, `dependency historical identity: ${directory}/${entry.path}`);
  }
  const location = await data(`${replay}/location.json`);
  const product = join(location.freeze, 'product');
  const packageBytes = await regularBytes(join(product, 'benchmarks/node_modules/just-bash/package.json'));
  const packageManifest = JSON.parse(packageBytes);
  const lock = await json(join(product, 'benchmarks/package-lock.json'));
  const provenance = await data(`${audit}/provenance.json`);
  assert.equal(sha256(packageBytes), provenance.identities.manifestSha256.sha256);
  assert.equal(packageManifest.version, '3.4.2');
  assert.deepEqual(lock.packages['node_modules/just-bash'], provenance.lock);
  for (const key of ['name', 'version', 'dependencies', 'optionalDependencies']) assert.deepEqual(packageManifest[key], provenance.registry[key]);
  assert.equal(provenance.lock.integrity, provenance.registry.dist.integrity);
  assert.equal(provenance.lock.resolved, provenance.registry.dist.tarball);
  assert.equal(provenance.github.commit, 'a021f95f53f7e01df48dab71b46ffd4637fb4b53');
  assert.equal(provenance.tarball.sriVerified, false);
  const release = await data(`${audit}/release-claim-review.json`);
  const point = release.currentOfficialDistTagsObservation;
  assert.equal(point.status, 200);
  assert.equal(Buffer.byteLength(point.bodyUtf8), point.responseBytes);
  assert.equal(sha256(point.bodyUtf8), point.responseSha256);
  assert.equal(JSON.parse(point.bodyUtf8).latest, '3.4.2');
  const historicalRelease = await read(`${expanded}/release.json`);
  assert.equal(sha256(historicalRelease), release.retainedPrimaryReleaseCapture.artifactSha256);
  for (const revision of ['8e09db9', 'd484f98']) {
    assert.deepEqual(execFileSync('git', ['show', `${revision}:${expanded}/release.json`]), historicalRelease);
    const ledger = execFileSync('git', ['show', `${revision}:docs/PROJECT_LEDGER.md`]);
    assert.equal(sha256(ledger), release.historicalDocumentSha256[`${revision}:docs/PROJECT_LEDGER.md`]);
    assert.ok(ledger.includes(Buffer.from('01:21:05')) && ledger.includes(Buffer.from('01:39:51')));
  }
  result.metadata = { version: packageManifest.version, baselineDependencies: Object.keys(deps['benchmarks/node_modules'].paths).length, rootDependencies: Object.keys(deps.node_modules.paths).length, pointInTimeLatest: { at: point.receivedAt, version: JSON.parse(point.bodyUtf8).latest, exactBodySha256: point.responseSha256 }, historicalSupport: '01:39 retained summary; earlier01:21 ledger statement lacks separate capture', limits: 'Pinned official response summaries are retained, not full three primary bodies. No new fetch, no published-tarball/SRI/signature authenticity verification, no future latest claim.' };
  const archive = gunzipSync(await read(`${replay}/source-harness-goldens.tar.gz`), { maxOutputLength: 32 * 1024 * 1024 });
  const archived = new Map();
  const sidecars = [];
  let offset = 0;
  let pending = {};
  let extensions = 0;
  let directories = 0;
  while (offset + 512 <= archive.length && archive.subarray(offset, offset + 512).some(value => value !== 0)) {
    const header = archive.subarray(offset, offset + 512);
    const text = (start, end) => header.subarray(start, end).toString().split('\0')[0];
    const octal = (start, end) => { const value = text(start, end).trim(); assert.match(value, /^[0-7]+$/u); return parseInt(value, 8); };
    const expectedChecksum = octal(148, 156);
    let checksum = 0;
    for (const [index, value] of header.entries()) checksum += index >= 148 && index < 156 ? 32 : value;
    assert.equal(checksum, expectedChecksum);
    const size = octal(124, 136);
    const type = text(156, 157);
    const payload = archive.subarray(offset + 512, offset + 512 + size);
    assert.equal(payload.length, size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      assert.deepEqual(pending, {});
      let position = 0;
      while (position < payload.length) {
        const space = payload.indexOf(32, position);
        assert.ok(space > position);
        const lengthText = payload.subarray(position, space).toString();
        assert.match(lengthText, /^[1-9][0-9]*$/u);
        const length = Number(lengthText);
        assert.ok(length > space - position + 3 && position + length <= payload.length);
        assert.equal(payload[position + length - 1], 10);
        const record = payload.subarray(space + 1, position + length - 1).toString();
        const equal = record.indexOf('=');
        assert.ok(equal > 0);
        const key = record.slice(0, equal);
        assert.ok(['path', 'mtime', 'atime', 'ctime', 'SCHILY.dev', 'SCHILY.ino', 'SCHILY.nlink', 'LIBARCHIVE.xattr.com.apple.provenance', 'SCHILY.xattr.com.apple.provenance'].includes(key), `unexpected archive extension: ${key}`);
        pending[key] = record.slice(equal + 1);
        position += length;
      }
      extensions++;
      continue;
    }
    assert.ok(['0', '', '5'].includes(type), `archive link/special type not allowed: ${type}`);
    assert.equal(text(157, 257), '');
    const prefix = text(345, 500);
    const path = (pending.path ?? [prefix, text(0, 100)].filter(Boolean).join('/')).replace(/\/$/u, '');
    safeRelative(path);
    assert.ok(!path.split('/').includes('node_modules') && !path.split('/').includes('.git'));
    assert.ok(!archived.has(path), `duplicate archive path: ${path}`);
    pending = {};
    if (type === '5') { assert.equal(size, 0); directories++; archived.set(path, { type: 'directory' }); continue; }
    if (path.split('/').at(-1).startsWith('._')) {
      assert.ok(size >= 26 && payload.readUInt32BE(0) === 0x00051607, `non-AppleDouble extra file: ${path}`);
      sidecars.push(path);
      archived.set(path, { type: 'appledouble', bytes: size, sha256: sha256(payload) });
    } else {
      assert.ok(frozen[path], `unsealed archive source: ${path}`);
      assert.equal(sha256(payload), frozen[path].sha256);
      assert.equal(octal(100, 108) & 0o777, frozen[path].mode & ~0o222);
      archived.set(path, { type: 'source', bytes: size, sha256: sha256(payload) });
    }
  }
  assert.deepEqual(pending, {});
  assert.ok(archive.length - offset >= 1024 && archive.subarray(offset).every(value => value === 0));
  for (const path of sidecars) assert.ok(archived.has(path.replace(/(^|\/)\._([^/]+)$/u, '$1$2')));
  const expectedArchive = Object.keys(frozen).filter(path => !path.split('/').includes('node_modules')).sort();
  const actualArchive = [...archived].filter(([, entry]) => entry.type === 'source').map(([path]) => path).sort();
  assert.deepEqual(actualArchive, expectedArchive);
  result.archive = { regularSourceFiles: actualArchive.length, directories, appleDoubleSidecars: sidecars.length, paxHeaders: extensions, unsafeLinks: 0, dependencyFiles: 0, privateEngineFiles: 0, entriesSha256: sha256(JSON.stringify([...archived])), qualification: 'Source/config plus versioned public benchmark harness/goldens. Darwin AppleDouble metadata is present and disclosed, not third-party engine payload. No extraction/import/execution.' };
  const inputs = await data(`${breadth}/coverage-execution/attempt-002/execution-inputs.json`);
  const author = await data(`${breadth}/coverage-execution/attempt-002/results.json`);
  const reviewed = await data(`${breadth}/coverage-review/measured/review-matrix.json`);
  const overlap = await data(`${audit}/overlap.json`);
  const originalRows = await data(`${replay}/original/functional.json`);
  const alignedRows = await data(`${replay}/scratch-aligned/functional.json`);
  assert.deepEqual(originalRows.map(row => row.id), alignedRows.map(row => row.id));
  for (const [index, row] of originalRows.entries()) for (const engine of ['virtual-bash', 'just-bash']) assert.ok(compareRaw(row[engine].observation, alignedRows[index][engine].observation).pass, `cross-profile product difference: ${row.id}/${engine}`);
  const recipes = [...inputs.cases, ...inputs.diagnostics];
  assert.equal(new Set(recipes.map(recipe => recipe.id)).size, 68);
  assert.equal(overlap.rows.length, recipes.length);
  const expandedInputs = await data(`${replay}/original/case-inputs.json`);
  const target = recipe => ['historical-unmeasured', 'additional-optional'].includes(recipe.cohort);
  const stable = entry => ({ path: entry.path, type: entry.type, mode: entry.mode === undefined ? undefined : entry.mode & 4095, base64: entry.base64, target: entry.target });
  const outcomes = [];
  for (const recipe of recipes) {
    const mappingRow = overlap.rows.find(row => row.breadthId === recipe.id);
    assert.equal(mappingRow.inputSha256, recipe.inputSha256);
    assert.equal(mappingRow.recipe, recipe.script);
    assert.equal(mappingRow.unionCredit, 0);
    for (const candidate of mappingRow.expandedCandidates) {
      const actual = expandedInputs.find(item => item.id === candidate.id);
      assert.equal(candidate.recipeSha256, sha256(JSON.stringify(actual)));
      assert.equal(candidate.recipe, actual.script);
    }
    const authorRow = [...author.observations, ...author.diagnosticObservations].find(row => row.id === recipe.id);
    for (const engine of ['ours', 'baseline']) {
      const rawPath = authorRow.rawPaths?.[engine] ?? `${breadth}/coverage-execution/attempt-002/raw/${recipe.id}.${engine}.json`;
      const raw = await data(rawPath);
      const reviewer = reviewed.observations.find(row => row.id === recipe.id)?.[engine];
      assert.ok(reviewer, 'review observation missing');
      const repeated = await data(reviewer.raw);
      assert.equal(consumed[reviewer.raw], reviewer.rawSha256);
      assert.deepEqual(raw.report.result, repeated.report.result);
      for (const phase of ['before', 'after']) assert.deepEqual(raw.report[phase].entries.map(stable), repeated.report[phase].entries.map(stable));
      assert.equal(raw.exitCode, repeated.exitCode);
      assert.equal(raw.signal, repeated.signal);
      const normal = raw.exitCode === 0 && !raw.signal && !raw.parentTimeout;
      const observation = raw.report;
      const expectation = recipe.expected;
      let intent = null;
      if (expectation) {
        const checks = [observation.result.exitCode === expectation.exitCode, observation.captureErrors.length === 0, !observation.executionError, observation.before.complete, observation.after.complete];
        const before = new Map(observation.before.entries.map(entry => [entry.path, entry]));
        const after = new Map(observation.after.entries.map(entry => [entry.path, entry]));
        for (const field of ['stdoutBase64', 'stderrBase64']) if (field in expectation) checks.push(bytes(observation.result[field]).equals(bytes(expectation[field])));
        for (const text of expectation.stdoutIncludes ?? []) checks.push(observation.result.stdout.includes(text));
        for (const text of expectation.stdoutExcludes ?? []) checks.push(!observation.result.stdout.includes(text));
        if (expectation.elapsedAtLeastMs !== undefined) checks.push(observation.productElapsedMs >= expectation.elapsedAtLeastMs);
        for (const [path, needed] of Object.entries(expectation.files)) {
          const found = after.get(`/fixture/${path}`);
          checks.push(found?.type === 'file');
          const payload = bytes(found?.base64 ?? '');
          if (needed.base64 !== undefined) checks.push(payload.equals(bytes(needed.base64)));
          if (needed.prefixBase64 !== undefined) checks.push(payload.subarray(0, bytes(needed.prefixBase64).length).equals(bytes(needed.prefixBase64)));
          if (needed.minBytes !== undefined) checks.push(payload.length >= needed.minBytes);
          for (const text of needed.includes ?? []) checks.push(payload.includes(Buffer.from(text)));
        }
        for (const path of expectation.absent) checks.push(!after.has(`/fixture/${path}`));
        if (expectation.preserveInputs) for (const [path, entry] of before) if (path.startsWith('/fixture/') || path.startsWith('/tmp/')) checks.push(after.has(path) && same(stable(entry), stable(after.get(path))));
        for (const [path, fixture] of Object.entries(recipe.files)) { checks.push(before.get(`/fixture/${path}`)?.base64 === fixture.base64); if (fixture.mode !== undefined) checks.push((before.get(`/fixture/${path}`)?.mode & 4095) === fixture.mode); }
        for (const [path, link] of Object.entries(recipe.symlinks)) checks.push(before.get(`/fixture/${path}`)?.type === 'symlink' && before.get(`/fixture/${path}`)?.target === link);
        intent = checks.every(Boolean);
        assert.equal(intent, reviewer.productIntentSatisfied);
      }
      const operational = Boolean(intent && normal && recipe.operationalCredit !== false && !['help', 'wait', 'node'].includes(recipe.name) && recipe.cohort !== 'direct-diagnostic');
      assert.equal(operational, reviewer.operationalCredit);
      outcomes.push({ id: recipe.id, engine, name: recipe.name, target: target(recipe), normal, intent, operational, guestStatus: raw.report.result.exitCode, childStatus: raw.exitCode, signal: raw.signal, missing: normal && raw.report.result.exitCode === 127 && raw.report.result.stderr.includes(`${recipe.name}: command not found`) });
    }
  }
  assert.equal(outcomes.length, 136);
  assert.equal(new Set(outcomes.map(row => `${row.id}:${row.engine}`)).size, 136);
  const missing = inputs.cases.filter(target).map(recipe => ({ name: recipe.name, proofs: outcomes.filter(row => row.engine === 'ours' && row.name === recipe.name && row.missing).map(row => row.id) }));
  assert.equal(missing.length, 54);
  assert.equal(new Set(missing.map(row => row.name)).size, 54);
  assert.ok(missing.every(row => row.proofs.length));
  const cleanTargets = Object.fromEntries(['ours', 'baseline'].map(engine => [engine, outcomes.filter(row => row.engine === engine && row.target && row.operational).length]));
  assert.deepEqual(cleanTargets, { ours: 0, baseline: 47 });
  const abnormal = outcomes.filter(row => !row.normal);
  assert.equal(abnormal.length, 1);
  assert.equal(abnormal[0].id, 'js-exec-positive');
  assert.equal(abnormal[0].guestStatus, 0);
  assert.equal(abnormal[0].operational, false);
  result.breadth = { distinctRecipes: 68, primary: inputs.cases.length, diagnostics: inputs.diagnostics.length, completedEngineOutcomes: outcomes.length, missingSpellings: missing, cleanTargets, normalChildren: 135, abnormal, gate: 'HISTORICAL_LIFECYCLE_FAIL_RETAINED', unionCredit: 0, overlapRelatedRows: overlap.rows.filter(row => row.expandedCandidates.length).length, outcomes };
  const history = await data(`${expanded}/corrected-bd2cacb/functional.json`);
  const gold = await data(`${expanded}/native-corrected/native.json`);
  result.historicalScores = Object.fromEntries(['virtual-bash', 'just-bash'].map(engine => { const pass = history.filter(row => compareRaw(row.expected, row[engine].observation).pass).length; return [engine, { pass, fail: history.length - pass, total: history.length }]; }));
  const performance = await data(`${expanded}/corrected-bd2cacb/performance.json`);
  let trials = 0;
  for (const row of performance) for (const trial of row.trials) { assert.ok(compareRaw(gold.observations.find(item => item.id === row.id), trial.observation).pass); trials++; }
  assert.equal(trials, 30);
  assert.equal(performance.filter(row => row.eligible).length, 3);
  result.performance = { historicalOnly: true, matchingTrials: trials, eligibleWorkloads: 3, trialsPerEnginePerWorkload: 5, currentPerformanceClaim: false, limits: 'Not30 sort trials. Historical source/mixed-native profile, cohost load, execution-vs-processRSS windows and2ms sampling retained; no whole-product speed or memory claim.' };
  for (const [path, digest] of Object.entries(consumed)) assert.equal(sha256(await regularBytes(join(repo, path))), digest, `evidence changed during read: ${path}`);
  result.inputHashes = consumed;
  result.status = 'OFFLINE_COMPLEMENT_CHECKS_PASS_WITH_HISTORICAL_LIFECYCLE_FAILURE_EXPLICIT';
} catch (error) {
  result.status = 'BLOCKED';
  result.blockers.push({ message: error.message, stack: error.stack });
  result.inputHashes = consumed;
  process.exitCode = 1;
}
await emitReport(result, process.argv[2] === '--out' ? process.argv[3] : undefined);
