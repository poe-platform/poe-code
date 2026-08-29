# OBJ-001 — independent alias-preservation validation

## Scoped verdict

READY for publisher integration of OBJ-001 only. Independently observed August 29, 2026 at 04:30 UTC (August 28, 2026 in America/Chicago). This is not the author Wegener's validation, a publication approval after integration, or completion of the broader remediation.

- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-object-aliases`; existing main HEAD `bc85287c08cfa8796af80c76d0dd8dd2ddf7347b`.
- Read ancestor `/Users/kjopek/Workspace/AGENTS.md` and clone-root `AGENTS.md`; no nested package/docs instructions found. Delegated validator performed the assigned work directly, without further delegation.
- Frozen author paths were read-only throughout. No production, README, master plan, Git state, or other clone was edited. No commit, push, install, branch, stash, or reset.
- Authored only `packages/safejs/src/interp/globals/object-aliases-validation.test.ts`, this document, and evidence below `out/safejs-remediation/obj-001-validation/`, using apply_patch. Unit tests perform no filesystem writes or reads; no memfs fixture is needed. Existing tests retain their existing filesystem abstractions.

## Reproduction and independent checks

1. Bootstrap inherited archive exclusions before original payload reads; verify all frozen author hashes and the 10,482-byte production preimage from Git in memory.
2. Read only explicitly allowlisted original files; independently run nine native children and compare complete outputs with immutable original expected objects.
3. Add 19 independent tests, including all nine original cases. Run against the exact production preimage using a programmatic Vite load hook that replaces only the target module in memory. Never overwrite the working production file.
4. Run the same tests against current TypeScript, with frozen author tests and relevant regressions. Check package types, types including both new test files, ESLint, Prettier, and whitespace.
5. Replay nine originals in separate bounded current-TypeScript children. Freeze this five-file candidate, base preimage and exact manifest; publisher must perform clean three-way integration and independent merged-tree revalidation.

## Scope and findings

- All nine original full outputs match: normal and mutated substantial projection; entries, values, and manually paired fromEntries identity reductions; FE01–FE04. Six physical files contain five distinct source bodies. FE01 repeats the substantial mutation workflow; it is not an additional independent algorithm.
- FE02–FE04 use hand-built pair arrays without entries/values preprocessing. Their source/pair/array aliases are checked before conversion, output identities after return, and all source/pair/result mutation observations against complete original expected objects.
- Four new entries/values cases cover ordinary records and dense arrays. Pre-call aliases are captured before invocation. Source and result nested mutations propagate in both directions; each call produces independent outer arrays and entry pairs. Property replacement/addition/deletion and array growth after invocation do not retroactively change captured membership. Arrays remain dense; no sparse case is added.
- A new direct fromEntries control verifies last-duplicate selection, distinct overwritten values, repeated-call fresh objects, retained nested arrays, later pair-key/value replacement and appended pairs, and output property replacement/deletion without rewriting inputs or another result.
- Explicit structuredClone and JSON round-trips still detach from the original. StructuredClone preserves repeated references within its copy; JSON does not. Subsequent Object transforms preserve references within each copied graph, without reconnecting the original.
- Host binding copies are independently repeated across two guest runs. Ordinary synchronous host module arguments/results remain detached in both directions. Explicit deepCopyToSandbox/deepCopyFromSandbox copies remain separate across repeated copies while preserving aliases inside each graph. The fromEntries null-prototype invariant remains intact.
- Static inspection confirms allocateProducedSandboxValue budgets and returns the same value. Only three Object result wrappers changed; fromEntries normalizes the fresh outer object's prototype. Existing copy helpers, JSON, structuredClone and host-boundary code are unchanged. Existing budget checks pass.
- OBJ-002 sparse clone/checkpoint and OBJ-003 Map/generator input support remain PENDING. No feature credit, closure claim or newly authored test coverage is assigned to either issue.

## Exact validation ledger

All command argv, supplied stdin, exit statuses, signals, and complete stdout/stderr are retained in the named JSON records under `out/safejs-remediation/obj-001-validation/`. These are inert records, not a QA executable. This document is the QA procedure.

| Gate                                                    | Final result                                                                 | Evidence                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------- |
| Fresh standalone native original children               | 9/9 full matches, exit 0, empty stderr, no signals                           | `original-native.json`        |
| In-memory exact-base RED                                | 18 failed / 1 passed / 19; exactly one preimage module load; expected exit 1 | `independent-red-final.json`  |
| Frozen current-TS focused tests                         | 40/40, 2 files (independent 19 + author 21), exit 0                          | `focused-green-final.json`    |
| Relevant broader regressions                            | 782/782, 10 files, 2.29s, exit 0                                             | `relevant-broader-final.json` |
| Fresh standalone current-TS original children           | 9/9 full matches, all ok:true, exit 0, empty stderr, no signals              | `original-current-ts.json`    |
| Package TypeScript                                      | exit 0                                                                       | `static-checks-final.json`    |
| TypeScript compiler API including both alias test files | 0 diagnostics, exit 0                                                        | `static-checks-final.json`    |
| ESLint, Prettier, git diff --check                      | all exit 0                                                                   | `static-checks-final.json`    |

The first type-inclusive check found 11 test-only typing diagnostics (RunResult narrowing and possibly asynchronous closure return types). Added failure guards and awaited the typed closure calls; no expectation was weakened or removed. Both RED/GREEN and the complete relevant broader selection were rerun on the corrected final test. Initial and final logs are retained. One initial in-memory test-content construction attempt failed before file creation; no runtime test ran in that attempt. No test, guest, or launcher timeout occurred.

Focused CLI command: `./node_modules/.bin/vitest run packages/safejs/src/interp/globals/object-aliases-validation.test.ts packages/safejs/src/interp/globals/object-aliases.test.ts --reporter=verbose`.

Broader selection: `packages/safejs/src/interp/globals/object-aliases-validation.test.ts`, `packages/safejs/src/interp/globals/object-aliases.test.ts`, `packages/safejs/src/interp/globals/object-array.test.ts`, `packages/safejs/src/interp/globals/console-json.test.ts`, `packages/safejs/src/interp/values.test.ts`, `packages/safejs/src/interp/budget.test.ts`, `packages/safejs/src/interp/data-budget.test.ts`, `packages/safejs/src/interp/interpreter.test.ts`, `packages/safejs/src/run.references.test.ts`, `packages/safejs/src/run.test.ts`. Exact argv is retained in the broader record. No full-repository, adversarial, live-LLM, real-I/O guest, or terminal/screenshot suite was requested or run. Inherited TERM=dumb was observed; if publisher runs full-repository terminal tests, use `env -u TERM`, not a source workaround. There is no CLI visual change to screenshot.

Package types: `./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`. The additional compiler API invocation explicitly includes both alias test paths because the package tsconfig excludes tests. ESLint/Prettier cover production and both alias test files. Exact executable inputs are in the static-check record.

## Original artifact boundary

Read-only audit root: `/Users/kjopek/Workspace/poe-code/out/safejs-audit-2026-08-27`. Initial inspection listed root and security-directory names only. Metadata-only bootstrap read inventory.json, inventory-verification.json, audit-index-state-20260828T000802Z.json and snippet-ledger-verification.json. Exactly 38 excluded archive paths from inventory-verification archiveReadPolicy and the entire security directory were then blocked before any payload read/hash. The deny-before-read helper also requires an exact allowlist. No broad whole-audit/family search, excluded payload read/hash/display/execution, or archived security probe occurred.

Allowed payloads: root REPORT.md (selected OBJ lines displayed), objects/results.json (only original indices 13, 14, 17, 18, 19 replayed), from-entries-alias-review/REVIEW.md and results.json, plus these six source paths. Full boundary/read hashes are in `audit-boundary.json`; final source rechecks are in the manifest.

| Audit-relative source                                                  | Bytes | SHA-256                                                            |
| ---------------------------------------------------------------------- | ----: | ------------------------------------------------------------------ |
| `objects/lodash-pick-transform.ajs`                                    |  1931 | `88f57dd8bb7d8be5c70ec72c9f91a86569009bbc48aaf019698dccb806488200` |
| `objects/reductions/object-identity.ajs`                               |   360 | `5fbac60d72c518d51198e1a38442ed4531b174f980e38d490c7f9151c94b995f` |
| `from-entries-alias-review/originals/lodash-pick-transform.ajs`        |  1931 | `88f57dd8bb7d8be5c70ec72c9f91a86569009bbc48aaf019698dccb806488200` |
| `from-entries-alias-review/reductions/02-direct-shared-pairs.ajs`      |   978 | `8b4a92ad3c4046bd6a63a08d82ffaf6b55267e95197483c51c876c9b40c52eed` |
| `from-entries-alias-review/reductions/03-duplicate-key-references.ajs` |  1160 | `9487528be21f8a6c718911243a4e450fd978884bf52f9dec6c50ee767686c436` |
| `from-entries-alias-review/reductions/04-array-contained-alias.ajs`    |   908 | `22aabcbff8712004c1416e05c5c93ad8d8fcf6bc207208c00916f473ceb6fc58` |

All new/replayed guests use bounded ordinary source data, no LLM, real network/filesystem/process capability, or security payload. Nine standalone children per engine each use an 8-second host timeout and 128 MiB heap. Current-TS imports are src/run.ts and src/interp/budget.ts via tsx, not packaged dist; omit entryPointArgs. Each guest budget is 20,000 steps, call depth 48, string length 16,384, array length 512, data size 500,000, and a 2-second deadline. Identity and mutation are observed inside guest execution before host JSON serialization. All complete original return objects and source hashes appear in `original-current-ts.json`; native stdout is in `original-native.json`.

## Immutable candidate and publisher handoff

Candidate files: `out/safejs-remediation/obj-001-validation/candidate/files/`, preserving the five exact repository-relative paths. Base production bytes: `out/safejs-remediation/obj-001-validation/candidate/preimages/packages/safejs/src/interp/globals/object-array.ts`. Manifest: `out/safejs-remediation/obj-001-validation/candidate/manifest.json`; its external SHA-256 is recorded in `out/safejs-remediation/obj-001-validation/handoff.json`, avoiding self-referential hashes. Candidate copies and manifest are made read-only after byte equality checks.

| Candidate repository path                                              | Base preimage                                                                    | Frozen candidate SHA-256                                           |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/globals/object-array.ts`                   | 10,482 bytes; `978b109161fe4a644a12362788fb2dc21a3ab938e10d59c1c435809fd5ca9726` | `45fc863ad3baec58b5d24a894b35249a997fbf5e256b3c1450a6c32d4d1b09b4` |
| `packages/safejs/src/interp/globals/object-aliases.test.ts`            | absent                                                                           | `bf4a504215769f1efe1e3e4e034ac34396a9455b8e944c8bbf9ae6453f9478c2` |
| `docs/plans/safejs-fix-obj-001.md`                                     | absent                                                                           | `a31ef28c2efcceaf1599511879dec27c72a275d92def806e8dabba6228a83208` |
| `packages/safejs/src/interp/globals/object-aliases-validation.test.ts` | absent                                                                           | `1dc9202d0b255257d95277b7f0699fbd396ec3f0b76bba4beceeb888f89c76bf` |
| `docs/plans/safejs-validate-obj-001.md`                                | absent                                                                           | manifest records final bytes/hash after authoring                  |

The manifest distinguishes Git-base preimages from validator-start images: all three author files were already present and frozen at validator entry, while the two validator paths were absent. All three author hashes must remain unchanged before capture.

Publisher MC003 reportedly adds three constants to the SAME production file earlier. Do not replace the publisher's whole file with this candidate or demand this candidate's whole-file hash after merge. Use the recorded common-base preimage for clean three-way integration, preserve both MC003's three constants and these Object wrapper changes, inspect the combined diff, and independently revalidate the merged current-TypeScript originals, independent/author tests, relevant regressions, types and lint. If overlap cannot be resolved cleanly, stop and report the conflict. Integrated bytes require their own hash manifest and independent verdict. This worker did not inspect/write the publisher clone or perform that integration.

READY is limited to this frozen five-file candidate on the recorded base. There are no unresolved blockers within OBJ-001 validation; publication, MC003 composition, OBJ-002, OBJ-003 and overall completion are not certified.

---

## Fresh independent merged validation — August 29, 2026

### Verdict and limits

**READY for OBJ-001 on frozen main 9ed57df23ff62f4d2eeffd6cf0753cc95624424b, with an explicitly failed supplemental historical-test typing gate.** This appended section records the fresh merged-tree review; the entire preceding isolated-base report is preserved byte-for-byte as historical evidence. It does not certify future HI loader/CLI changes, the publisher's eventual tree, a full-repository test run, OBJ-002/OBJ-003, publication, or overall remediation completion.

Independent delegated validator, not author/integrator Wegener. Validation completed on August 29, 2026 at approximately 06:07 UTC / 01:07 America/Chicago. Workspace: `/Users/kjopek/Workspace/poe-code-safejs-object-aliases-integrated`. The original object-aliases clone and both earlier frozen captures remain read-only and unchanged. Only this report is appended; production and tests are not edited. New evidence and the five-file freeze reside under `out/safejs-remediation/obj-001-merged-validation/`.

No OBJ-001-specific gate failed. The additional check including all eight historical TREE/STR03/COLL/MC001 test files reports three TS2345 diagnostics in the unchanged COLL validator, at lines 92, 95 and 120: Promise<void> is not assignable to Promise<SandboxValue>. The exact same three diagnostics occur with the recorded current-main production preimage substituted in memory. This supplemental gate remains **FAIL**, not silently removed or called green. Configured root/source checks and the explicit four OBJ-001/MC003 test-root check pass. The COLL runtime regressions pass. No unrelated frozen test is edited to resolve those diagnostics.

### Integration verification

- Frozen integrator manifest: `out/safejs-remediation/obj-001-integration/manifest.json`, SHA-256 `113eadc91bd4086a23a5541742dc480257ad5ad8cb694205f2b9ed9cce6e699d`.
- All five working publishables match the integrator's immutable files and declared hashes before validation. The original five-file manifest also matches `ba278a0ffeddb5cb0c22485d56286433affa3046be69c8df8f8598681424a2da`; all five original capture files verify.
- Current-main production preimage comes independently from read-only Git show of the frozen HEAD: 10,613 bytes, SHA-256 `7addf2003ce301bc2ef24ddac6e7de9737c0a8dae934be64b49631bd45da9d5f`. It exactly matches the integrator's captured preimage.
- Read-only `git merge-file -p` using current-main preimage, original common-base preimage and original OBJ candidate exits 0 and produces exactly the working merged file: 10,728 bytes, SHA-256 `b8a4b6f0adc702ba489e7f513e4a351a858a35a7edb06354df288f5876391e44`. Complete argv, merge stdout and diffs are in `integration-verification.json`.
- The common-base-to-current-main diff in object-array.ts consists of the three MC003 Number constants and their preceding comma. All three remain present: Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY. Current-main-to-merged changes are only the original three Object result wrappers, 8 insertions / 3 deletions. No whole-file replacement discarded upstream code.
- Six other published production paths and ten published regression test files are byte-identical to frozen HEAD; exact bytes/hashes are in `upstream-preservation.json`. Git's only tracked diff remains object-array.ts. The independent OBJ validator remains the original 22,495 bytes / SHA-256 `1dc9202d0b255257d95277b7f0699fbd396ec3f0b76bba4beceeb888f89c76bf`.

### Fresh execution ledger

All evidence filenames in this section are relative to `out/safejs-remediation/obj-001-merged-validation/`. JSON records retain exact argv/stdin, timestamps, statuses/signals, full stdout and full stderr. No executable QA script is added; this appended document is the QA procedure.

| Gate                                            | Independent observed result                                                                | Evidence                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Nine original native children                   | 9/9 full expected-object matches; exits 0, empty stderr                                    | `original-native.json`                                                         |
| Nine original current-TypeScript children       | 9/9 full matches, all ok:true; exits 0, empty stderr                                       | `original-current-ts.json`                                                     |
| Current-main in-memory RED, no production write | 34 OBJ failures + 6 OBJ passes; MC003 79/79 pass; 119 total; one preimage load             | `current-main-red.json`                                                        |
| Merged focused OBJ + MC003                      | 119/119, four files; independent OBJ 19 + author OBJ 21 + MC003 79                         | `merged-focused.json`                                                          |
| Matching author broader selection               | 861/861, twelve files                                                                      | `relevant-broader.json`                                                        |
| Expanded published regression selection         | 1,423/1,423, twenty-three files                                                            | `published-regressions-expanded.json`                                          |
| Expanded selection after all local builds       | 1,423/1,423, twenty-three files, 5.41s                                                     | `post-build-expanded-regressions.json`                                         |
| Forced scoped SafeJS source/dependency build    | 22/22 tasks, zero cached                                                                   | `static-build-checks.json`                                                     |
| Configured SafeJS source TypeScript             | PASS, exit 0                                                                               | `static-build-checks.json`                                                     |
| Configured root TypeScript, final               | PASS, exit 0                                                                               | `root-build-and-scoped-types.json`                                             |
| Explicit OBJ/MC003 test-inclusive TypeScript    | Four test roots, zero diagnostics                                                          | `root-build-and-scoped-types.json`                                             |
| ESLint                                          | PASS for merged production plus twelve OBJ/MC003/prior regression test files               | `static-build-checks.json`                                                     |
| Prettier                                        | PASS for merged production and four focused test files; appended report checked separately | `static-build-checks.json`, `report-and-final-checks.json`                     |
| git diff --check                                | PASS before and after builds                                                               | `post-build-diff-check.json`                                                   |
| Supplemental all-historical-test strict typing  | FAIL: three unchanged COLL validator TS2345 diagnostics, identical on base and merged      | `static-build-checks.json`, `supplemental-historical-test-type-isolation.json` |

The expanded runtime selection includes both author and validator suites for TREE/contextual from, STR03 replacement, COLL iteration/checkpoint and MC001 known globals, plus existing parser, string and collections tests. It retains every test in the original 861-test selection. Exact paths are in each command record. These totals are overlapping gate denominators, not additive distinct-test counts.

The first optional configured-root type check encountered unbuilt local workspace declarations. It was rerun unchanged after building exactly the missing local package targets/dependencies: 53 successful tasks, 22 cached. The github-workflows package received declaration-only tsc output, deliberately avoiding its workflow-regeneration build script. The same configured `npm run lint:types` then exits 0. No config, workflow or production change was used as a workaround; initial failure output is retained. Existing package/dist realpaths were checked to remain within this clone before builds.

SafeJS package types use `tsc -p packages/safejs/tsconfig.json --noEmit`; root types use `npm run lint:types`. The test-inclusive compiler API keeps the configured package compiler options and explicitly adds both OBJ and both MC003 test files, because the package configuration excludes tests. The separate larger twelve-test-root check and its three diagnostics remain documented as a supplemental failure. No tests or expectations were weakened. An initial proposed adjacent path, interp/iteration.test.ts, did not exist; this was detected before launching tests. The actual iteration suites and all requested published regressions are included.

All commands run through `env -u TERM`. No terminal source workaround, full-repository test run, adversarial suite, LLM query or guest real I/O is performed. No test or launcher timeout occurs. This source-local semantic change has no CLI visual delta; no screenshot gate is claimed. Neither fresh tests nor original replay execute packaged dist; current TypeScript is used throughout.

### Original evidence and exclusion boundary

A fresh guard was established before any original payload read: metadata-only `inventory-verification.json` bootstrap, exactly 38 excluded archive paths, and the entire security directory blocked. A second exact allowlist permits only objects/results.json, from-entries-alias-review/results.json and the six already-known original source paths. There is no recursive audit search or excluded payload read/hash/display/execution. Full allowlist, exclusions and source hashes are in `audit-boundary.json`.

Nine native anchors are independently checked before current-TypeScript replay: normal/mutated substantial projection, direct entries/values/fromEntries identity reductions, FE01 repeated projection, FE02 direct shared pairs, FE03 duplicate-key references and FE04 array-contained aliases. Six physical source files contain five distinct source bodies. FE01 is not new algorithm credit. Identity and mutation booleans/numbers are observed inside the guest, before JSON output. Complete expected objects and full original outputs are retained, not reduced to a success flag.

Each original child has an 8-second host timeout and 128 MiB heap. Current-TypeScript guests use 20,000 steps, depth 48, string length 16,384, array length 512, data size 500,000 and a 2-second deadline. No entryPointArgs are supplied. Ordinary synchronous host fixtures and existing memfs tests stay bounded; there are no LLM or external-service calls.

The original independent test preserves pre-call source/pair aliases, after-return nested identities, bidirectional mutation reflection, eager outer membership, repeated-call independent containers, last-duplicate-key selection and intentional JSON/structuredClone/host copy boundaries. All nineteen cases pass on this merged tree. OBJ-002 sparse clone/checkpoint and OBJ-003 Map/generator fromEntries support remain PENDING; published COLL tests are regression protection, not OBJ-003 feature credit.

### Exact freeze and publisher action

Freeze location: `out/safejs-remediation/obj-001-merged-validation/candidate/`. Its `files/` contains exactly the five publishable repository paths: object-array.ts, object-aliases.test.ts, object-aliases-validation.test.ts, safejs-fix-obj-001.md and this appended safejs-validate-obj-001.md, each under its full package/docs path. `preimages/current-main/` retains the exact current-main production bytes; the other four publishables are absent at that HEAD. `preimages/validation-entry/` retains all five integrator-start byte images, including this report's unchanged 14,900-byte prefix. The manifest records byte counts, SHA-256 hashes, both preimage meanings, and all evidence hashes. Its digest is recorded externally in `handoff.json`; no self-referential hash is required. Candidate/preimage files and manifest are read-only after equality checks.

Only this integrated clone's validation report is appended. No production, test, README, master plan, old report/capture, other clone or Git state is changed. No commit, push, branch, stash or reset is performed. Final checks verify all untouched frozen author/test files, original capture hashes and original audit source bytes.

The publisher is waiting for HI. This validation is **not** a claim about future HI loader/CLI code. Expected non-overlap is a handoff expectation, not a tested fact. On the actual post-HI base, verify every current preimage, use a clean three-way integration rather than replacing files, preserve all upstream changes, and run the publisher's complete configured gate. Any newly merged bytes require a new hash manifest and revalidation. Retain the three supplemental COLL test-type diagnostics as a visible limitation until separately resolved; they are not silently certified by the passing configured source gate.
