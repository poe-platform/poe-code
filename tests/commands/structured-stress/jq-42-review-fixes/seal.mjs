import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { artifact } from './artifacts.mjs';
import { auditCommit, digest, git, sourceSnapshot } from '../jq-42-independent-review/common.mjs';

const directory = 'tests/commands/structured-stress/jq-42-review-fixes';
const read = name => JSON.parse(readFileSync(`${directory}/${name}`));
const main = read('final-main.json');
const beforeLegacy = read('before-legacy.json').results.filter(row => row.route === 'direct' && row.transport === 'whole');
const legacy = read('final-legacy.json').results.filter(row => row.route === 'direct' && row.transport === 'whole');
const diagnosticOnly = legacy.filter(row => !row.pass && row.differingFields.length === 1 && row.differingFields[0] === 'stderrHex');
const acceptance = legacy.filter(row => row.differingFields.includes('status') || row.differingFields.includes('stdoutHex'));
assert.equal(acceptance.length, 6);
assert.equal(diagnosticOnly.length, 43);
const originalFailures = [...readFileSync('tests/commands/structured-stress/jq-42-author-20260827/final-owned.tap', 'utf8').matchAll(/^not ok \d+ - (.*)$/gmu)].map(match => match[1]).sort();
const currentFailures = [...read('final-owned.json').stdout.matchAll(/^not ok \d+ - (.*)$/gmu)].map(match => match[1]).sort();
assert.deepEqual(currentFailures, originalFailures);
const auditPaths = git(['ls-tree', '-r', '--name-only', auditCommit, 'tests/commands/structured', 'tests/commands/structured-stress', 'benchmarks/reports/current-integration']).toString().trim().split('\n');
const reviewPath = 'tests/commands/structured-stress/jq-42-independent-review';
const reviewCommit = '8eb2c80351b212224df15eb9d75e02036ac60cb9';
const reviewPaths = git(['ls-tree', '-r', '--name-only', reviewCommit, reviewPath]).toString().trim().split('\n');
const verify = (paths, commit) => paths.map(path => {
  const sha256 = digest(readFileSync(path));
  assert.equal(sha256, digest(git(['show', `${commit}:${path}`])), path);
  return { path, sha256 };
});
const audit = verify(auditPaths, auditCommit);
const review = verify(reviewPaths, reviewCommit);
const immutable = read('immutable-before.json');
const allPriorEvidence = verify(Object.keys(immutable.files), immutable.head);
const runs = readdirSync(directory).filter(name => name.startsWith('final-') && name.endsWith('.json')).map(name => {
  const data = read(name);
  assert.equal(data.before.structuredSha256, '30c573976d4dddb5e8e545f8e3914aeb166e0232f92ed0dfe20514205056db8f');
  assert.equal(data.after.structuredSha256, data.before.structuredSha256);
  return { name, sha256: digest(readFileSync(`${directory}/${name}`)), structuredStable: data.structuredStable, productStable: data.productStable, beforeHead: data.before.head, afterHead: data.after.head, productBefore: data.before.productSha256, productAfter: data.after.productSha256, status: data.status, summary: data.summary, counts: data.stdout ? Object.fromEntries([...data.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])])) : undefined };
});
const source = sourceSnapshot();
const sourceCommit = '0278a3032d7851de4c2f5141bbc863cdf310c39d';
const sourceFiles = Object.keys(source.files).filter(path => path.startsWith('src/commands/structured/'));
verify(sourceFiles, sourceCommit);
const report = {
  role: 'structured jq fix author leaf; not independent verification or acceptance', recordedAt: new Date().toISOString(),
  sourceCommit, evidenceBeforeCommit: '8aaf610d26e8dc310bf6ac1f713cf2614cc1120e', priorAuthorCommit: 'd1f78d43880c94300c0019b07a88110e9b3e8f08', independentFailCommit: reviewCommit,
  source, nativeFreezeSha256: digest(readFileSync(`${directory}/native-frozen.json`)), main: main.summary,
  beforeLegacy: { exact: 41, diagnostics: 47, acceptance: 6 }, afterLegacy: { exact: 45, diagnostics: diagnosticOnly.length, acceptance: acceptance.length },
  closedLegacy: legacy.filter(row => row.pass && !beforeLegacy.find(before => before.id === row.id).pass).map(row => row.id),
  remaining: legacy.filter(row => !row.pass), originalFailures, currentFailures, audit, review, allPriorEvidence, runs,
};
artifact('REPORT.json', report);
const code = text => `\`${text.replaceAll('|', '&#124;').replaceAll('`', '&#96;')}\``;
const bytes = hex => code(JSON.stringify(Buffer.from(hex, 'hex').toString()));
const rows = legacy.filter(row => !row.pass).map(row => `| ${code(row.id)} | ${code(JSON.stringify(row.argv))} | ${code(row.inputHex)} | ${row.expected.status}; ${bytes(row.expected.stdoutHex)}; ${bytes(row.expected.stderrHex)} | ${row.actual.status}; ${bytes(row.actual.stdoutHex)}; ${bytes(row.actual.stderrHex)} |`).join('\n');
artifact('REMAINING.md', `# Remaining native gaps: unchanged independent probes\n\nAuthor replay on source ${sourceCommit}. These 49 distinct vectors comprise 43 diagnostic-only gaps and six status/stdout acceptance gaps. Each fails identically on direct/Shell and whole/bytewise delivery: 196 failing executions of 376, with 180 exact executions (45/94 vectors). No expectations changed.\n\nAll bytes, including expected/actual hexadecimal stderr, are authoritative in final-legacy.json; table strings are JSON-escaped UTF-8 displays. Input hex has no implicit newline. Each argv is the literal argv passed to jq. Native executable/version/hash is pinned in REPORT.md and the immutable independent legacy-native-proof.json.\n\n| Probe | argv | Exact input hex | Native: status; stdout; stderr | Virtual: status; stdout; stderr |\n| --- | --- | --- | --- | --- |\n${rows}\n`);
const reportText = `# Structured jq bounded fix-author handoff

This is author evidence, not independent acceptance. The independent FAIL report
at ${reviewCommit} remains immutable. A different reviewer must rerun after this
handoff. No child agents were spawned; no active children remain.

## Source and evidence identity

- Before-source evidence/regression commit: ${report.evidenceBeforeCommit}.
- Source-only fix commit: ${sourceCommit} (jq.ts and input.ts only).
- Prior author source: ${report.priorAuthorCommit}; earlier evidence b962d4b and
  report 565638a remain unchanged, including historical original42 0/42.
- Structured before SHA-256: 66dc67c31edcaf32c63b635b0d559545894ab83751b677750494fa16001ced9c.
- Structured after SHA-256: ${source.structuredSha256}.
- Fresh source hash uses the unchanged independent common.mjs sourceSnapshot().
  REPORT.json records per-file hashes and each run's complete product identity.
- Native /usr/bin/jq, jq-1.7.1-apple, executable SHA-256
  1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f.
- New native freeze SHA-256: ${report.nativeFreezeSha256}.
  52 cases, 53 native invocations including version; frozen before source edits.
  Cases cover missing/mismatched object/array values, trailing commas, missing
  colon, nested/empty/valid controls, Unicode-key byte columns, newline positions,
  and the exact two-error recovery input. Modes: JSON-string fromjson, raw-slurp
  fromjson, plus nine raw JSON-parser controls. Native is test-only, never product.

## Fixes

1. Diagnostic flush marks host write failure as fatal regardless of thrown type.
   The outer reporting catch immediately rethrows it by identity, without another
   diagnostic write. Attempted queue entries are consumed in finally, preventing
   replay of successful earlier writes. Interpreter-only per-record recovery,
   cancellation, input cleanup and output quotas remain separate and tested.
2. The recursive JSON parser recognizes closing delimiters according to the
   current value/key/colon/separator context and consumes the offending byte
   before constructing its error. This fixes fromjson location/message handling
   generally within those contexts, without hardcoded input or diagnostic rewrites.
   No number grammar, BOM acceptance, shell, FS, archive or shared API change.

## Measured before / after

| Cohort | Before | After |
| --- | ---: | ---: |
| Main unchanged independent replay | 788/790; 255/256 vectors | 790/790; 256/256 vectors |
| Original42 subset | 42/42; 84/84 executions | 42/42; 84/84 executions |
| Whole historical independent | 155/155; 310/310 | 155/155; 310/310 |
| Whole historical additive | 81/81; 162/162 | 81/81; 162/162 |
| Reviewer20 | 19/20; 316/318 | 20/20; 318/318 |
| Unchanged independent fatal-boundary tests | 4/7 | 7/7, repeated three times |
| New typed-sink boundaries | 0/6 | 6/6, repeated three times |
| Nearby source tests, direct/Shell | 22/104 test cases | 104/104; 882 exact executions |
| Built-package nearby direct replay | not run | 52/52; 441/441 exact executions |
| Unchanged independent legacy probes | 41 exact / 47 diagnostic / 6 acceptance | 45 exact / 43 diagnostic / 6 acceptance |

The 882 source and 441 built nearby executions include whole, bytewise, and every
interior byte split; they overlap the original failure vector and are not added
to the 790 denominator. The initial red test aggregate was 26/117; after fix
117/117. No early failing test's unexecuted chunk variants are counted as passes.
The main runner imports read-only loadEvidence() and the public harness; it never
calls the reviewer CLI or writes any report inside the independent directory.
Frozen number lexemes/order and all 20 reviewer controls remain exact.

## Validation and unchanged failures

- Original author combined suite: 114/114 (includes its 10 safety tests).
- The same 10 author safety tests separately repeat 3 times: 30/30. Alongside
  seven unchanged boundary tests and six new boundary tests: 69/69 executions.
- Historical native/additive node:test cohort: 238/238, includes evidence checks.
- Nearby plus new/existing evidence checks: 110/110.
- Broad structured run: 1558/1580, exactly the same 22 named historical failures
  as author 1439/1461; no skip, cancellation, expectation rewrite or green forcing.
- Build and both global typechecks exit 0, including the final new evidence tests.
- All ${audit.length} historical audit paths match ${auditCommit}; all
  ${review.length} independent-review paths match ${reviewCommit}; all
  ${allPriorEvidence.length} existing structured evidence paths match the captured
  committed baseline. New native evidence is separately hash-pinned by a test.

Do not blanket-label the 22 failures stale: the prior independent analysis found
20 first-failure causes from non-native rejection/recovery expectations and two
old-regex failures with real remaining EOF diagnostics. Only 17 were explicitly
policy-labeled. Composite assertions also contain native gaps. This fix closes
resource-json-6 (missing object value), resource-json-12 (array trailing comma),
resource-json-13 (object trailing comma), and review-fromjson-two-error-records;
the 94-probe replay improves from 164/376 to 180/376 exact executions, not parity.

## Remaining exact repros

REMAINING.md contains every one of the 49 remaining vectors as a literal argv,
input-hex, native/actual status/stdout/stderr table; final-legacy.json retains all
94 probes and all four route/transport executions without normalization.

All six acceptance differences remain under argv ["-c","."]:

| Exact input hex (text) | Native status / stdout | Virtual status / stdout |
| --- | --- | --- |
| 4e614e (NaN) | 0 / null\\n | 5 / empty |
| 496e66696e697479 (Infinity) | 0 / 1.7976931348623157e+308\\n | 5 / empty |
| 2d496e66696e697479 (-Infinity) | 0 / -1.7976931348623157e+308\\n | 5 / empty |
| 3031 (01) | 0 / 1\\n | 5 / empty |
| 312e (1.) | 0 / 1\\n | 5 / empty |
| efbbbf30 (UTF-8 BOM + 0) | 0 / 0\\n | 5 / empty |

Native stderr is empty in these six; virtual stderr is Invalid numeric literal
at line 1 and columns 3, 8, 9, 2, 2, 4 respectively, with jq parse-error prefix.
The full exact bytes remain in the tables/JSON, not an accepted dialect exception.
The other 43 failures include all four supplementary join-arity/split-index
diagnostics, EOF numeric/literal diagnostics, raw JSON [} streaming-scanner
diagnostics, and null-input division/modulo diagnostic wording/location. The
raw scanner [} diagnostic is deliberately still listed, not conflated with the
fixed fromjson recursive-parser case or silently expanded into another repair.

## Scope and reproduction

Use node --import tsx ${directory}/replay.mjs NAME main for the 790 replay, legacy
for all 94 frozen probes, or nearby-built after npm run build. NAME must be new:
artifacts are append-only apply_patch additions. Use node --import tsx --test on
nearby.test.ts/boundaries.test.ts/evidence.test.ts for targeted regressions.
run-command.mjs records strict-unhandled-rejection command results in this owned
directory. REPORT.json records exact commands' individual result artifacts.

Only owned source and this new test/evidence subtree are committed. Root exports,
package/dependencies, docs, archive, FS, shell and all earlier tests are untouched.
Other workers' product changes remain outside this assignment; individual source
and tooling snapshots are recorded, not a clean committed-HEAD or ABA guarantee.
This bounded checkpoint does not establish full jq parity, project completion,
72 hours of work, or superiority over just-bash.
`;
artifact('REPORT.md', reportText);
console.log(JSON.stringify({ auditPaths: audit.length, reviewPaths: review.length, allPriorEvidence: allPriorEvidence.length, main: main.summary.total, legacy: report.afterLegacy, perRunProductStable: runs.every(run => run.productStable), distinctProductHashes: [...new Set(runs.map(run => run.productBefore))] }, null, 2));
