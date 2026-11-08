import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { addArtifact, auditCommit, digest, directory, git, root, sourceSnapshot } from './common.mjs';

const read = name => JSON.parse(readFileSync(join(directory, name), 'utf8'));
const main = read('post-handoff-d1f78d4-01.json');
const native = read('legacy-native-proof.json');
const legacy = read('legacy-product-proof.json');
const validation = read('bounded-validation.json');
const boundaries = read('failure-boundaries-results.json');
const unique = legacy.rows.filter(row => row.route === 'direct' && row.transport === 'whole');
const count = rows => ({ vectors: rows.length, exact: rows.filter(row => row.pass).length, diagnosticOnly: rows.filter(row => !row.pass && row.differingFields.join(',') === 'stderrHex').length, statusOrStdout: rows.filter(row => row.differingFields.includes('status') || row.differingFields.includes('stdoutHex')).length });
const classify = assertion => {
  if (assertion.startsWith('strict UTF-8 rejection') || /^raw native: (file-unicode|invalid:)/u.test(assertion)) return 'explicit non-native strict UTF8 policy retired; current exact native';
  if (assertion === 'raw native: record-error-prefix') return 'explicit non-native stop-first-error policy retired; current exact native';
  if (assertion.startsWith('strict malformed JSON 14')) return 'non-native low-surrogate rejection retired; current exact native';
  if (assertion.startsWith('strict malformed JSON 16')) return 'non-native terminal-NUL rejection retired; current exact native';
  if (assertion.startsWith('valid large decimals')) return 'mixed composite: low-surrogate first failure is retired rejection; retain six acceptance and thirteen diagnostic gaps';
  return 'non-native diagnostic regex, but missing native EOF diagnostic remains; prefix/status preserved';
};
const classification = validation.originalFailures.map(assertion => {
  const rows = unique.filter(row => row.assertion === assertion);
  assert.ok(rows.length);
  return { assertion, classification: classify(assertion), ...count(rows), probes: rows.map(row => row.id) };
});
const owned = relative(root, directory);
const prepPaths = git(['ls-tree', '-r', '--name-only', 'a2a567c', owned]).toString().trim().split('\n').filter(path => path !== `${owned}/README.md`);
const verify = (commit, paths) => paths.map(path => {
  const frozenSha256 = digest(git(['show', `${commit}:${path}`]));
  const currentSha256 = digest(readFileSync(path));
  assert.equal(currentSha256, frozenSha256, path);
  return { path, sha256: currentSha256, unchanged: true };
});
const historical = verify(auditCommit, validation.historical.map(row => row.path));
const prep = verify('a2a567c', prepPaths);
const current = sourceSnapshot();
assert.equal(current.structuredSha256, main.before.structuredSha256);
const structured = verify('d1f78d4', Object.keys(current.files).filter(path => path.startsWith('src/commands/structured/')));
const oldParser = git(['show', 'd1f78d4^:src/commands/structured/input.ts']).toString();
const currentParser = readFileSync(join(root, 'src/commands/structured/input.ts'), 'utf8');
const oldLiteral = oldParser.split('\n').find(line => line.trimStart().startsWith('const literal ='));
const currentLiteral = currentParser.split('\n').find(line => line.trimStart().startsWith('const literal ='));
assert.equal(oldLiteral, currentLiteral);
const oldJq = git(['show', 'd1f78d4^:src/commands/structured/jq.ts']).toString();
const artifactNames = ['README.md', 'REVIEW.md', 'post-handoff-d1f78d4-01.json', 'legacy-proof.ts', 'legacy-native-proof.json', 'legacy-product-proof.json', 'validation.mjs', 'bounded-validation.json', 'failure-boundaries.test.ts', 'failure-boundaries-run.mjs', 'failure-boundaries-results.json', 'seal-review.mjs'];
const report = {
  verdict: 'FAIL', recordedAt: new Date().toISOString(), authorSourceCommit: 'd1f78d43880c94300c0019b07a88110e9b3e8f08', structuredSha256: current.structuredSha256,
  rootEarlierProductSha256: '08c5e09989de486507cffa2f512700be456d5637b4120d477c07e5e2921a2cf5',
  main: { ...main.summary, executions: 790, pass: 788, fail: 2, failedRows: main.results.filter(row => !row.pass), exactUniqueVectors: 255, totalUniqueVectors: 256 },
  chunkCohort: { uniqueVectors: 5, byteLengths: [23, 28, 27, 34, 27], interiorCutsPerRoute: 134, wholePerRoute: 5, bytewisePerRoute: 5, executions: 288, pass: 288, includedInMain: true },
  legacy: { originalTests: validation.phases[0].counts, nativeInvocations: native.invocations, ...count(unique), executions: legacy.executions, pass: legacy.pass, fail: legacy.fail, classification, denominatorNote: '94 probes overlap main. 89 existing legacy constituents, 4 supplementary gaps, 1 reviewer failure; never add to 790.' },
  fourReportedGaps: unique.filter(row => row.group === 'supplementary-diagnostic-gap'),
  authorSafety: validation.phases.filter(phase => phase.name.startsWith('author-safety')).map(phase => ({ name: phase.name, counts: phase.counts, status: phase.status })),
  reviewerEvidenceControls: validation.phases.find(phase => phase.name === 'review-evidence-controls').counts,
  independentBoundaries: boundaries.phases.filter(phase => phase.repetition).map(phase => ({ repetition: phase.repetition, counts: phase.counts, status: phase.status })),
  typechecks: [...validation.phases, ...boundaries.phases].filter(phase => phase.name?.includes('typecheck')).map(phase => ({ name: phase.name, status: phase.status, stdout: phase.stdout, stderr: phase.stderr })),
  readOnlySourceInspection: { previousInputSha256: digest(oldParser), currentInputSha256: digest(currentParser), unchangedLiteralRegexp: oldLiteral, previousBomPreservingDecoder: oldParser.split('\n').find(line => line.includes('new TextDecoder')), oldHasDiagnosticQueue: oldJq.includes('const diagnostics:'), currentHasDiagnosticQueue: readFileSync(join(root, 'src/commands/structured/jq.ts'), 'utf8').includes('const diagnostics:'), limitation: 'No previous-source runtime replay. Six input acceptance gaps are pre-existing by unchanged rejection rules, not claimed freshly introduced. New stderr retry/replay follows new diagnostic queue and outer catch.' },
  snapshots: [main, legacy, validation, boundaries].map(report => ({ recordedAt: report.recordedAt, before: report.before, after: report.after, stableProductWithinRun: report.before.productSha256 === report.after.productSha256, stableStructuredWithinRun: report.before.structuredSha256 === report.after.structuredSha256 })),
  sealSnapshot: current, structuredStatus: git(['status', '--short', '--', 'src/commands/structured']).toString(), historical, prep, structured,
  artifacts: Object.fromEntries(artifactNames.map(name => [name, digest(readFileSync(join(directory, name)))])),
  fixOwnership: { root: 'coordinate only', production: 'Archimedes / structured author; root routes changes', review: `${owned}/** only`, requests: ['Do not retry/replay typed host stderr failures; preserve fatal boundaries and cancellation.', 'Correct fromjson unmatched-object diagnostic state and byte position.', 'Keep all four supplementary gaps and composite native disagreements visible; scope separate follow-up explicitly.'] },
  limits: ['FAIL is not acceptance.', 'Dirty shared product and HEAD move between cohorts; no clean committed-HEAD claim.', 'Original42 and chunk executions are subsets, not added denominators.', '170 historical and 15 immutable prep files unchanged.', 'No production fix, broad owned rerun, build, full parity, superiority or project-closure claim.'],
};
console.log(JSON.stringify({ verdict: report.verdict, reviewSha256: addArtifact('review.json', report), main: '788/790', legacy: count(unique), unchangedHistorical: historical.length, unchangedPrep: prep.length, structuredSha256: current.structuredSha256, currentHead: current.head }, null, 2));
