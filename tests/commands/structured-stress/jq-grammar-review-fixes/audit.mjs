import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { artifact, digest, expectedStructured, frozenPreparation, handoff, root, snapshot } from './common.mjs';
import { git } from '../jq-42-independent-review/common.mjs';
import { loadFrozen } from '../jq-grammar-independent/evidence.mjs';

const before = snapshot();
const read = name => JSON.parse(readFileSync(new URL(`${name}.json`, import.meta.url)));
const reviewer = '0f82d80bde6581dee8a8143a924a04950f5b072b';
const priorDirectory = 'tests/commands/structured-stress/jq-grammar-source-review/';
const seal = readFileSync(`${priorDirectory}MANIFEST.sha256`);
assert.deepEqual(seal, git(['show', `${reviewer}:${priorDirectory}MANIFEST.sha256`]));
const unchangedReviewer = Object.fromEntries(seal.toString().trimEnd().split('\n').map(line => {
  const [hash, name] = line.split(/\s+/u);
  const path = priorDirectory + name;
  assert.equal(digest(readFileSync(path)), hash, `reviewer evidence changed: ${path}`);
  return [path, hash];
}));
const frozen = loadFrozen();
const preparation = frozenPreparation();
const previousBroad = JSON.parse(readFileSync(`${priorDirectory}broad-unchanged.json`));
const canonicalPaths = [...new Set([...previousBroad.command, ...read('author-new').command].filter(path => path.endsWith('.test.ts')))];
const canonical = Object.fromEntries(canonicalPaths.map(path => {
  const bytes = readFileSync(path);
  assert.deepEqual(bytes, git(['show', `${reviewer}:${path}`]), `canonical changed: ${path}`);
  return [path, digest(bytes)];
}));
const failedNames = row => [...row.stdout.matchAll(/^\s*not ok \d+ - (.+)$/gmu)].map(match => match[1]);
assert.deepEqual(failedNames(read('broad-unchanged')), failedNames(previousBroad));
assert.equal(failedNames(read('broad-unchanged')).length, 30);
const initial = read('before-source-cohorts').before;
assert.equal(initial.structuredSha256, '120a10c34d96b26f584c6e4349ef9098c0537d76952078e70e9ce6ab5c3f0176');
for (const [path, hash] of Object.entries(initial.files).filter(([path]) => path.startsWith('src/commands/structured/'))) {
  assert.equal(digest(git(['show', `b9187c0f601c278b334f5a391d552c38c433444c:${path}`])), hash);
  assert.deepEqual(readFileSync(path), git(['show', `${handoff}:${path}`]), `final source differs from handoff: ${path}`);
}
const diffPaths = git(['diff', '--name-only', 'b9187c0f601c278b334f5a391d552c38c433444c', handoff, '--', 'src/commands/structured']).toString().trim().split('\n');
assert.deepEqual(diffPaths, ['src/commands/structured/README.md', 'src/commands/structured/interpreter.ts', 'src/commands/structured/parser.ts', 'src/commands/structured/values.ts']);
const sourceDiff = git(['diff', 'b9187c0f601c278b334f5a391d552c38c433444c', handoff, '--', 'src/commands/structured']).toString();
const cohorts = Object.fromEntries(['before-source', 'before-compiled', 'after-source', 'after-compiled'].map(label => {
  const row = read(`${label}-cohorts`);
  return [label, { startedAt: row.startedAt, endedAt: row.endedAt, structuredSha256: row.before.structuredSha256, productSha256: row.before.productSha256, stableProduct: row.stableProduct, summary: row.summary, emittedFiles: row.build?.emittedFiles, diagnostics: row.build?.diagnostics }];
}));
const focused = Object.fromEntries(['before-focused-source', 'before-focused-compiled', 'after-focused-source', 'after-focused-compiled'].map(label => [label, read(label).summary]));
artifact('audit.json', { verdict: 'SOURCE-FIX AUTHOR HANDOFF ONLY: both frozen defects now pass; different independent review required.', recordedAt: new Date().toISOString(), root, before, after: snapshot(), reviewer,
  initialCommit: 'b9187c0f601c278b334f5a391d552c38c433444c', initialStructuredSha256: initial.structuredSha256,
  sourceCommit: handoff, finalStructuredSha256: expectedStructured, diffPaths, sourceDiffSha256: digest(sourceDiff), sourceDiff,
  unchangedReviewer, preparation, historicalFiles: frozen.manifest.historicalFiles, canonical, retainedCanonicalFailures: failedNames(read('broad-unchanged')), cohorts, focused,
  validation: read('validation-summary').results, boundedProductDriftReruns: 0,
  host: Object.fromEntries(['source', 'compiled'].map(mode => [mode, { originalHost8: read(`after-host-${mode}`).rows.filter(row => row.cohort === 'original-host8').length, additionalStderr8: read(`after-host-${mode}`).rows.filter(row => row.cohort === 'stderr8').length, classification: read(`after-host-${mode}`).classification }])),
  primaryResearch: [
    { url: 'https://jqlang.org/manual/v1.7/', sections: ['Identity', 'infinite, nan, isinfinite, isnan, isfinite, isnormal', 'sort'], finding: 'Number representation and type are distinct from printing; object ordering compares sorted keys then values.' },
    { url: 'https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/builtin.jq', section: 'isfinite', finding: 'Numeric type and not isinfinite, including NaN; not JavaScript Number.isFinite.' },
    { url: 'https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv_aux.c', section: 'jv_cmp', finding: 'Array/object ordering recursively compares contents even for aliases; NaN ordering is not reflexive.' },
    { url: 'https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv.c', section: 'jv_equal', finding: 'Allocated same-reference identity short-circuits equality separately from ordering.' },
  ],
  boundaries: 'Only structured source and this new subtree edited. Canonical tests and old evidence read-only. No runtime dependencies, public TS API changes, shared contract changes, delegation, self-acceptance, full jq/shell parity, superiority, clean HEAD or 72-hour-work claim.' });
console.log('Audited', Object.keys(unchangedReviewer).length, 'reviewer files,', canonicalPaths.length, 'canonical tests,', Object.keys(frozen.manifest.historicalFiles).length, 'historical files; retained canonical30 match exactly.');
