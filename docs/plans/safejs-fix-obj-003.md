# OBJ-003: Object.fromEntries iterable inputs

## Scope and baseline

Author implementation only, followed by separate independent validation. Isolated workspace: `/Users/kjopek/Workspace/poe-code-safejs-object-iterables`, cloned from the publisher's origin and pulled before edits. Base: `9ed57df23ff62f4d2eeffd6cf0753cc95624424b` on `main`; initial tracked/untracked status clean. No commits, pushes, feature branches, or other-clone writes.

Baseline/preimages and the archive policy bootstrap are frozen under locally ignored `out/safejs-remediation/obj-003/`. The production preimage is `packages/safejs/src/interp/globals/object-array.ts`, SHA-256 `7addf2003ce301bc2ef24ddac6e7de9737c0a8dae934be64b49631bd45da9d5f`.

Exactly 38 paths from the original inventory-verification metadata plus all `security/**` are excluded before any payload reads. No original audit payload has been read. Exact unchanged historical OBJ-003 sources have not been supplied/allowlisted; native-parity cases authored here are not mislabeled as original audit cases.

## Mechanism and integration boundary

Current `Object.fromEntries` forwards branded sandbox Maps/generators directly to the host builtin, which cannot consume them. `getSandboxIterator` already supports these inputs. Consume through that abstraction without rewriting user source or materializing an entry array before processing errors.

OBJ-001 is user-reported unreleased. This baseline still uses `budgetSandboxValue`/deep copying for Object transformations. OBJ-003 must preserve entry-value aliases in its new result, but must not wholesale replace or overwrite the later OBJ-001 worker's changes to this shared file. Integrate these precise hunks against the then-current alias implementation and rerun both issue suites. Other Object/Array transformation behavior is outside this fix.

## TDD and checks

1. Run authored Map/generator cases unchanged in native JavaScript and current SafeJS, retaining genuine baseline failures.
2. Cover duplicates/order, empty and partially consumed inputs, entry-value aliases, array-like pairs, non-iterables, abrupt completion, and cleanup/error precedence.
3. Implement the minimal package-local iterator consumer.
4. Run focused/broader tests, configured types, explicit new-test typechecking, scoped lint/format, and full build/test/lint gates with `TERM` unset where requested.
5. Freeze exact production/test/plan copies, preimages, full command results, and a hash manifest in the ignored evidence directory for independent validation.

Dependencies: `SKIP_SYNC_SKILLS=1 npm ci`. Unit tests use in-memory source/data; no LLM or guest network/filesystem/process capabilities.

## Implementation

Only `packages/safejs/src/interp/globals/object-array.ts` changes in production. The builtin obtains `getSandboxIterator` and rejects non-iterables synchronously as before. Its package-local consumer pulls one entry at a time, checks iterator results and entry objects, reads key/value in order, and defines each own data property immediately. Duplicate keys replace values without changing property-order rules. Abrupt consumption attempts iterator cleanup while preserving the original failure over a cleanup failure, matching the local native controls.

The result remains a null-prototype object, preserving the existing SafeJS test contract. `allocateProducedSandboxValue` budgets the result without deep-copying entry values; input/source aliases therefore remain intact. There is no arrays-only source workaround, intermediate entry-list materialization, generator rewrite, or change to `getSandboxIterator`/other globals.

## Results and retained failures

Runtime: Node `v22.22.2`, npm `10.9.7`. All evidence paths below are relative to `out/safejs-remediation/obj-003/`.

| Check                                         | Actual result                                                                                                                                                                                               | Evidence                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Dependency installation                       | Exit 0; `SKIP_SYNC_SKILLS=1 npm ci`                                                                                                                                                                         | `npm-ci.log`                                         |
| Genuine baseline focused red                  | Exit 1; 15 failed, 11 passed, 26 total                                                                                                                                                                      | `focused-red.log`, `focused-red.json`                |
| First implementation focused run              | Exit 1; 1 failed, 40 passed, 41 total. Existing null-prototype assertion exposed the new result-container mismatch; fixed in production without altering that test.                                         | `focused-green.log`, `focused-green.json`            |
| Focused final                                 | Exit 0; all 41 passed (26 new + 15 existing), 659 ms total                                                                                                                                                  | `focused-final.log`, `focused-final.json`            |
| Broader SafeJS/checkpoint suite               | Exit 0; all 630 passed in 10 files, 2.81 seconds                                                                                                                                                            | `broader.log`, `broader.json`                        |
| Full build, `TERM` unset                      | Exit 0; 67 successful build tasks, schema generation and bundle complete                                                                                                                                    | `build.log`                                          |
| First full configured test gate, `TERM` unset | Exit 0; 941 passed/3 skipped files, 21,818 passed/41 skipped tests, 232.02 seconds                                                                                                                          | `full-test.log`                                      |
| Full lint, `TERM` unset                       | Exit 0; configured ESLint, root types, workflow lint all passed                                                                                                                                             | `full-lint.log`                                      |
| Package types                                 | Exit 0                                                                                                                                                                                                      | `package-types.log`                                  |
| Explicit new-test types, first attempt        | Exit 2; two native-oracle fixture typing errors, not runtime failures. Fixed by using `Reflect.apply` for intentionally invalid/array-like native inputs; source cases and expected observations unchanged. | `new-test-types.log`                                 |
| Explicit new-test types, final                | Exit 0                                                                                                                                                                                                      | `new-test-types-final.log`, `tsconfig.new-test.json` |
| Scoped format                                 | Exit 0 after formatting only the authored test file through `apply_patch`                                                                                                                                   | `scoped-format.log`                                  |

The original red includes ten branded iterable acceptance failures, four generator lifecycle differences caused by refusing the generator before consumption, and the existing array-entry value-alias mismatch. The latter is explicitly the overlapping `fromEntries` slice of unreleased OBJ-001, not a newly invented iterable failure.

`authored-source-receipts.json` retains seven complete authored sources, source hashes, native values, frozen-preimage baseline errors, and current results. Each source is passed unchanged to native, baseline, and current execution. All seven baseline runs throw `TypeError`; all seven current outputs match native data. The baseline is bundled in memory with the exact frozen `object-array.ts` preimage; the working tree is never reverted. JSON data parity is not a prototype/identity claim: the existing null-prototype contract and source identity checks are tested separately.

### Exact test commands

```sh
node_modules/.bin/vitest run packages/safejs/src/interp/globals/object-from-entries-iterables.test.ts --reporter=verbose --reporter=json --outputFile=out/safejs-remediation/obj-003/focused-red.json

node_modules/.bin/vitest run packages/safejs/src/interp/globals/object-from-entries-iterables.test.ts packages/safejs/src/interp/globals/object-array.test.ts --reporter=verbose --reporter=json --outputFile=out/safejs-remediation/obj-003/focused-final.json

env -u TERM node_modules/.bin/vitest run \
  packages/safejs/src/interp/globals/object-from-entries-iterables.test.ts \
  packages/safejs/src/interp/globals/object-array.test.ts \
  packages/safejs/src/interp/globals/collections.test.ts \
  packages/safejs/src/interp/generator.test.ts \
  packages/safejs/src/interp/interpreter.test.ts \
  packages/safejs/src/interp/values.test.ts \
  packages/safejs/src/interp/patterns.test.ts \
  packages/safejs/src/run.snapshot.test.ts \
  packages/safejs/src/run.completed-replay.test.ts \
  packages/safejs/test/integration/crash-resume.test.ts \
  --reporter=default --reporter=json --outputFile=out/safejs-remediation/obj-003/broader.json

env -u TERM npm run build
env -u TERM npm test
env -u TERM npm run lint
node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
node_modules/.bin/tsc -p out/safejs-remediation/obj-003/tsconfig.new-test.json
node_modules/.bin/eslint packages/safejs/src/interp/globals/object-array.ts packages/safejs/src/interp/globals/object-from-entries-iterables.test.ts
node_modules/.bin/prettier --check packages/safejs/src/interp/globals/object-array.ts packages/safejs/src/interp/globals/object-from-entries-iterables.test.ts docs/plans/safejs-fix-obj-003.md
git diff --check
```

Output is retained in the corresponding logs and wrappers propagate the actual exit status. The root configured typecheck excludes tests, so the separate explicit new-test typecheck is not replaced by that green gate.

The final repeat on the unchanged production/test files passed: `full-test-final.log` records exit 0, 941 passed/3 skipped files, 21,818 passed/41 skipped tests, 235.05 seconds. `full-lint-final.log` also records exit 0 for the complete configured lint gate. The final explicit test typecheck, scoped formatting, and diff checks pass. No test was skipped or weakened by this change.

## Frozen artifact contract

`out/safejs-remediation/obj-003/manifest.json` records the exact base, working-file hashes, byte-identical frozen production/test/plan copies, production preimage, tracked production diff, all retained command logs/results, and the explicit historical-source limitation. `command-results.json` provides the structured gate summary. Frozen copies live under `frozen/` and are not alternate execution inputs; validation targets the source paths in the isolated clone. The manifest does not hash itself; its SHA-256 is returned separately at handoff. Evidence files are made read-only after the final manifest is written.

Authored implementation is frozen for independent validation. This is **not original-audit closure**: obtaining authorized unchanged historical sources remains an explicit handoff prerequisite.

## Limits and handoff

- Historical original-audit parity is **unverified**. No original payload source/path was supplied, and the instruction forbids original archive reads. The author requested supplied copies or an explicit allowlist rather than guessing paths or recursively searching the audit. The payload allowlist remains empty; only the authorized inventory-verification bootstrap metadata was read.
- The seven complete retained reproductions are authored current-baseline controls, not the historical OBJ-003 originals. Independent validation must obtain authorization/copies for those originals before claiming original-audit closure.
- OBJ-001 remains independently owned and user-reported unreleased. Merge the precise `fromEntries` hunks; never replace the whole shared `object-array.ts` file from this clone or drop the alias worker's other changes.
- Coverage is the existing supported iteration abstraction (including branded Map/Set/sync generators). It is not a new guarantee for async-only iterables, unrestricted source coercion/accessors, symbol support, or universal ECMAScript conformance.
- No authored test performs filesystem/network/process/LLM operations. Requested full configured gates include existing repository tests; no separate security research or excluded archive inspection occurred.
- Build-generated `packages/terminal-pilot/assets/` and evidence are locally ignored using this clone's `.git/info/exclude`; neither is a tracked code change. No other clone was written. No README, dependency manifest, lockfile, or unrelated production source was changed.
- Independent validation and publication remain separate. No commit or push was performed.

## Authorized original-input follow-up — August 29, 2026

This appended section supersedes the original-input authorization gap above without rewriting the previous frozen evidence. The user explicitly authorized the nonexcluded functional OBJ-003 original sources. The seven earlier authored reproductions remain **authored**, not historical originals. The production candidate and its 26 authored tests remain byte-identical to the first freeze.

### Archive access and exact sources

Before any original payload read, the author freshly read `inventory-verification.json#/archiveReadPolicy/excludedPaths`, required exactly 38 exclusions, and additionally blocked the entire `security/` directory. Bootstrap metadata SHA-256: `2ff2b353edf16714ee705dd550903a11bae70e1d7a544357de81d540b13ff827`.

Only the authorized top-level `REPORT.md` and `inventory.json` metadata were then read to locate this issue. `REPORT.md:563` identifies OBJ-003; `inventory.json#/activeFindings/15` references the two substantial projection cases and two reductions. The array control shares the reduction source. The concrete two-file allowlist was persisted in `out/safejs-remediation/obj-003/original-capture-01/allowlist.json` **before reading either original source**:

| Original path below `out/safejs-audit-2026-08-27/` | Inventory references                                          | Bytes | SHA-256                                                            |
| -------------------------------------------------- | ------------------------------------------------------------- | ----- | ------------------------------------------------------------------ |
| `objects/lodash-pick-iterable.ajs`                 | `/cases/32/snippet`, `/cases/33/snippet`                      | 2059  | `25b47b2c68933e74160677386425c35404d2b113596722bd284796e7ceab77aa` |
| `objects/reductions/from-entries-iterable.ajs`     | `/cases/40/snippet`, `/cases/41/snippet`, `/cases/42/snippet` | 254   | `9ef4f1e11a5c19770c1885e3800bcca0620c873abedfaa11ef3ebb0854b59b6b` |

Both files exist, and both freshly computed hashes equal their recorded inventory hashes. Their complete contents, including the projection wrapper and all postconditions, are copied byte-for-byte under the new capture's `originals/` directory. No original file was written. There was no recursive original-tree/family search and no read, hash, or execution of excluded/security payloads. No additional family evidence file was needed or read.

### Unchanged original replay

`original-capture-01/replay-command.txt` retains the exact stdin command executed with `env -u TERM node_modules/.bin/tsx --input-type=module`. For each configuration, native Node v22.22.2 receives the complete unchanged source as the body of `new Function("caseName", source)`; SafeJS receives the same string with `bindings: { caseName }`. There are no source substitutions, array conversions, guest modules, guest I/O, or supplied host capabilities. The filename option labels diagnostics only.

The current-baseline comparison uses an in-memory esbuild bundle with only `object-array.ts` replaced by its exact frozen preimage from base `9ed57df23ff62f4d2eeffd6cf0753cc95624424b`. The working tree is not reverted. This reproduces the current baseline rather than claiming to reconstruct the historical audit runtime. Full returned observation objects and error name/message/stack are retained in `original-source-receipts.json`; `replay-process.json` records exit 0 and empty stderr. Exit 0 means evidence capture completed, **not** that all full-output comparisons passed.

| Original case                        | Native                                   | Current baseline                  | Candidate                                | Full return-data parity                 |
| ------------------------------------ | ---------------------------------------- | --------------------------------- | ---------------------------------------- | --------------------------------------- |
| `objects:pick-map-entries`           | Returns complete projection observations | TypeError at fromEntries, line 39 | Returns complete projection observations | **Mismatch: four OBJ-001 alias fields** |
| `objects:pick-generator-entries`     | Returns complete projection observations | TypeError at fromEntries, line 39 | Returns complete projection observations | **Mismatch: four OBJ-001 alias fields** |
| `objects:from-entries-map`           | `{first:{count:1},second:2}`             | TypeError at fromEntries, line 7  | `{first:{count:1},second:2}`             | Match                                   |
| `objects:from-entries-generator`     | `{first:{count:1},second:2}`             | TypeError at fromEntries, line 7  | `{first:{count:1},second:2}`             | Match                                   |
| `objects:from-entries-array-control` | `{first:{count:1},second:2}`             | Same result                       | Same result                              | Match                                   |

Actual totals: native completes **5/5**; the unmodified current baseline rejects **4/5**, with its array control completing; the candidate completes **5/5**, with **3/5 full return-data matches and 2/5 mismatches**. Every baseline rejection is `TypeError: object is not iterable (cannot read property Symbol(Symbol.iterator))`. These receipts establish original-input coverage and removal of the four OBJ-003 rejection observations; they do **not** establish complete native parity for both substantial workflows. JSON return-data comparisons do not assert prototype equivalence; the existing intentional null-prototype result contract remains covered separately.

### Unreleased OBJ-001 boundary

In both complete projection originals, native returns `true` and the candidate returns `false` for exactly `entriesIdentity`, `valuesIdentity`, `rebuiltIdentity`, and `rebuiltMetaIdentity`. All other returned fields match, including the projected JSON, `nestedAlias`, `sourceAlias`, `missingOwn`, `sourceLevel`, and `absentSkipped`. The exact false observations are preserved; no original postcondition was removed or weakened.

The originals call `Object.entries(projected)` before `fromEntries`. At this base, both `Object.entries` and `Object.values` still route through `budgetSandboxValue`, which calls `deepCopyToSandbox`. Thus the entry values already differ from `projected` before `fromEntries` consumes them. Preserving those actual supplied values cannot restore the earlier identity relation. The existing four entry-alias regressions independently check that this candidate preserves supplied values for Map, Set, generator, and array inputs.

This is the explicitly anticipated, separately owned, unreleased **OBJ-001 integration dependency**, not a reason to broaden this patch or replace the shared production file. No production repair or test modification follows this evidence-only replay. Apply precise OBJ-003 hunks alongside the OBJ-001 changes and rerun both complete projection originals after integration. Until then, their full-output parity remains unresolved and must not be reported as green.

### Fresh freeze and validation handoff

The original manifest SHA-256 remains `dbcb3e6afb23276aae78bfb86606408923f4851800f6c631108347d81729781a`; its 28 artifacts, including the old plan and original authorization-gap statement, are preserved unchanged and read-only. The new `original-capture-01/manifest.json` independently freezes the new allowlist, selected metadata, exact original sources, receipts, command records, updated plan, unchanged production/tests, production preimage, and production diff. It links the earlier manifest and records preservation verification rather than mutating the first capture.

After the replay, the focused package/checkpoint selection was rerun against the unchanged candidate: **630 tests passed in 10 files**, including all **26 new tests and 15 existing object-array tests**. New logs are confined to `original-capture-01/`. Scoped formatting and `git diff --check` pass after the plan append. The previous full gates remain attributable to the exact unchanged production/test hashes: 21,818 passed/41 configured skips; build, configured lint/types, package types, and explicit new-test types all passed. They were not rerun for this documentation/evidence-only follow-up.

Original-input acquisition is now complete; independent validation is still separate and outstanding. The remaining original-workflow alias mismatches are explicitly handed off for OBJ-001 integration, not silently waived. No commit, push, README edit, other-clone write, or excluded payload access occurred.

## Three-way integration after OBJ-001 — August 29, 2026

This section records a new author integration in `/Users/kjopek/Workspace/poe-code-safejs-object-iterables-integrated`. It supersedes the earlier unresolved integration boundary for this new candidate only. The previous clone, both author captures, the validator capture, and their historical three-match/two-alias-mismatch evidence remain unchanged. The independent validator's report is copied unchanged, not rewritten to certify this later merge. Anscombe's fresh independent validation remains outstanding.

### Inputs and current baseline

The new main clone was created from publisher origin `git@github.com:poe-platform/poe-code.git`. `git pull --ff-only origin main` completed successfully with `Already up to date.` before implementation reads or edits. Its initially clean HEAD is `ecfd838abd37fb061d66dc8721bc3f86067139ad` (`fix(safejs): preserve object method result aliases`), incorporating the user-reported released OBJ-001 fix. No later pull, branch, commit, push, or other-clone write occurs.

The integration input is exactly `out/safejs-remediation/obj-003-validation/candidate/manifest.json` in the previous clone, SHA-256 `17b90659493d924b2b86dcb4865da9c0a0f8b6775149544eec2d4b1e87605d2d`. All five publishable input hashes were verified. Current-main preimages were captured before edits: production is present, while both OBJ-003 tests and both OBJ-003 plans are absent. The old validated-base production preimage and all five validated inputs are retained separately under `out/safejs-remediation/obj-003-integration/`.

Only these five publishables are integrated:

- `packages/safejs/src/interp/globals/object-array.ts`: minimal semantic production merge.
- `packages/safejs/src/interp/globals/object-from-entries-iterables.test.ts`: unchanged validated author tests.
- `packages/safejs/src/interp/globals/object-from-entries-iterables-validation.test.ts`: unchanged independent validator tests and assertions.
- `docs/plans/safejs-fix-obj-003.md`: validated author history plus this integration proof.
- `docs/plans/safejs-validate-obj-003.md`: byte-identical frozen independent report; no integration claims added to it.

### Conflict and semantic resolution

`git merge-file -p --diff3` was used only to inspect a three-way preview: current-main preimage, validated-base preimage, and validated OBJ-003 candidate. It returned one conflict in the `fromEntries` call body. Its complete stdout is retained in `three-way-preview.txt`; no file or Git index was changed by that preview. Production was edited with `apply_patch`, never replaced wholesale from the old candidate.

Published OBJ-001 changed `entries` and `values` to preserve their supplied references and changed `fromEntries` to allocate a reference-preserving, null-prototype result. OBJ-003 instead needs to adapt branded iterables and consume generators incrementally. The first minimal merge retained the published entries/values paths and the validated generator consumer, but made every fromEntries call asynchronous. The published OBJ-001 test `continues budgeting fromEntries results` then exposed a real integration regression: the budget exception became a rejected promise instead of a synchronous throw. The failing test and its unhandled rejection were retained; no assertion was weakened or dismissed.

The final resolution uses the existing `getSandboxIterator` and `iterator.generator` distinction:

- Synchronous adapters, including arrays, branded Maps/Sets, and supported host iterator fixtures, are exposed through a native iterable facade over the **same adapter**. The published native fromEntries allocation path remains reference-preserving and null-prototype, including synchronous budget exceptions. This is not an arrays-only branch, conversion to an array, eager entry collection, or source adaptation.
- Sandbox generator adapters use the validated asynchronous incremental consumer byte-for-byte. Each entry is installed before requesting the next, including reused pair arrays, duplicates, and abrupt iterator cleanup/error precedence.
- The published `entries`/`values` source block, Number properties including MC-003 constants, and all unrelated helper functions are byte-identical to current main. No other production file is edited.

`semantic-merge.json` records the conflict, current and old preimages, exact preservation checks, and the budget-error repair. `production.patch` contains only the fromEntries call-body change and incremental helper addition. The final production SHA-256 is `dbf2fddfb2a5fc7c11ddfabdb30f4a29ec324938a014c8b9e536320f649f1621` (12,260 bytes). Both test files and the independent report retain their validated hashes.

### Genuine current-baseline RED and merged GREEN

Dependencies were installed only in this new clone with `SKIP_SYNC_SKILLS=1 npm ci`. The unchanged author/validator tests were added before production edits and run against the actual pulled source, not an in-memory substitute:

```sh
env -u TERM node_modules/.bin/vitest run \
  packages/safejs/src/interp/globals/object-from-entries-iterables.test.ts \
  packages/safejs/src/interp/globals/object-array.test.ts \
  packages/safejs/src/interp/globals/object-from-entries-iterables-validation.test.ts \
  --reporter=default
```

Actual baseline RED: **23 failed / 32 passed / 55**, exit 1. The author file contributes 14 failures; the independent validator file contributes nine. All 15 existing object-array tests pass. The same selection passes after the initial iterable merge. The separate integration regression then supplies a second genuine RED before the synchronous-adapter repair.

| Integration gate                                    | Actual result                                            | Evidence under `out/safejs-remediation/obj-003-integration/` |
| --------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| Actual current-main OBJ-003 baseline                | 23 failed, 32 passed; exit 1                             | `focused-red.log`, `focused-red-command.json`                |
| Initial iterable merge OBJ-003 selection            | 55 passed; exit 0                                        | `focused-green.log`                                          |
| Initial OBJ-001/MC-003 integration attempt          | 1 failed, 118 passed, 1 unhandled rejection; exit 1      | `obj001-mc003-green.log` (historical attempt filename)       |
| Initial broader integration attempt                 | 1 failed, 1,199 passed, 1 unhandled rejection; exit 1    | `broader-green.log` (historical attempt filename)            |
| Final combined focused gates                        | 174 passed: OBJ-003 41+14, OBJ-001 40, MC-003 79; exit 0 | `sync-merge-check.log`                                       |
| Final broader/checkpoint and published regressions  | 1,200 passed in 23 files, no unhandled errors; exit 0    | `broader-final.log`                                          |
| Final full build                                    | 67 build tasks pass; schemas/root compile/bundle pass    | `build-final.log`                                            |
| Final configured lint, root types and workflow lint | Pass; exit 0                                             | `lint-final.log`                                             |
| Configured SafeJS package source types              | Pass; exit 0                                             | `package-types.json`                                         |
| Both new OBJ-003 tests explicitly typechecked       | Pass; exit 0                                             | `new-test-types.json`, `tsconfig.new-tests.json`             |

The final broader selection is the validated 1,160-test selection plus the two published OBJ-001 test files (40 tests). It includes the original 55 OBJ-003 tests, generators, interpreter, values, patterns, collection constructors, completed replay, snapshots, crash-resume, and the published MC-003/MC-001/COLL/STR-03/TREE regression pairs. Exact argument lists, statuses, and logs are retained in the command ledger; these counts are author integration results, not a new independent verdict.

### Full unchanged original outputs

The exact 38 exclusions were freshly bootstrapped from `inventory-verification.json#/archiveReadPolicy/excludedPaths`, with the entire `security/` directory additionally blocked, before any original payload read. Only top-level REPORT/inventory metadata was inspected to establish the same concrete two-source allowlist, persisted as `archive-allowlist.json` before source reads. Both original source hashes still equal the inventory hashes recorded earlier in this plan. There was no recursive audit search or excluded payload read, hash, or execution.

All five configurations execute the complete unchanged original source in native Node and SafeJS with the metadata's `caseName` parameter/binding. `original-replay-command.txt` retains the exact command. It exits nonzero for any full returned-data mismatch. `originals-red.json` captures the real pulled baseline before edits: four fromEntries TypeErrors and the passing array control. `originals-green.json` preserves the initial merged observation; `originals-final.json` binds the final repeat to the actual final production hash.

Final status is **5/5 complete returned-data matches, zero mismatches**, exit 0:

- `objects:pick-map-entries`: full projection output matches native.
- `objects:pick-generator-entries`: full projection output matches native.
- `objects:from-entries-map`: `{first:{count:1},second:2}` matches native.
- `objects:from-entries-generator`: `{first:{count:1},second:2}` matches native.
- `objects:from-entries-array-control`: the unchanged control matches native.

For both substantial projection originals, `entriesIdentity`, `valuesIdentity`, `rebuiltIdentity`, and `rebuiltMetaIdentity` are now **true in both native and SafeJS**, rather than the prior candidate's false values. Every other field also matches: complete projected JSON, nested/source aliases, missing-own membership, source level, and absent-path omission. No failing field was filtered out. Complete native/current observation objects and diagnostic errors are retained, not just pass booleans. Returned-data comparison does not assert native prototype equality; the intentional sandbox null-prototype contract is checked by the unchanged tests.

### Integration evidence boundary

The fresh ignored capture contains exact merged publishables, current preimages, validated input copies, original sources and full outputs, both RED stages, final gates, semantic merge proof, and a new hash manifest. The old author manifests and their 28/18 artifacts are preserved, including historical three-match/two-alias-mismatch receipts; the old validator capture remains read-only and unchanged. The seven initial authored reproductions remain correctly labeled authored.

The immutable validator report is not reformatted or updated. Scoped formatting covers the edited production file, the two unchanged test files, and this appended author plan. This integration changes no CLI presentation and makes no screenshot claim. No README, package manifest, lockfile, master plan, other issue implementation, or published test assertion is changed. No security research, real guest I/O, LLM call, publication, or other-clone write is performed. Independent validation of these new integrated hashes remains required before publication.

The final full-repository gate `env -u TERM npm test` passed with **21,940 tests passed / 41 configured skips**, **946 files passed / 3 skipped**, exit 0, in 230.31 seconds (`full-test-final.log`). No test was changed, skipped, or weakened by this integration. The final source build, full configured lint, source/test-inclusive type checks, scoped formatting, and `git diff --check` also pass. Initial formatting reported the appended plan tables only; those were formatted with `apply_patch`, preserving the entire validated author plan as a byte-identical prefix. Final production/test bytes remain the ones exercised by the final original replay and test gates.

Preservation verification checks 75 distinct previous working/capture records against their existing manifest hashes, including all 28 first-author artifacts, all 18 original-follow-up artifacts, and the validator's retained evidence. All remain unchanged. The fresh integration manifest freezes five publishables, their current-main presence/absence preimages, all exact inputs, and the complete new evidence ledger. Its SHA-256 is supplied separately at handoff; it does not hash itself. The capture is read-only after final byte/hash verification. No remaining original alias mismatch is deferred in this candidate; only fresh independent validation and coordinator-controlled publication remain outstanding.
