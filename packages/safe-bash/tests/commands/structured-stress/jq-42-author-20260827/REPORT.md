# Structured jq frozen-42 author handoff

Author-only checkpoint, August 27, 2026 UTC. A DIFFERENT independent review leaf is required next. This is not full jq parity, product completion, full-shell acceptance, superiority over just-bash, or 72 hours of work. The recorded baseline is 2026-08-27T00:33:21.492Z; the stable handoff recheck is 2026-08-27T00:51:23.284Z. These timestamps do not establish total work duration.

## Scope and commits

- Product source: `d1f78d43880c94300c0019b07a88110e9b3e8f08` (six structured TypeScript files only).
- Before-fix native/evidence freeze: `0b860ef363af8457e8ff164dcb49ca1e8a0a148d`.
- Additional native recovery/NUL controls, frozen before their followup fix: `3f7b1f3e6c275ff8f301406ff768e737f042c962`. These were captured after the initial 42 fix, not represented as pre-task evidence.
- Author regression, native recheck and validation evidence: `b962d4bdeed41ba53946cf6229a7a61a3485f4e9`. The report/replay-only commit follows it; its identity is available from Git history and the final external handoff.
- Initial working HEAD: `f06f2886300885c51a90cac0794a6a6d53be53fd`; latest pre-task structured source commit `4f9ce1e`. Numeric `73ed853` and quantifier `5356891` fixes were already present. No credit is claimed here for implementing those historical fixes.
- Only `src/commands/structured/**` and this new stress directory changed. Archive, network, shell, filesystem, root exports/config/docs, original tests and frozen matrices were not edited. No dependency installation or runtime dependency was added. Native jq/process execution exists only in test capture/verification, never product code; no eval wrapper.

## Original audit preserved; CURRENT classification

The immutable `96db59ac` handoff reports 42 exact-vector failures: 30 status/stdout differences plus 12 stderr-only. All 42 still failed against current source at initial inspection: **0 pass / 42 fail**. They now have **42 exact pass / 0 fail** with their original status/stdout/stderr byte vectors. They are not replaced by a selected subset.

Three rows remain malformed-input/program observations, counted normally: `fromjson`, `join-mixed`, `join-mixed:bytewise`. The latter two first exposed literal newline rejection in the filter, then require the native malformed-NUL-JSON diagnostic, not successful mixed-array output. Four additive rows are diagnostic-only precedence/probe outcomes, not new numeric serializer failures.

### Unicode decoding / low-surrogate replacement (17)

| Exact original ID | Before | After |
| --- | --- | --- |
| `raw-lone-continuation` | fail | exact pass |
| `raw-lone-continuation:bytewise` | fail | exact pass |
| `raw-truncated` | fail | exact pass |
| `raw-truncated:bytewise` | fail | exact pass |
| `raw-surrogate` | fail | exact pass |
| `raw-surrogate:bytewise` | fail | exact pass |
| `raw-overlong-slurp` | fail | exact pass |
| `raw-overlong-slurp:bytewise` | fail | exact pass |
| `raw-bad-continuation` | fail | exact pass |
| `raw-bad-continuation:bytewise` | fail | exact pass |
| `json-bad-string` | fail | exact pass |
| `json-bad-string:bytewise` | fail | exact pass |
| `json-truncated-string` | fail | exact pass |
| `json-truncated-string:bytewise` | fail | exact pass |
| `json-low-surrogate-escape` | fail | exact pass |
| `json-low-surrogate-escape:bytewise` | fail | exact pass |
| `raw-file-utf8-boundary` | fail | exact pass |

### Literal filter controls followed by malformed NUL JSON (2)

| Exact original ID | Before | After |
| --- | --- | --- |
| `join-mixed` | fail | exact pass |
| `join-mixed:bytewise` | fail | exact pass |

### Per-input recovery / generator / final status (11)

| Exact original ID | Before | After |
| --- | --- | --- |
| `recover-following-json` | fail | exact pass |
| `recover-following-json:bytewise` | fail | exact pass |
| `recover-following-json-exit` | fail | exact pass |
| `recover-following-json-exit:bytewise` | fail | exact pass |
| `recover-following-raw` | fail | exact pass |
| `recover-following-raw:bytewise` | fail | exact pass |
| `recover-internal-generator` | fail | exact pass |
| `recover-internal-generator:bytewise` | fail | exact pass |
| `pipe-error-recovery` | fail | exact pass |
| `runtime-error-last-false` | fail | exact pass |
| `runtime-error-last-empty` | fail | exact pass |

### Diagnostic-only in original audit (12)

| Exact original ID | Before | After |
| --- | --- | --- |
| `compare-mixed-double` | fail | exact pass |
| `scalar-types` | fail | exact pass |
| `preserve-through-copy` | fail | exact pass |
| `conversion-large-token` | fail | exact pass |
| `fromjson` | fail | exact pass |
| `separator-error-after-prefix` | fail | exact pass |
| `recover-final-error` | fail | exact pass |
| `recover-final-error:bytewise` | fail | exact pass |
| `parse-error-after-prefix` | fail | exact pass |
| `parse-error-after-prefix:bytewise` | fail | exact pass |
| `json-high-surrogate-escape` | fail | exact pass |
| `json-high-surrogate-escape:bytewise` | fail | exact pass |

Every row's exact argv, input hex, VFS files/pipeline stages, original expected bytes, pre-fix actual bytes and final actual bytes is in `REPORT.json`. `before.json` contains both complete affected cohorts, not only failures.

## Whole-cohort results (do not add overlapping rows)

| Cohort | Current pre-fix | Final current | Evidence |
| --- | --- | --- | --- |
| Original audit failure subset | 0/42 pass | 42/42 pass | before.json, root-fix.json |
| Complete independent native vectors | 117/155 pass, 38 fail | 155/155 pass | unchanged native/supplement vectors |
| Complete additive native vectors | 77/81 pass, 4 fail | 81/81 pass | unchanged four additive fixture files |
| Both complete affected cohorts | 194/236 pass, 42 fail | 236/236 pass | all rows retained |
| Immutable test gate, including two integrity checks | historical 196/238 pass | 238/238 pass | final-immutable.tap |
| New author native controls | frozen before source fix | 78/78 transport checks + 1 hash check | 39 native fixtures; native-before.json |
| Followup root-cause controls | 8/24 pass, 16 fail after first fix | 24/24 transport checks + 1 hash check | 12 fixtures; native-followup.json |
| New safety checks | not a native parity cohort | 10/10 | safety.test.ts |
| Combined new author test gate | not additive to full-owned gate | 114/114 | final-author.tap |
| Entire owned test trees, unchanged older expectations | first iteration 1392/1421; second 1399/1421 | 1439/1461 pass, 22 fail, 0 skip/cancel/TODO | final-owned.tap |
| Separate repeated safety gate | repeated, not unique coverage | 3 runs of 10/10 | final-safety-repeat-*.tap |
| Final immutable + author recheck | overlap with above | 352/352, exit 0 | handoff-recheck.json |
| Older raw-native corpus, native fields not policy overrides | no new pre-fix measurement | 74/74 exact; 74/74 chunk-invariant | legacy-current.json |
| Older join-native corpus | no new pre-fix measurement | 127/129 exact; 129/129 stdout/status; 129/129 chunk-invariant | legacy-current.json |
| Entire split-native cohort | historical 44/69 exact, 25 diagnostic-only | 67/69 exact, 2 diagnostic-only; 69/69 stdout/status | final-split.json |
| Built root-package import/execution | not an independent review | 6/6 exact | built-checks.json |

The historical 117/155, 77/81, 44/69, earlier numeric/quantifier observations and every matrix remain unchanged on disk. The full frozen audit remains **9,920 checks = 9,686 pass + 164 fail + 70 skip**, with its older initial **9,089/674/157** observation intact. The old 99 registry-preflight failures, 0/79 blocked required matrix, historical live 79/79 and pinned 71/79 observations are not recounted or reclassified by this leaf. No whole-repository npm-test run or new aggregate adapter matrix acceptance is claimed.

## Fixes and boundaries

- Replace malformed UTF-8 using the pinned jq sequence grouping, including overlong/surrogate/truncated input, file boundaries and lone low-surrogate JSON escapes. JSON remains byte-scanned for correct byte columns; high-surrogate escapes still error. Numeric lexemes retain Decimal identity through parsing, copying, sorting, joining and diagnostics; numbers.ts is unchanged.
- Accept literal control characters in filter strings as native jq does; retain JSON control-character rejection and native NUL/newline-dependent observations implicated by the malformed cohort. Existing grammar/features were not expanded.
- Recover ordinary filter errors at each top-level input, discard the rest of that input's generator, preserve prior output, then process later inputs. -e fallback uses the last successful invocation, not values emitted by an invocation that subsequently failed. Parse errors, quotas, cancellation and host failures remain fatal.
- Add source/line error context and native bounded value descriptions for implicated arithmetic, join, sort, unique and conversion errors. from_entries now iterates object values instead of rejecting all non-array containers; insertion order and exact numeric values are retained.
- Preserve early JSON output before EOF, awaited sink writes, signal-aware reads/writes, iterator closure and optional-filter quota protection. Only interpreter iteration errors are recoverable: a host sink throwing JqError does not resume the next input. Error diagnostics are bounded using maxOutputBytes and a 1,000-character message cap; these resource bounds are explicit virtual-profile differences, not unbounded native parity. Pending line diagnostics may wait for newline/EOF to preserve native line numbers while allowing early successful output.
- Limits bound work/data, but synchronous conversion/host work is not forcibly interruptible. This does not solve any shared first-read/head -n 0 lifecycle issue or authorize a shared lifecycle API.

## Remaining measured native gaps

All four below are outside the frozen42 and are **stderr-only**, not waived successes. Empty stdout is the empty hex string. Stderr is shown as a JSON-escaped UTF-8 string; REPORT.json retains exact stderrHex too. No unsupported/pending case is removed from a denominator.

| Cohort / ID | Exact argv; stdin hex | Native status / stdout hex / stderr UTF-8 escaped | Virtual status / stdout hex / stderr UTF-8 escaped |
| --- | --- | --- | --- |
| split 69: `generator-error-after-output` | `["-c","split((\",\", .missing))"]`; `22612c62220a` | 5; `5b2261222c2262225d0a`; `"jq: error (at <stdin>:1): Cannot index string with string \"missing\"\n"` | 5; `5b2261222c2262225d0a`; `"jq: error (at <stdin>:1): cannot index string with string\n"` |
| split 69: `generator-error-before-typecheck` | `["-c","split(.missing)"]`; `310a` | 5; ``; `"jq: error (at <stdin>:1): Cannot index number with string \"missing\"\n"` | 5; ``; `"jq: error (at <stdin>:1): cannot index number with string\n"` |
| join-native.json: `join-zero-arity` | `["-c","--","join"]`; `5b5d` | 3; ``; `"jq: error: join/0 is not defined at <top-level>, line 1:\njoin\njq: 1 compile error\n"` | 3; ``; `"jq: unsupported function join/0 at offset 4\n"` |
| join-native.json: `join-two-arity` | `["-c","--","join(\"-\";\":\")"]`; `5b5d` | 3; ``; `"jq: error: join/2 is not defined at <top-level>, line 1:\njoin(\"-\";\":\")\njq: 1 compile error\n"` | 3; ``; `"jq: unsupported function join/2 at offset 13\n"` |

These are the measured residuals in these supplementary cohorts, not an exhaustive list of jq differences. Existing unsupported grammar/features and other untested native diagnostics remain outside this bounded assignment.

## Why the entire owned test gate is still red

The following **22 immutable assertions** enforce the older strict-UTF8 / low-surrogate / NUL / stop-first-error profile, or its old UTF8 diagnostic label. Their tests and original bytes were preserved, not rebaselined to green. The native 74-case raw cohort separately passes all original native expected fields. Root/independent review must decide how to retain historical characterization versus active native-compatibility acceptance; this author has not rewritten them.

- strict UTF-8 rejection remains chunk invariant (not native parity): raw-lone-continuation
- strict UTF-8 rejection remains chunk invariant (not native parity): raw-truncated
- strict UTF-8 rejection remains chunk invariant (not native parity): raw-bad-continuation
- strict UTF-8 rejection remains chunk invariant (not native parity): json-bad-string
- raw native: record-error-prefix
- raw native: file-unicode:-Rc
- raw native: file-unicode:-Rsc
- raw native: invalid:0:-Rc
- raw native: invalid:0:-Rsc
- raw native: invalid:1:-Rc
- raw native: invalid:1:-Rsc
- raw native: invalid:2:-Rc
- raw native: invalid:2:-Rsc
- raw native: invalid:3:-Rc
- raw native: invalid:3:-Rsc
- raw native: invalid:4:-Rc
- raw native: invalid:4:-Rsc
- strict malformed JSON 14 across chunk boundaries
- strict malformed JSON 16 across chunk boundaries
- invalid UTF-8 never becomes replacement text
- malformed UTF-8 preserves completed JSON prefix across every chunk split
- valid large decimals survive while malformed JSON and division by zero fail

## Native oracle, primary research and preservation

- Executable `/usr/bin/jq`, `jq-1.7.1-apple`, SHA-256 `1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f`. Build flags and environment are in native-before.json/native-reverification.json. Locale C, TZ UTC, PATH /usr/bin:/bin, isolated HOME/cwd; bounded argv-safe child execution, no shell and no external uploads. Temporary directories are removed after each invocation.
- Before source changes, all **236 original whole-cohort vectors** matched the retained native bytes (241 fixture processes because five pipeline cases have two stages), and **39 new controls** were frozen (39 processes), plus two metadata calls. The separate followup freeze contains 12 native fixture processes.
- Final native reverification checks cohorts separately: 236/236 (241 fixture processes), 39/39, 12/12, 74/74 and 129/129, plus two metadata calls. These overlapping datasets are not summed as unique coverage. The first reverification attempt stopped at the older helper's filename allowlist; a new leaf-owned bounded helper handles legacy fixture names without editing the immutable helper.
- Primary research uses the official jq 1.7 manual and tagged jq-1.7.1 builtin.c, builtin.jq, jv_unicode.c, jv_parse.c, main.c and util.c. Resource URLs, fetch times and byte hashes are in primary-references.json. The native Apple executable, not an assumed upstream build, determines exact expectations.
- native-before.json SHA-256: `5590f623d2eb0e70b8e865ad2b3e558ca278a9efd17ccb8113eba1b68409977e`. native-followup.json SHA-256: `0ea0cb65c0a93715af8a63d185aea63b03c52f4445ff1487ca7bf2595921be83`. Integrity tests enforce both.
- Validation compares **170 existing structured test/audit files** against commit 96db59ac: **170 unchanged, zero rewritten**. Per-path hashes are in validation.json. Historical native-corpus files, comparison matrices, handoff and audit observations remain immutable.

## Source and shared-tree provenance

Structured scoped digest (JSON of sorted path/hash pairs, including README): `6783a44db8b06e86b91010824893f0afd7ea0d6ff0fa985aeea77277f6fd8d23`. All nine product TypeScript files plus README were identical before and after final validation.

| Owned source path | SHA-256 |
| --- | --- |
| `src/commands/structured/README.md` | `5fecf1186d9004e378d77a1e9ad297af94b4f4f9070d9b620d70cd179a7e1b00` |
| `src/commands/structured/index.ts` | `f2842b616b322081023e6091492bf7acb2231dcb2c729e0f376e125271cd0415` |
| `src/commands/structured/input.ts` | `1ac8e520cf80237a45a275d6fa55ad035b6ec0b83dae91765a7d77818ab2d935` |
| `src/commands/structured/interpreter.ts` | `8239b8342f57a2f30a5c71c9207955e545fdd2af52e04dd3db11508187a0da37` |
| `src/commands/structured/jq.ts` | `59239e32576e8f88d5ef49980c713ddb070468518800f16b5e2aa16a0520fb02` |
| `src/commands/structured/limits.ts` | `9919a0c0de44c08a9c63c977f7dc8a6d7319f4111cb37c7f3b249fbfd07743fe` |
| `src/commands/structured/numbers.ts` | `f2f18b3f201b22f560b9022304235ca26084319ca103a954f1aabb5f0f74be7d` |
| `src/commands/structured/parser.ts` | `5673072aa6512c4fcbc6b008ab9ee595a9b0555c6c35ccf93fc3bb45c57d0ff8` |
| `src/commands/structured/split.ts` | `b70b49daa93f472871799159c9702279c6e83d8a4ff2734d86024249a8ee35f6` |
| `src/commands/structured/values.ts` | `b7764b6333525b44875aa76f4e9bb546f1b655b91a7dda52360498574c4c6222` |

The full owned validation window was 2026-08-27T00:46:54.672Z to 2026-08-27T00:47:07.666Z. The structured scope was stable, but **src/shell/input.ts and src/shell/runtime.ts changed concurrently**. Thus those results do not certify a single frozen full runtime. No shell capture workaround was added. The later **352/352** handoff rerun and fresh global typecheck have equal full-runtime before/after maps at HEAD `0c4709fa8ca55b4e0414219ee5e3a57a59418fc7`, digest `abc33f4fe923f7bee9d3d83a73b3b485448f11f401e24716d951c8edaf1cbe25`; this is still a moving shared working tree, not a clean committed-HEAD/full-product validation. The broader 1,461-check run is not retroactively assigned to that later snapshot.

## Validation commands and counts

Commands run by validate.mjs (full argv and timestamps retained in validation.json):

- `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/commands/structured-stress/independent-increment/native-regressions.test.ts tests/commands/structured-stress/independent-increment/additive-regressions.test.ts` — exit 0; 238/238 pass, 0 fail.
- `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/commands/structured-stress/jq-42-author-20260827/native.test.ts tests/commands/structured-stress/jq-42-author-20260827/followup.test.ts tests/commands/structured-stress/jq-42-author-20260827/safety.test.ts` — exit 0; 114/114 pass, 0 fail.
- `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/commands/structured/**/*.test.ts tests/commands/structured-stress/**/*.test.ts` — exit 1; 1439/1461 pass, 22 fail.
- `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/commands/structured-stress/jq-42-author-20260827/safety.test.ts` — exit 0; 10/10 pass, 0 fail.
- `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/commands/structured-stress/jq-42-author-20260827/safety.test.ts` — exit 0; 10/10 pass, 0 fail.
- `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/commands/structured-stress/jq-42-author-20260827/safety.test.ts` — exit 0; 10/10 pass, 0 fail.
- `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --import tsx tests/commands/structured-stress/final-increment/split-report.ts` — exit 0.
- `npm run build` — exit 0.
- `npm run typecheck` — exit 0.
- `node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/commands/structured/index.ts src/commands/structured/input.ts src/commands/structured/interpreter.ts src/commands/structured/jq.ts src/commands/structured/limits.ts src/commands/structured/numbers.ts src/commands/structured/parser.ts src/commands/structured/split.ts src/commands/structured/values.ts tests/commands/structured/cli.test.ts tests/commands/structured/hazard-worker.ts tests/commands/structured/helpers.ts tests/commands/structured/oracle.test.ts tests/commands/structured/resources.test.ts tests/commands/structured/semantics.test.ts tests/commands/structured/streaming.test.ts tests/commands/structured-stress/cases.ts tests/commands/structured-stress/corpus.test.ts tests/commands/structured-stress/corpus.ts tests/commands/structured-stress/final-increment/fresh-interop.test.ts tests/commands/structured-stress/final-increment/fresh.test.ts tests/commands/structured-stress/final-increment/split-report.ts tests/commands/structured-stress/harness.ts tests/commands/structured-stress/independent-increment/additive-regressions.test.ts tests/commands/structured-stress/independent-increment/diagnose.ts tests/commands/structured-stress/independent-increment/harness.ts tests/commands/structured-stress/independent-increment/native-regressions.test.ts tests/commands/structured-stress/independent-increment/numeric-fixes.test.ts tests/commands/structured-stress/independent-increment/numeric-safety.test.ts tests/commands/structured-stress/independent-increment/numeric-worker.ts tests/commands/structured-stress/independent-increment/phase2-harness.ts tests/commands/structured-stress/independent-increment/phase2-report.ts tests/commands/structured-stress/independent-increment/quantifier-fixes.test.ts tests/commands/structured-stress/independent-increment/safety.test.ts tests/commands/structured-stress/join-safety.test.ts tests/commands/structured-stress/join.test.ts tests/commands/structured-stress/jq-42-author-20260827/followup.test.ts tests/commands/structured-stress/jq-42-author-20260827/native.test.ts tests/commands/structured-stress/jq-42-author-20260827/report.ts tests/commands/structured-stress/jq-42-author-20260827/safety.test.ts tests/commands/structured-stress/jq-42-independent-review/evidence.test.ts tests/commands/structured-stress/jq-42-independent-review/harness.ts tests/commands/structured-stress/jq-42-independent-review/review.ts tests/commands/structured-stress/pipelines.test.ts tests/commands/structured-stress/raw-input-safety.test.ts tests/commands/structured-stress/raw-input.test.ts tests/commands/structured-stress/regressions.test.ts tests/commands/structured-stress/regressions.ts tests/commands/structured-stress/safety.test.ts tests/commands/structured-stress/split-increment/capture-native.ts tests/commands/structured-stress/split-increment/command.test.ts tests/commands/structured-stress/split-increment/evidence.ts tests/commands/structured-stress/split-increment/helper.test.ts tests/commands/structured-stress/split-increment/interop.test.ts tests/commands/structured-stress/split-increment/replay-original-matrix.ts tests/commands/structured-stress/split-increment/verify.ts tests/commands/structured-stress/verify-native.ts` — exit 0.

Additional commands:

- `node --import tsx tests/commands/structured-stress/jq-42-author-20260827/report.ts before`, then `first-fix`, then `root-fix`: 236-vector reports, respective original42 counts 0/42, 42/42, 42/42. Each output uses a distinct filename.
- `node tests/commands/structured-stress/jq-42-author-20260827/capture.mjs`: original 236 plus 39 author native controls, before product edits; first attempt stopped on a pipeline-spec shape mismatch before saving, corrected only the new capture script.
- `node tests/commands/structured-stress/jq-42-author-20260827/followup.mjs`: 12 native controls before their followup fix; followup.test.ts initially 8/24, finally 24/24 (plus later integrity check).
- `node --import tsx tests/commands/structured-stress/jq-42-author-20260827/legacy-report.ts`: 74 raw and 129 join vectors, whole/bytewise transports, native fields only, no policy-expectation mutation.
- `node tests/commands/structured-stress/jq-42-author-20260827/verify-native.mjs`: native cohort recheck, seven official primary-source fetches, built package 6/6. Use `--verify` for read-only replay; record mode refuses overwrites.
- The final handoff recheck uses the same immutable and author test files in one node:test invocation (352/352), followed by `npm run typecheck` (exit 0); exact output and full-runtime before/after hashes are in handoff-recheck.json.
- `npm run build`, global `npm run typecheck`, and scoped strict TypeScript compilation all exit 0 at final validation. Earlier typechecks caught owned typing issues (fixed) plus unowned entry-comparison and invocation-closure test errors, later resolved by other workers; this leaf did not edit those files.
- `git diff --check -- src/commands/structured` passes. Generated TAP logs preserve diagnostic whitespace rather than being formatted as source. Three new safety repetitions pass without unhandled rejection, cancellation residue, native children or test servers left running.

For non-mutating full owned replay use `node tests/commands/structured-stress/jq-42-author-20260827/validate.mjs --verify`. It intentionally reports the unchanged 22 historical-policy failures; a successful orchestration is not a green entire-owned test gate.

## API/docs handoff and stop boundary

No public export, plugin option, command registration, package/API name or dependency changed. Existing default structured installation remains unchanged. No root files were touched. Curie owns root integration/documentation: retain historical statements but append this new author checkpoint and the 22 legacy-test conflicts. In particular, src/commands/structured/README.md:460 describes strict UTF8/stop-first-error as the earlier state; do not present it as current after this source commit.

Independent review is **pending**, not self-certified. A different leaf should review source d1f78d4 and frozen 236 + 39 + 12 vectors, exercise bounds/cancellation/byte-split cases, check the four measured residual diagnostics and the 22 incompatible old assertions, and pin the shared runtime used for any pipeline claims. No new shared bug is established by this assignment; the concurrent shell paths belong to Sagan. Root docs/API integration belongs to Curie; archive production/stress belongs solely to Dirac and was not edited.
