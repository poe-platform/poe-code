# Independent STR02 ordered validation

Date: August 29, 2026. Role: independent validator, not fix author or publisher.

## Decision and scope

STR02 is functionally ready **only after the captured STR04 and metadata-order
prerequisites**, with the operational qualifications below. This is not publication
authorization, global string parity, a complete audit pass, or certification of a
future main-branch combination. STR05 remains unresolved and visibly failing.

The reviewed clone is
`/Users/kjopek/Workspace/poe-code-safejs-string-no-match-integrated`, frozen at
`afe59a77fa318acf72162a1970306147fdfc5428`. The author manifest is
`out/safejs-remediation/str-02-integration/manifest.json`, SHA-256
`13f5819bda5c21cc7e8c94d9e0dd69e27234b19c1eaac140c47b214688527eec`.

Only this new report is added to publishable working files. No production code,
test, existing report, original archive, or other clone was edited. No Git mutation
command, commit, push, branch creation, security research, LLM call, or guest I/O
was performed. Git **binary index immutability is not certified**, as explained
below; that qualification must accompany this result.

## Ordered provenance and exact delta

The three approved input manifests were hash-verified independently:

1. STR04, six separate prerequisite files:
   `b417b5e79962ee3f6fbcfcf85e23e6efbd4d50adf94411db113db24005654e5f`.
2. Metadata order, six separate prerequisite files:
   `fdc814b784fe91260513833d081f61af3297dbf616ae1b994926089d2f7052e3`.
3. STR02 input, five delta files:
   `91870e73fb885bef3067544ca238d6d915730cdbce56df374040baca7c54f45c`.

Read-only three-way reconstruction reproduced both prerequisite merges with zero
conflicts. The STR02 three-way reconstruction had **one overlapping hunk**, not
zero. The supplied resolution is exactly the post-prerequisite `string.ts` plus
`if (methodName === "match" && matches.length === 0) return null;` after the
cursor-aware global match collection. AST comparison changes only
`callMatchLikeMethod`; STR03 substitution, STR04 cursor handling, and split remain
unchanged. Metadata order and ARRAY/COLL behavior are prerequisites, not duplicated
STR02 fixes. No STR05 implementation is included.

The relevant `string.ts` SHA-256 values are deliberately distinct:

- Frozen Git base: `f836cb3508b1c9602f2d558cb68fdae9615d43d1b8da9504a62585cbd1b0981b`.
- Post-STR04/post-metadata STR02 application preimage:
  `95d643bfce0a5dbb56b0187a2e21ca5efca8ce2977f3de1331e5831f452dae67`.
- Reviewed STR02 postimage:
  `2696168fb53f438095045126d27813ef2750be20d5a0172f0c7cb1928621d4f7`.

All six test files, prior validator reports, and the original seven-qualification
test remain byte-identical to their approved captures. The author's old STR02 plan
is retained as an exact prefix with its ordered-integration appendix. All 133
author artifacts were hash-verified before and after the gates. No assertion,
native expectation, unsupported-flag boundary, skip, or failure was weakened.

## Original archive guard and native checks

Before any original payload read, the inventory metadata bootstrapped all **38**
`archiveReadPolicy.excludedPaths`, plus the entire archive `security/` directory.
The sole fresh original-payload allowlist entry was
`out/safejs-audit-2026-08-27/strings/reductions/r06-no-global-match.safejs`.
Exact membership, exclusion, path boundary, and realpath checks preceded access.
The source SHA-256 is
`5d7008596bfe91cbdf97d7486c854bd6f59b25a2edb131131aadb0032d505e3b`.
There were no recursive archive scans, original writes, or recorded excluded
payload reads, hashes, or executions. This is a record of this worker's operations,
**not an operating-system-wide access audit**.

The first guarded read was followed by a failed attempt to create an evidence
directory inside the immutable author capture. Nothing there was changed or
unsealed. A second guarded read copied the same allowlisted source into the new
ignored evidence directory. No Git exclude/config change was used to make it
ignored; the existing `tmp/` ignore rule applies.

Unchanged r06 first produced native `{ isNull: true, value: null }`, then matched
that complete typed result twice through the actual source package and twice
through freshly built `safejs/core`. The independent package test also checks the
unchanged source hash and full result.

The ten earlier workflow/binding cases were read only from the approved immutable
metadata capture, not freshly from the original archive. Their exact sources and
bindings were verified against captured provenance. Fresh native evaluation of all
ten matched the historical V8-serialized values. The byte-identical original
cohort test then passed every full typed output twice, including repeatable stats.
`structuredClone`, strict comparison, and V8 serialization preserve undefined and
array distinctions; JSON-only equality was not used to claim parity. No workflow
source was adapted to make it pass. Execution was bounded with empty module maps
and no guest I/O or LLM.

## Independent executions

All test runs used `env -u TERM`, snapshot playback, and snapshot-miss errors. RED
used a read-only Vite load override for the **post-prerequisite** `string.ts`, not a
production edit and not the raw Git base. The 1,842 full assertion identities match
the author's current run exactly and are identical between independent RED/GREEN.

| Gate                                           |  Pass | Fail | Skip | Scope                                    |
| ---------------------------------------------- | ----: | ---: | ---: | ---------------------------------------- |
| STR02 author cases, prerequisite-only RED      |    13 |    9 |    0 | Unchanged 22 cases                       |
| STR02 independent cases, prerequisite-only RED |   144 |   45 |    0 | Unchanged 189 cases                      |
| All six files, prerequisite-only RED           | 1,788 |   54 |    0 | STR04 and metadata controls remain green |
| STR02 current                                  |   211 |    0 |    0 | 22 author plus 189 independent           |
| STR04 current                                  | 1,439 |    0 |    0 | 412 author plus 1,027 independent        |
| Metadata current                               |   192 |    0 |    0 | 23 author plus 169 independent           |
| Combined focused current                       | 1,842 |    0 |    0 | Six unchanged package test files         |
| Relevant broader current                       | 3,212 |    0 |    0 | Exact 37-file selection                  |
| SafeJS package current                         | 6,560 |    0 |   39 | Exact package filter, 168 files          |
| Prior original workflows                       |    10 |    0 |    0 | Each full output evaluated twice         |
| Seven qualifications, prerequisite-only        |     6 |    1 |    0 | Exact single-file selection              |
| Seven qualifications, current                  |     6 |    1 |    0 | STR05 failure preserved                  |

These overlapping totals are not additive. The supported `g`, `i`, `m`, and `s`
matrix includes no-match, successful, empty-input, zero-width, repeated-call,
fallback, neighboring-operation, and literal-string controls. Unsupported `y` and
`gy` rejection expectations are unchanged. No broader descriptor/grammar parity is
claimed. The relevant broader selection covers STR03 substitutions, ARRAY named
properties, COLL iteration/typing, OBJ aliases, and MC regressions.

All **118 historically failed STR04 full-result cases** were matched by exact full
test name and independently passed. Historical nine ordering and six named-read
differences remain in the unchanged evidence; current full originals pass with
the prerequisite fixes. The old STR02 qualification result remains **one pass,
six failures** in its historical capture, not rewritten as a successful run.

The sole current qualification failure is unchanged:
`return "ab".split(/(a)?/);` produces spurious zero-width split/capture slots instead
of native `["", "a", "b"]`. Its strict test exits 1 both before and after STR02.
The separate legitimate undefined-capture control passes. STR05 must be repaired
and independently validated in its own scope; no fix or waiver is included here.

## Build, compiler, lint, and formatting gates

Workspace declarations were built before root/test type checks:

- `env -u TERM npm run build`: 67/67 workspace tasks successful, all cached, plus
  successful root generation, compilation, and bundle steps.
- `tsc -p out/safejs-remediation/str-02-ordered-validation/tmp/tsconfig.tests.json --noEmit`:
  pass. Saved `--showConfig` confirms nine explicit roots: six unchanged focused
  files, repaired COLL fixture, exact qualification test, and original cohort.
- `tsc -p packages/safejs/tsconfig.json --noEmit`: pass.
- `npm run lint:types`: pass.
- `npm run lint:eslint -- --ignore-pattern 'out/safejs-remediation/str-02-integration/**' --ignore-pattern 'out/safejs-remediation/str-02-ordered-validation/**'`:
  pass. Only evidence trees are excluded; no package source/test is excluded.
- `npm run lint:packages`: all 17 rules pass across 68 packages.
- Prettier check of all 17 distinct combined publishable paths, including this
  report and every prerequisite report: pass.
- `git diff --check`: pass.

Exact commands, exit statuses, file selections, compiler roots, logs, and assertion
results are retained with the frozen evidence. No repository-wide test success is
claimed. The intentionally selected SafeJS package run is separate from the
author's stopped, accidentally broadened run.

## Operational qualifications and publisher boundary

The author's `mergeConfig` include concatenation accidentally selected extra
repository tests. That owned run was stopped with SIGTERM and is **not a pass**.
Its log and account remain unchanged. This validator's qualification configurations
replace `test.include` and also pass the explicit exact file filter; both reports
confirm one file and seven tests. Recorded zero excluded access is not OS auditing.

Despite `GIT_OPTIONAL_LOCKS=0` and no intentional Git mutation command, `.git/index`
changed from `70574b88eeca3b5fa768fe95c0dd9f250e72988edbdf55c196a8b429a68cbd45`
to `6cd9c3fc8036bacf21f005cc93d35475eb5036fe66d97192c19c5ea7f0d641b2` during
validation. The cause is not established. All **3,749** staged path/mode/object
entries still exactly equal HEAD, the staged diff is empty, and HEAD/config/exclude
hashes are unchanged. No restoration was attempted. This is an explicit limit on
Git metadata immutability, not a hidden claim of full procedural compliance.

The STR02-only freeze contains the five author delta files plus this report. Its
top-level publishable list does not include the twelve prerequisite deliveries.
Separate prerequisite captures, their ordered preimages, STR02 post-metadata
application preimages, validation-entry preimages, and historical evidence are
reference-only. A logical post-prerequisite state is not represented as a Git
commit. The frozen candidate is under
`out/safejs-remediation/str-02-ordered-validation/tmp/candidate-afe59a77-str02-only`.

The publisher must compare actual target preimages, apply the approved order
STR04 → metadata → STR02, and run fresh independent/full gates on that actual
combination. A later STR05 or other `string.ts` merge needs fresh validation.
Neither future main bytes nor future full gates have been certified here.
