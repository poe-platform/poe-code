# Structured jq bounded fix-author handoff

This is author evidence, not independent acceptance. The independent FAIL report
at 8eb2c80351b212224df15eb9d75e02036ac60cb9 remains immutable. A different reviewer must rerun after this
handoff. No child agents were spawned; no active children remain.

## Source and evidence identity

- Before-source evidence/regression commit: 8aaf610d26e8dc310bf6ac1f713cf2614cc1120e.
- Source-only fix commit: 0278a3032d7851de4c2f5141bbc863cdf310c39d (jq.ts and input.ts only).
- Prior author source: d1f78d43880c94300c0019b07a88110e9b3e8f08; earlier evidence b962d4b and
  report 565638a remain unchanged, including historical original42 0/42.
- Structured before SHA-256: 66dc67c31edcaf32c63b635b0d559545894ab83751b677750494fa16001ced9c.
- Structured after SHA-256: 30c573976d4dddb5e8e545f8e3914aeb166e0232f92ed0dfe20514205056db8f.
- Fresh source hash uses the unchanged independent common.mjs sourceSnapshot().
  REPORT.json records per-file hashes and each run's complete product identity.
- Native /usr/bin/jq, jq-1.7.1-apple, executable SHA-256
  1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f.
- New native freeze SHA-256: dd7a8d16d32ed2083e2fef49de2f9b59471aeb6b0ebe6959b38e3a42d7b35743.
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
- All 170 historical audit paths match 96db59ac7d355d1a94422634b4c4f53d00932ad9; all
  28 independent-review paths match 8eb2c80351b212224df15eb9d75e02036ac60cb9; all
  139 existing structured evidence paths match the captured
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
| 4e614e (NaN) | 0 / null\n | 5 / empty |
| 496e66696e697479 (Infinity) | 0 / 1.7976931348623157e+308\n | 5 / empty |
| 2d496e66696e697479 (-Infinity) | 0 / -1.7976931348623157e+308\n | 5 / empty |
| 3031 (01) | 0 / 1\n | 5 / empty |
| 312e (1.) | 0 / 1\n | 5 / empty |
| efbbbf30 (UTF-8 BOM + 0) | 0 / 0\n | 5 / empty |

Native stderr is empty in these six; virtual stderr is Invalid numeric literal
at line 1 and columns 3, 8, 9, 2, 2, 4 respectively, with jq parse-error prefix.
The full exact bytes remain in the tables/JSON, not an accepted dialect exception.
The other 43 failures include all four supplementary join-arity/split-index
diagnostics, EOF numeric/literal diagnostics, raw JSON [} streaming-scanner
diagnostics, and null-input division/modulo diagnostic wording/location. The
raw scanner [} diagnostic is deliberately still listed, not conflated with the
fixed fromjson recursive-parser case or silently expanded into another repair.

## Scope and reproduction

Use node --import tsx tests/commands/structured-stress/jq-42-review-fixes/replay.mjs NAME main for the 790 replay, legacy
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
