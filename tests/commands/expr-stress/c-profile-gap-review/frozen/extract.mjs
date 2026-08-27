import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../../..');
const candidate = '27a7793526830768484885afba5832bf8bb248b5';
const evidence = '50b1e560b11adfcd1d1726896832c3c524e28c4d';
const replay = 'tests/commands/expr-stress/extension-review/after-abort-fix/replay';
const original = { commit: '35aa8054ac0ebc1eacefc7cde63e4706f4c72137', base: 'tests/commands/expr-stress/frozen', capture: 'original-20260827', cohort: 'original95' };
const extension = { commit: '92fe8a6335366b93cbc9a80d61fede69af711444', base: 'tests/commands/expr-stress/extension-review/frozen', capture: 'native-20260827', cohort: 'extension-original20' };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const git = (...args) => execFileSync('git', args, { cwd: root, timeout: 60000, maxBuffer: 256 * 1024 * 1024 });
const cache = new Map();
function blob(commit, path) {
  const key = `${commit}:${path}`;
  if (!cache.has(key)) cache.set(key, git('show', key));
  return cache.get(key);
}
const parsed = (commit, path) => JSON.parse(blob(commit, path));
const receipt = path => parsed(evidence, `${replay}/${path}`);
const names = (commit, base) => git('ls-tree', '-r', '--name-only', commit, '--', base).toString().trim().split('\n').sort();
const reference = (commit, path, pointer = '') => ({ commit, path, sha256: digest(blob(commit, path)), pointer });
const replayReference = (path, pointer = '') => reference(evidence, `${replay}/${path}`, pointer);
function addFile(name, content) {
  const path = resolve(owned, name);
  assert.equal(dirname(path), owned);
  assert(!existsSync(path), `refuse overwrite: ${path}`);
  assert(content.endsWith('\n'));
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${content.slice(0, -1).split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  execFileSync('apply_patch', [], { cwd: root, input: patch, maxBuffer: 1024 * 1024 });
}
function compare(expected, actual) {
  const semantic = expected.status === actual.status && expected.stdoutBase64 === actual.stdoutBase64
    && Boolean(expected.stderrBase64) === Boolean(actual.stderrBase64) && !actual.failure && !actual.signal;
  const diagnostic = expected.stderrBase64 === actual.stderrBase64;
  return { semantic: Boolean(semantic), diagnostic, strict: Boolean(semantic && diagnostic) };
}
function tuple(value) {
  assert.equal(value.signal, null);
  assert.equal(value.failure, null);
  const result = { status: value.status, signal: value.signal, failure: value.failure };
  for (const stream of ['stdout', 'stderr']) {
    const base64 = value[`${stream}Base64`];
    const bytes = Buffer.from(base64, 'base64');
    assert.equal(bytes.toString('base64'), base64);
    let text = null;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch (error) { assert.equal(error.code, 'ERR_ENCODING_INVALID_ENCODED_DATA'); }
    if (text !== null) assert.deepEqual(Buffer.from(text, 'utf8'), bytes);
    result[stream] = { base64, hex: bytes.toString('hex'), byteLength: bytes.length, utf8: text, utf8Valid: text !== null };
  }
  return result;
}
function localeSelection(environment) {
  const select = category => {
    const variable = ['LC_ALL', category, 'LANG'].find(key => Boolean(environment[key]));
    return { selectedBy: variable ?? 'virtual default', value: variable ? environment[variable] : 'C' };
  };
  return { character: select('LC_CTYPE'), collation: select('LC_COLLATE'), qualification: 'Static selection from exact context.env using archived internal.ts:99-110; syntax errors need not evaluate either locale gate.' };
}
function inputs(argv) {
  const colon = argv.indexOf(':');
  return { argv, argvUtf8Hex: argv.map(value => Buffer.from(value).toString('hex')),
    pattern: colon < 0 ? null : { argumentIndex: colon + 1, text: argv[colon + 1], utf8Hex: Buffer.from(argv[colon + 1]).toString('hex'), qualification: 'Literal argument; a grammar failure can prevent regex parsing.' } };
}
function authenticate() {
  for (const commit of [candidate, evidence, original.commit, extension.commit]) assert.equal(git('rev-parse', `${commit}^{commit}`).toString().trim(), commit);
  const manifest = receipt('execution-manifest.json');
  assert.equal(manifest.sourceCommit, candidate);
  assert.equal(digest(json(manifest.files)), manifest.inventorySha256);
  assert.deepEqual(names(evidence, replay), [...manifest.files.map(file => `${replay}/${file.path}`), `${replay}/execution-manifest.json`].sort());
  for (const file of manifest.files) assert.equal(digest(blob(evidence, `${replay}/${file.path}`)), file.sha256, file.path);
  const stage = receipt('candidate-27a77935/stage.json');
  assert.equal(stage.commit, candidate);
  assert.equal(git('rev-parse', `${candidate}:src`).toString().trim(), stage.sourceTreeGitId);
  assert.deepEqual(names(candidate, 'src'), stage.sourceFiles.map(file => `src/${file.path}`).sort());
  for (const file of stage.sourceFiles) assert.equal(digest(blob(candidate, `src/${file.path}`)), file.sha256, file.path);
  assert.equal(digest(json(stage.sourceFiles)), stage.sourceTreeSha256);
  for (const file of stage.buildInputs) assert.equal(digest(blob(candidate, file.path)), file.sha256, file.path);
  const native = receipt('native-27a77935/native-replay.json');
  assert.equal(native.qualification, 'PASS NATIVE REPLAY ONLY');
  const freezes = [];
  for (const freeze of [original, extension]) {
    const files = names(freeze.commit, freeze.base);
    assert.deepEqual(names(candidate, freeze.base), files);
    assert.deepEqual(names(evidence, freeze.base), files);
    for (const path of files) {
      assert.deepEqual(blob(candidate, path), blob(freeze.commit, path));
      assert.deepEqual(blob(evidence, path), blob(freeze.commit, path));
    }
    const seal = parsed(freeze.commit, `${freeze.base}/evidence/${freeze.capture}/manifest.json`);
    for (const file of seal.files) assert.equal(digest(blob(freeze.commit, `${freeze.base}/${file.path}`)), file.sha256, file.path);
    const archivedInventory = native.freezes.find(item => item.base === freeze.base);
    assert.deepEqual(archivedInventory.files.map(file => file.path).sort(), files);
    for (const file of archivedInventory.files) assert.equal(digest(blob(freeze.commit, file.path)), file.sha256);
    freezes.push({ ...freeze, fileCount: files.length, subtreeGitId: git('rev-parse', `${freeze.commit}:${freeze.base}`).toString().trim(), inventorySha256: digest(json(archivedInventory.files)), manifest: reference(freeze.commit, `${freeze.base}/evidence/${freeze.capture}/manifest.json`) });
  }
  return { stage, native, summary: {
    evidenceCommit: evidence, candidateCommit: candidate, evidenceManifest: replayReference('execution-manifest.json'),
    replayInventorySha256: manifest.inventorySha256, replayFilesAuthenticated: manifest.files.length,
    completeCommittedReplayInventoryChecked: true, candidateSourceFilesAuthenticated: stage.sourceFiles.length,
    candidateSourceInventoryChecked: true, historicalCandidateArchiveSha256: stage.archiveSha256,
    sourceTreeGitId: stage.sourceTreeGitId, sourceTreeSha256: stage.sourceTreeSha256, freezes,
    qualification: 'Authentication of immutable Git objects and committed receipts, not a new product/native execution or current host prerequisite qualification. Archive container hash is historical receipt data, not a newly regenerated archive hash; complete src and build-input hashes are independently checked against fixed Git objects. No extraction, build, native oracle, installed product, ambient locale, or live source is used.'
  } };
}
function makeMatrix() {
  const { stage, native, summary } = authenticate();
  const acceptance = receipt('acceptance-27a77935/summary.json');
  assert.equal(acceptance.candidate.commit, candidate);
  assert.equal(acceptance.candidate.sourceTreeSha256, stage.sourceTreeSha256);
  const categories = { nullable: [], namedLocale: [], cDiagnostics: [] };
  const appleSeparate = [], namedLocaleControls = [], corrections = [];
  for (const freeze of [original, extension, { ...extension, capture: 'quoted-parenthesis-20260827', cohort: 'extension-correction1' }]) {
    const comparisonPath = `acceptance-27a77935/${freeze.cohort}-comparison.json`;
    const comparison = receipt(comparisonPath);
    const report = receipt(`acceptance-27a77935/${freeze.cohort}-report.json`);
    const oraclePath = `${freeze.base}/evidence/${freeze.capture}/oracle.json`;
    const oracle = parsed(freeze.commit, oraclePath);
    const inputCases = parsed(freeze.commit, `${freeze.base}/inputs.json`).cases;
    assert.deepEqual(comparison.candidate, acceptance.candidate);
    assert.deepEqual(report.candidate, acceptance.candidate);
    for (const [rowIndex, row] of comparison.rows.entries()) {
      const nativeProfile = oracle.profiles.find(profile => profile.id === row.profile);
      const expectedRows = nativeProfile.results ?? [{ ...nativeProfile.result, argvUtf8Hex: oracle.argvUtf8Hex }];
      const expected = expectedRows.find(item => item.id === row.id);
      assert.deepEqual(row.expected, expected);
      assert.deepEqual(row.argv.map(arg => Buffer.from(arg).toString('hex')), expected.argvUtf8Hex);
      if (freeze.cohort !== 'extension-correction1') {
        const input = inputCases.find(item => item.id === row.id);
        assert.deepEqual(input.argv, row.argv);
        assert.equal(digest(JSON.stringify(input)), row.expected.caseSha256);
      }
      const actualProfile = report.profiles.find(profile => profile.id === row.profile);
      assert.deepEqual(actualProfile.environment, nativeProfile.environment);
      assert.deepEqual(row.actual, actualProfile.results.find(item => item.id === row.id));
      assert.deepEqual(row.comparison, compare(row.expected, row.actual));
      const nativeReplayProfile = native.cohorts.find(cohort => cohort.id === freeze.cohort).profiles.find(profile => profile.id === row.profile);
      const replayed = nativeReplayProfile.results.find(item => item.id === row.id);
      assert(compare(row.expected, replayed).strict);
      const virtualEnvironment = { LC_ALL: 'C', ...actualProfile.environment };
      const expanded = {
        key: `${freeze.cohort}/${row.profile}/${row.id}`, cohort: freeze.cohort, id: row.id, profile: row.profile,
        classification: row.comparison.semantic ? row.comparison.strict ? 'control' : 'diagnostic difference' : 'semantic failure',
        input: inputs(row.argv),
        virtualInvocation: { entry: 'createExprCommand({}).execute(context)', command: 'expr', cwd: '/', environment: virtualEnvironment, environmentOrigin: 'runtime-driver.mjs:47 spreads the explicitly supplied profile environment over LC_ALL=C; no process.env.', localeSelection: localeSelection(virtualEnvironment) },
        nativeInvocation: { executable: nativeProfile.actualExecutedPath, argv0: nativeProfile.logicalArgv0 ?? 'expr', argv: row.argv, environment: nativeProfile.environment, locale: nativeProfile.locale ?? nativeProfile.environment.LC_ALL, charmap: nativeReplayProfile.charmap, cwd: native.cleanup.fixture, stdin: 'ignored', shell: false, provenance: 'pinnedNative' },
        expected: tuple(row.expected), actual: tuple(row.actual), comparison: row.comparison,
        originalObservation: row,
        provenance: { comparison: replayReference(comparisonPath, `/rows/${rowIndex}`), originalOracle: reference(freeze.commit, oraclePath), nativeReplay: replayReference('native-27a77935/native-replay.json'), inputFreeze: freeze.commit }
      };
      if (freeze.cohort === 'extension-correction1') corrections.push(expanded);
      else if (row.profile.startsWith('gnu-')) {
        if (row.profile.endsWith('-C') && !row.comparison.strict) categories.cDiagnostics.push(expanded);
        else if (row.profile.endsWith('-en_US.UTF-8')) (row.comparison.strict ? namedLocaleControls : categories.namedLocale).push(expanded);
      } else appleSeparate.push(expanded);
    }
  }
  const nullablePath = 'supplement-27a77935/nullable-separate-cohort.json';
  const nullable = receipt(nullablePath);
  assert.equal(nullable.candidate, candidate);
  assert.equal(nullable.nativeIdentity.sha256, native.identities.find(item => item.name === 'gnu').sha256);
  for (const [rowIndex, row] of nullable.rows.entries()) {
    assert.deepEqual(row.comparison, compare(row.expected, row.actual));
    const virtualEnvironment = { LC_ALL: 'C' };
    categories.nullable.push({
      key: `nullable-separate/${row.id}`, cohort: 'nullable-separate', id: row.id, profile: 'gnu-9.7-darwin-C',
      classification: row.comparison.semantic ? 'control' : 'semantic failure', input: inputs(row.argv),
      virtualInvocation: { entry: 'createExprCommand({}).execute(context)', command: 'expr', cwd: '/', environment: virtualEnvironment, environmentOrigin: 'supplement.mjs:60 supplies no environment; runtime-driver.mjs:47 constructs exactly {LC_ALL:"C"}. The top-level nullable receipt environment describes native, NOT virtual.', localeSelection: localeSelection(virtualEnvironment) },
      nativeInvocation: { executable: nullable.nativeIdentity.actualPath, argv0: 'expr', argv: row.argv, environment: nullable.environment, locale: 'C', cwd: null, cwdQualification: 'Owned mkdtemp expr-nullable-final-native-*; exact resulting pathname was not retained in this capture. Do not invent it.', stdin: 'ignored', shell: false, timeoutMs: 2000, maxBuffer: 65536, killSignal: 'SIGKILL', provenance: 'pinnedNative' },
      expected: tuple(row.expected), actual: tuple(row.actual), comparison: row.comparison, originalObservation: row,
      provenance: { comparison: replayReference(nullablePath, `/rows/${rowIndex}`), invocation: replayReference('supplement.mjs'), virtualContext: replayReference('runtime-driver.mjs') }
    });
  }
  assert.deepEqual(categories.nullable.map(row => row.id), ['empty', 'a', 'aa', 'aaa', 'no-reference', 'not-repeated', 'nonnullable', 'mandatory-empty']);
  assert.equal(categories.nullable.filter(row => !row.comparison.semantic).length, 5);
  assert.equal(categories.nullable.filter(row => row.comparison.strict).length, 3);
  assert.equal(categories.namedLocale.length, 10);
  assert.equal(categories.namedLocale.filter(row => row.cohort === 'original95').length, 7);
  assert.equal(categories.cDiagnostics.length, 9);
  assert.equal(categories.cDiagnostics.filter(row => row.cohort === 'original95').length, 8);
  assert(categories.cDiagnostics.every(row => row.comparison.semantic && !row.comparison.diagnostic));
  assert.equal(namedLocaleControls.length, 2);
  const selected = new Set([...categories.namedLocale, ...categories.cDiagnostics].map(row => `${row.cohort}/${row.id}/${row.profile.endsWith('-C') ? 'C' : 'en_US.UTF-8'}`));
  const appleCounterparts = appleSeparate.filter(row => selected.has(`${row.cohort}/${row.id}/${row.profile.endsWith('-C') ? 'C' : 'en_US.UTF-8'}`));
  assert.equal(appleCounterparts.length, 19);
  assert.equal(corrections.length, 2);
  assert(corrections.find(row => row.profile.startsWith('gnu')).comparison.strict);
  const relevantSource = ['src/commands/expr/internal.ts', 'src/commands/expr/evaluate.ts', 'src/commands/expr/syntax.ts', 'src/commands/expr/index.ts', 'src/commands/expr/bre-worker.ts', 'src/commands/regex-execution/client.ts', 'src/commands/regex-execution/worker.ts', 'src/commands/regex-execution/protocol.ts'];
  return {
    schema: 1, date: '2026-08-27', kind: 'Historical fixed-source exact gap extraction; no new product/native observations',
    authentication: summary,
    candidate: { ...acceptance.candidate, sourceTreeGitId: stage.sourceTreeGitId, archiveSha256: stage.archiveSha256, packageSha256: stage.packageSha256, stage: replayReference('candidate-27a77935/stage.json'), devtools: stage.devtools, buildInputs: stage.buildInputs, relevantSource: relevantSource.map(path => reference(candidate, path)), qualification: 'Existing moved-installed standalone expr capture, not a new execution, root export claim, source-only mock, or qualification of later live changes.' },
    pinnedNative: { identities: native.identities, sourceMemberSha256: native.sourceMemberSha256, host: native.host, macOS: tuple(native.macOS), originalHost: nullable.host, nativeVersion: tuple(native.identities.find(item => item.name === 'gnu').version), qualification: native.qualification, limits: native.limits, startedAt: native.startedAt, completedAt: native.completedAt, originalNullableIdentity: nullable.nativeIdentity, boundary: 'GNU coreutils 9.7 linked with Darwin libSystem; NOT GNU/Linux. Apple identity and observations are separate, not substitutes or normative requirements. Binary/archive/source prerequisite checks are historical authenticated receipts, not new checks of current files.' },
    counts: { requestedObservations: 27, nullable: { observations: 8, semanticFailures: 5, controls: 3, separateFromOriginalAndExtension: true }, namedLocale: { mismatches: 10, original: 7, extension: 3 }, cDiagnostics: { differences: 9, original: 8, extension: 1, semanticMatches: 9 }, original: { observations: 104, semanticMatches: 97, strictMatches: 89 }, extension: { observations: 23, semanticMatches: 20, strictMatches: 19 }, separateQuotedCorrection: { observations: 1, semanticMatches: 1, strictMatches: 1 } },
    comparatorDefinition: 'Semantic = equal status and stdout bytes and stderr presence, with no actual failure/signal; strict adds exact stderr. Diagnostic differences are NOT strict passes.',
    categories, separateNamedLocaleControls: namedLocaleControls, separateQuotedCorrection: corrections, separateAppleCounterparts: appleCounterparts,
    evidence: { report: replayReference('REPORT.md'), coverage: replayReference('coverage.json'), acceptance: replayReference('acceptance-27a77935/summary.json'), runtimeDriver: replayReference('runtime-driver.mjs'), nativeDriver: replayReference('review.mjs'), nullableDriver: replayReference('supplement.mjs'), historicalNullableDiagnosis: replayReference('supplement-27a77935/independent-nullable-diagnosis.txt'), historicalNullableProvenance: receipt('supplement-27a77935/independent-nullable-diagnosis-provenance.json') },
    limitations: ['No new corpus or product/native replay.', 'No current full gate, full GNU parity, Linux certification, or expr-complete claim.', 'No named-locale implementation is assigned or performed.', 'Historical nullable diagnosis is contextual, not fixed-source runtime acceptance.', 'The original native pathname, argv0, stderr, input Unicode normalization and all bytes are preserved.', 'This extraction checks complete immutable replay/source/frozen inventories, not the whole live worktree or all archived tests.']
  };
}
function readable(matrix) {
  const lines = ['# Exact frozen observations', '', 'Derived without execution from CASE_MATRIX.json. JSON strings below are escaped display, not shell commands. Every tuple includes status and exact stdout/stderr UTF-8 strings and hex bytes; empty strings/hex mean zero bytes. No newline or pathname normalization. Full provenance, argv hex, explicit environments and native identity are in the matrix.', ''];
  for (const [heading, rows] of Object.entries(matrix.categories)) {
    lines.push(`## ${heading} (${rows.length})`, '');
    for (const row of rows) {
      lines.push(`### ${row.key}`, '', `Classification: ${row.classification}.`, '', `argv: ${JSON.stringify(row.input.argv)}`, '', `Virtual environment: ${JSON.stringify(row.virtualInvocation.environment)}`, '', `Native environment: ${JSON.stringify(row.nativeInvocation.environment)}`, '', `Native executable: ${row.nativeInvocation.executable}; argv0=${JSON.stringify(row.nativeInvocation.argv0)}`, '');
      for (const label of ['expected', 'actual']) {
        const value = row[label];
        lines.push(`${label}: status=${value.status}; stdout=${JSON.stringify(value.stdout.utf8)}; stderr=${JSON.stringify(value.stderr.utf8)}`, '', `${label} bytes: stdout hex=${JSON.stringify(value.stdout.hex)}; stderr hex=${JSON.stringify(value.stderr.hex)}`, '');
      }
    }
  }
  lines.push('## Separate quoted-parenthesis correction (not a replacement)', '');
  const correction = matrix.separateQuotedCorrection.find(row => row.profile.startsWith('gnu'));
  lines.push(`argv=${JSON.stringify(correction.input.argv)}; expected and actual status=${correction.actual.status}, stdout=${JSON.stringify(correction.actual.stdout.utf8)}, stderr=${JSON.stringify(correction.actual.stderr.utf8)}. GNU correction 1/1 remains outside original104 and extension23. Apple counterpart remains separately recorded in the matrix.`, '');
  return lines.join('\n');
}
function inventory() {
  return readdirSync(owned).filter(name => name !== 'MANIFEST.json').sort().map(path => {
    assert(lstatSync(resolve(owned, path)).isFile(), `unexpected directory/symlink ${path}`);
    return { path, sha256: digest(readFileSync(resolve(owned, path))) };
  });
}
const mode = process.argv[2] ?? 'verify';
if (mode === 'extract') {
  const matrix = makeMatrix();
  addFile('CASE_MATRIX.json', json(matrix));
  addFile('CASES.md', readable(matrix));
  console.log(json({ state: 'FROZEN', matrixSha256: digest(json(matrix)), counts: matrix.counts, authentication: matrix.authentication }));
} else if (mode === 'seal') {
  const matrix = makeMatrix();
  assert.equal(readFileSync(resolve(owned, 'CASE_MATRIX.json'), 'utf8'), json(matrix));
  assert.equal(readFileSync(resolve(owned, 'CASES.md'), 'utf8'), readable(matrix));
  const files = inventory();
  addFile('MANIFEST.json', json({ schema: 1, date: '2026-08-27', candidate, evidence, files, inventorySha256: digest(json(files)), exclusion: 'MANIFEST.json only. Verification rejects added/missing/changed immediate entries and directories in this owned flat evidence tree; no claim about the whole repository.' }));
  console.log('Sealed owned evidence; no old input or product changed.');
} else {
  assert(['verify', 'check-extraction'].includes(mode));
  if (mode === 'verify') {
    const seal = JSON.parse(readFileSync(resolve(owned, 'MANIFEST.json')));
    assert.equal(seal.candidate, candidate);
    assert.equal(seal.evidence, evidence);
    assert.equal(digest(json(seal.files)), seal.inventorySha256);
    assert.deepEqual(inventory(), seal.files);
  }
  const matrix = makeMatrix();
  assert.equal(readFileSync(resolve(owned, 'CASE_MATRIX.json'), 'utf8'), json(matrix));
  assert.equal(readFileSync(resolve(owned, 'CASES.md'), 'utf8'), readable(matrix));
  console.log(json({ state: 'PASS READ-ONLY ARCHIVED EXTRACTION', ownedSealChecked: mode === 'verify', matrixSha256: digest(json(matrix)), counts: matrix.counts, authenticatedReplayFiles: matrix.authentication.replayFilesAuthenticated, authenticatedSourceFiles: matrix.authentication.candidateSourceFilesAuthenticated, productExecutions: 0, nativeExecutions: 0, ownedWorkers: 0, scratchDirectories: 0 }));
}
