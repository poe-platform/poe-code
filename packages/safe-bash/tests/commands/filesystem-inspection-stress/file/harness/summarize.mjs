import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const json = async (name) => JSON.parse(await readFile(join(root, name), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const reports = [];
const eventCounts = {};
const loadedFiles = new Map();
const productBuiltins = new Set();
const nativeByView = {};
const nativeDiffs = [];
const expectation = await json('holdout/expectations.json');
const outcomes = [];
const inputFreeze = await json('freeze.json');
const build = await json('build.json');
const processRows = await json('initial-run.json');
for (let index = 1; index <= 40; index++) {
  const id = `F${String(index).padStart(2, '0')}`;
  const report = (await json(`results/${id}.json`)).reports[0];
  reports.push(report);
  const events = (await readFile(join(root, 'results', `${id}.events.jsonl`), 'utf8')).trim().split('\n').map(JSON.parse);
  for (const entry of events) eventCounts[entry.kind] = (eventCounts[entry.kind] ?? 0) + 1;
  for (const view of report.evidence.views ?? []) {
    nativeByView[view.view] ??= { observations: 0, exact: 0, semantic: 0, unavailable: 0 };
    nativeByView[view.view].observations++;
    nativeByView[view.view].exact += Number(view.nativeExact);
    nativeByView[view.view].semantic += Number(view.semantic && view.exitCode === 0 && view.stderr === '');
    nativeByView[view.view].unavailable += Number(!view.nativeAvailable);
    if (!view.nativeExact) nativeDiffs.push({ id, view: view.view, actual: { stdout: view.stdout, stderr: view.stderr, status: view.exitCode }, expected: expectation.find((entry) => entry.id === id).nativeExact[view.view], semanticAccepted: view.semantic });
  }
  const moduleRows = (await readFile(join(root, 'results', `${id}.modules.jsonl`), 'utf8')).trim().split('\n').map(JSON.parse);
  for (const entry of moduleRows) {
    if (entry.product && entry.resolved.startsWith('node:')) productBuiltins.add(entry.resolved);
    if (entry.resolved.startsWith('file:')) {
      const location = fileURLToPath(entry.resolved);
      assert(location.startsWith(`${root}/`));
      if (!loadedFiles.has(location)) loadedFiles.set(location, { path: relative(root, location), sha256: hash(await readFile(location)) });
    }
  }
  let adjudication = report.semanticStatus;
  if (['F29', 'F33', 'F34'].includes(id)) {
    assert.equal(report.semanticStatus, 'fail');
    assert.match(report.error.message, /reference-equal/u);
    adjudication = 'harness-defect';
  } else if (report.nativeStatus === 'native-profile-conflict') adjudication = 'native-profile-conflict';
  outcomes.push({ id, rawSemanticStatus: report.semanticStatus, rawNativeStatus: report.nativeStatus, adjudication, recommendation: id === 'F16' ? 'SQLITE-MIME-001: prefer registered application/vnd.sqlite3; avoid deprecated alias absent compatibility requirement' : null });
}
const verifiedInputs = [];
for (const entry of [...inputFreeze.files, ...inputFreeze.dependencies, ...build.files]) {
  const location = join(root, 'candidate', entry.path);
  assert((await lstat(location)).isFile(), `No symlink imports: ${entry.path}`);
  assert.equal(hash(await readFile(location)), entry.sha256, `Frozen input changed: ${entry.path}`);
  verifiedInputs.push(entry.path);
}
const catalog = JSON.parse(await readFile('/tmp/safe-bash-file-holdout.KyVGrl0A/seal-catalog.json'));
for (const entry of catalog.artifacts) {
  const location = join(root, 'holdout', entry.relativePath);
  const bytes = entry.type === 'symlink-target' ? Buffer.from(await readlink(location)) : await readFile(location);
  assert.equal(hash(bytes), entry.sha256, `Holdout copy changed: ${entry.relativePath}`);
}
const count = (key, rows) => rows.reduce((counts, row) => ({ ...counts, [row[key]]: (counts[row[key]] ?? 0) + 1 }), {});
const summary = {
  generatedAt: new Date().toISOString(), candidateCommit: inputFreeze.commit,
  originalPreseal: '8b4a48a3c4f189b1d98707354a2eb469af3527250cca7e6bc36f02ed86e04297',
  sourceSha256: inputFreeze.sourceSha256, dependencySha256: inputFreeze.dependencySha256,
  initialRun: { cases: 40, completedChildren: processRows.rows.filter((row) => row.status === 0 && row.reportExists).length, timeouts: processRows.rows.filter((row) => row.signal).length, elapsedMs: processRows.elapsedMs, nativeRecaptures: 0, repeatedCases: 0 },
  rawSemanticCounts: count('semanticStatus', reports), rawNativeLaneCounts: count('nativeStatus', reports), adjudicatedCounts: count('adjudication', outcomes),
  content: { cases: 20, views: 80, semanticAcceptedViews: Object.values(nativeByView).reduce((total, value) => total + value.semantic, 0), nativeByView, nativeMachineExact: { matched: ['brief-mime', 'brief-mime-type', 'brief-mime-encoding'].reduce((total, key) => total + nativeByView[key].exact, 0), total: 60 }, humanPolicy: '20 semantic assertions; raw exact observations retained but not a required parity score' },
  unsupported: 0, characterizationOnlyBackendCases: ['F30', 'F31'],
  incompleteHarnessCases: ['F29', 'F33', 'F34'], lateRejectionAssertionsExecuted: false,
  lateRejectionBoundary: 'F33/F34 passed prompt cancellation and exact caller reason checks, then stopped at overly strong signal object identity assertion before late-read/return rejection injection. They are NOT passes; no reruns or oracle changes.',
  eventCounts, loadedModules: [...loadedFiles.values()].sort((left, right) => left.path.localeCompare(right.path)), productBuiltins: [...productBuiltins].sort(),
  afterRunInputVerification: { candidateSourceAndDevAndBuildFiles: verifiedInputs.length, unchangedHoldoutArtifacts: catalog.artifacts.length, allHashesMatch: true },
  recommendations: ['SQLITE-MIME-001'], outcomes,
};
await writeFile(join(root, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(join(root, 'native-differences.json'), `${JSON.stringify(nativeDiffs, null, 2)}\n`);
await writeFile(join(root, 'adjudication.json'), `${JSON.stringify(outcomes, null, 2)}\n`);
await mkdir(join(root, 'primary'));
const primary = [];
for (const name of ['vnd.sqlite3', 'vnd.microsoft.portable-executable', 'wasm']) {
  const url = `https://www.iana.org/assignments/media-types/application/${name}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(bytes.length < 65536);
  await writeFile(join(root, 'primary', `${name}.txt`), bytes);
  primary.push({ url, fetchedAt: new Date().toISOString(), bytes: bytes.length, sha256: hash(bytes), file: `${name}.txt` });
}
await writeFile(join(root, 'primary', 'manifest.json'), `${JSON.stringify(primary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, loadedModules: summary.loadedModules.length, outcomes: undefined }, null, 2));
