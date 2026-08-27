import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifact, digest, frozenPreparation, handoff, root, snapshot } from './common.mjs';
import { git } from '../jq-42-independent-review/common.mjs';
import { loadFrozen } from '../jq-grammar-independent/evidence.mjs';

const before = snapshot();
const evidence = loadFrozen();
const preparation = frozenPreparation();
const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const source = read('source-cohorts.json');
const compiled = read('compiled-cohorts.json');
const historicalPath = 'tests/commands/structured-stress/jq-42-independent-final/r2-legacy.json';
const historicalBytes = readFileSync(join(root, historicalPath));
assert.deepEqual(historicalBytes, git(['show', `bb1ceabef3a3a4c3791af64d9efb7384f6ca773f:${historicalPath}`]));
const historical = JSON.parse(historicalBytes);
const legacyCategories = { exact: [], diagnosticOnly: [], statusOrStdout: [] };
for (const vector of evidence.cohorts.legacy) {
  const rows = historical.results.filter(row => row.id === vector.id);
  assert.equal(rows.length, 4);
  const category = rows.every(row => row.pass) ? 'exact' : rows.every(row => row.actual.status === row.expected.status && row.actual.stdoutHex === row.expected.stdoutHex) ? 'diagnosticOnly' : 'statusOrStdout';
  legacyCategories[category].push(vector.id);
}
assert.deepEqual(Object.values(legacyCategories).map(ids => ids.length), [45, 43, 6]);
const sourceFiles = Object.fromEntries(Object.entries(before.files).filter(([path]) => path.startsWith('src/commands/structured/')));
for (const [path, hash] of Object.entries(sourceFiles)) assert.equal(digest(git(['show', `${handoff}:${path}`])), hash);
const authorDirectory = 'tests/commands/structured-stress/jq-grammar-author-20260827';
const authorReadPaths = ['README.md', 'REPORT.md', 'REPORT.json', 'committed-r3-checkpoint.json', 'committed-r3-broad-unchanged.json', 'committed-r3-new-author.json', 'committed-r3-global-types.json', 'committed-r3-build.json'];
const authorReadHashes = Object.fromEntries(authorReadPaths.map(name => [`${authorDirectory}/${name}`, digest(readFileSync(join(root, authorDirectory, name)))]));
for (const name of ['grammar', 'legacy', 'scan-boundaries', 'limits']) {
  const path = `${authorDirectory}/${name}.test.ts`;
  const bytes = readFileSync(join(root, path));
  assert.deepEqual(bytes, git(['show', `97bf80100140bf746efb8c0dec9f77dddcfef207:${path}`]));
  authorReadHashes[path] = digest(bytes);
}
const baseline = source.before;
const final = snapshot();
const sourceDiff = git(['diff', `${handoff}^`, handoff, '--', 'src/commands/structured']).toString();
const failingVectors = source.vectors.grammar.filter(vector => source.results.some(row => row.id === vector.id && !row.pass));
const rowsFor = (report, ids) => report.results.filter(row => ids.includes(row.id));
artifact('review.json', {
  verdict: 'NOT ACCEPTED: unsupported isfinite and real aliased-container NaN ordering mismatch remain. No canonical proposal approval.',
  recordedAt: new Date().toISOString(), handoff, before: baseline, after: final, structuredMatchesCommit: true,
  wholeProductEstablished: false, changedSinceFirstPhase: Object.keys(baseline.files).filter(path => baseline.files[path] !== final.files[path]),
  preparation, historicalSealedFiles: Object.keys(evidence.manifest.historicalFiles).length,
  sourceDiffSha256: digest(sourceDiff), sourceDiff, authorReadHashes,
  priorLegacy: { path: historicalPath, sha256: digest(historicalBytes), summary: historical.summary, categories: legacyCategories },
  reviewerSetupCorrection: 'Initial audit selected the earlier legacy-product-proof.json, computed 41 exact / 47 diagnostic / 6 acceptance, and failed the assertion expecting 45/43/6. No artifact was written by that failed audit. The accepted baseline is independently frozen bb1ceabe r2-legacy.json, now explicitly verified. The earlier 41/47/6 remains historical evidence. Cohort expectation bytes and execution results were never modified. Initial cohort artifact baseline summary/classification keys were absent on the older file and omitted during JSON serialization; this audit supplies the correct accepted baseline.',
  legacyDiagnosticsNow: Object.fromEntries(['source', 'compiled'].map(mode => {
    const report = mode === 'source' ? source : compiled;
    return [mode, { vectors: legacyCategories.diagnosticOnly.length, rows: rowsFor(report, legacyCategories.diagnosticOnly) }];
  })),
  failures: [
    { id: 'missing-isfinite', severity: 'acceptance-blocking requested predicate gap', vectors: failingVectors,
      source: source.results.filter(row => !row.pass), compiled: compiled.results.filter(row => !row.pass),
      sourceLocation: 'src/commands/structured/parser.ts:31; src/commands/structured/interpreter.ts:202',
      followup: 'Author implements native-profile isfinite semantics (including NaN) with proper budget/cancellation and independent retest of the unchanged entire35.' },
    { id: 'aliased-container-nan-order', severity: 'acceptance-blocking numeric ordering mismatch',
      vectors: read('alias-order-native.json').vectors, source: read('alias-order-source.json').rows, compiled: read('alias-order-compiled.json').rows,
      sourceLocation: 'src/commands/structured/values.ts:27',
      followup: 'Author separates equality identity optimization from recursive ordering. Preserve parsed-NaN equality/copy behavior while fixing container comparison; rerun unchanged cohorts and this frozen repro.' },
  ],
  host: read('host-contract.json'),
  validation: read('validation-summary.json').results,
  boundedRerun: { status: read('author-new-bounded-rerun.json').status, counts: read('author-new-bounded-rerun.json').counts,
    stableProduct: read('author-new-bounded-rerun.json').stableProduct, note: 'Only one bounded phase rerun. Product moved again; no further rerun or product identity claim.' },
  primaryResearch: [
    { url: 'https://jqlang.org/manual/v1.7/', sections: ['Identity', 'infinite, nan, isinfinite, isnan, isfinite, isnormal'], finding: 'Literal decimal representation differs from arithmetic double conversion; printed NaN/null must not decide numeric type or truth.' },
    { url: 'https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv_parse.c', sections: ['scan', 'check_literal', 'jv_parser_set_buf'], finding: 'Quoted string state, byte locations, literal accumulation and incremental BOM state are separate.' },
    { url: 'https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv.c', sections: ['jv_equal', 'jv_contains'], finding: 'Allocated identity can short-circuit equality; this does not establish an ordering shortcut.' },
    { url: 'https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv_aux.c', sections: ['jv_cmp'], finding: 'Arrays and objects recursively compare even when aliased; NaN ordering remains distinct from equality.' },
    { url: 'https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv_print.c', sections: ['jv_dump_term numeric branch'], finding: 'NaN renders null, literal precision may be retained, binary infinities are clamped for printing.' },
    { url: 'https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/builtin.jq', sections: ['isfinite'], finding: 'isfinite is defined as numeric type and not isinfinite, not JavaScript Number.isFinite.' },
  ],
  boundaries: 'Only this new evidence subtree edited. All original manifests/vectors/assertions retained; author test-only proposals remain separate and unapproved. No superiority, full jq/shell parity, clean HEAD, runtime dependency, native product process or 72-hour-work claim.'
});
console.log('review artifact frozen; historical baseline', Object.fromEntries(Object.entries(legacyCategories).map(([key, values]) => [key, values.length])));
