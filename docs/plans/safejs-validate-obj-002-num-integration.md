# Independent OBJ002 after NUM001 validation

Status: in progress on `afe59a77fa318acf72162a1970306147fdfc5428`.

## Scope

Validate the exact frozen NUM11 prerequisite followed by OBJ10-only delta. Preserve source, assertions, historical plans, reports, and failed logs. No production edits, Git mutations, old-clone access, README edits, original writes, excluded archive payload access, security research, guest I/O, or LLM execution.

## Execution

1. Verify the manifest, current-main and post-NUM preimages, shared restore merge, and archive guard.
2. Anchor full original native outputs before current-source executions; review sparse shape, explicit undefined, metadata/raw aliases/cycles, legacy representation, and source arity restoration.
3. Independently run OBJ baseline RED/current GREEN, NUM selected/unfiltered tests, cross-fix restore controls, originals and active/intermediate/completed checkpoints.
4. Run adjacent/prior-published/package/full gates, build, exact supplemental and configured types, lint, and all OBJ-publishable formatting.
5. Preserve limitations and freeze OBJ-only delta separately from NUM prerequisite and post-NUM preimages. Later AW/actual-main combinations remain uncertified.

## Final independent decision — August 29, 2026

**READY for the exact NUM001 → OBJ002 ordered snapshot on `afe59a77fa318acf72162a1970306147fdfc5428`, with the limits below. This is not approval of an actual future main, AW, or any other pending combination.** The initial in-progress entry above records the execution plan, not the final status.

- Author manifest: `out/safejs-remediation/obj-002-ordered/manifest.json`, SHA-256 `c2b5261b1027082bdadc2ce2ef5253379de54764111bc1295969f5f818e718ac`. All 206 listed artifacts and all publishable/preimage byte counts and hashes independently match.
- Publication order is mandatory: NUM11 prerequisite, then OBJ10-only delta. There are 20 unique combined paths. Only `packages/safejs/src/snapshot/restore.ts` overlaps; its independent `git merge-file -p` reproduction is conflict-free and byte-identical to the candidate.
- All 37 protected published paths match both their recorded hashes and this pinned Git base. No production source, prior test, prior report, README, index, branch, commit, or other clone was changed by this worker. Existing terminal-pilot assets remain untouched.
- The only new working files are `packages/safejs/src/snapshot/obj-002-num-integration.test.ts` and this report; evidence is under `out/safejs-remediation/obj-002-num-validation/`. The eight new tests are validation artifacts, not silently added to the frozen OBJ10 delta.

### Shared restore and source review

`getFunctionLength` counts formal parameters before the first **top-level** assignment or rest parameter. Nested defaults inside destructuring do not truncate arity and are not evaluated when reading length. Source declarations/expressions, arrows, async functions, and generator metadata are covered by the unchanged NUM tests. Binding subtracts only arguments after the receiver and clamps at zero; rebinding and omitted receiver controls remain intact.

Low-level restore derives source length again from the AST. The merged sparse-array branch allocates the recorded length and caches the array before restoring own entries, preserving cycles, aliases, holes, indexed undefined, and enumerable named metadata/raw data. Dense arrays keep the prior `items` form. The new reader also accepts prior inline arrays and heap `items`, including the legacy self-reference control.

The new actual-package unit file adds eight low-level array-of-source-descriptor cases: interpreter and dump encodings × ordinary/destructured, arrow, async, and generator metadata. It checks exact own-key order/presence, length, explicit undefined, detached graph, aliases/cycle, metadata/raw identity, restored source length, bind/rebind clamping, and zero callback execution. A separate active-await source control binds before capture, then invokes after replay; defaults are evaluated only at invocation. Its native/current/replay arities are `[2,2,2,1,1,0]`, with the full output retained.

### Genuine baseline and current gates

Baseline uses an in-memory pre-transform of the five exact **post-NUM** OBJ production preimages; source files and assertions stay unchanged. Every override is observed. Existing OBJ: **26 failed / 10 passed → 36 passed**. New cross-fix tests: **8 failed → 8 passed**. The genuine original sparse failures and checkpoint serialization TypeErrors are also retained, not converted to successes.

Commands run in this workspace with `TERM` unset. Unless an exact inherited command is being reproduced, `SKIP_SYNC_SKILLS=1 POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error` is set. Complete executable argv, cwd, timestamps, exit codes, stdout and stderr are in `out/safejs-remediation/obj-002-num-validation/commands/`; no output is replaced by a count-only summary.

| Gate / command receipt                                                                                                 | Independent result                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `combined-obj36-num122-cross8.json` — actual seven package test files, no name filter                                  | 166 passed: OBJ36 + NUM122 + new8; zero skipped                                                                     |
| `unchanged-num96-selected.json` — original name selector, unchanged                                                    | 96 passed / 26 excluded; comparison only, not full suite                                                            |
| `independent-combined-adjacent.json` — snapshot/interp/run/random/restore/dump                                         | 1,985 passed / 58 files / zero skipped                                                                              |
| `independent-published-regression-matrix.json` — exact 24 prior-published files                                        | 1,416 passed / zero skipped                                                                                         |
| `independent-safejs-full.json` — `vitest run packages/safejs --reporter=json`                                          | 4,814 passed / 39 skipped; 166 files passed / 1 skipped                                                             |
| `configured-full-test.json` — `env -u TERM ... npm test`, no extra selector                                            | **22,199 passed / 41 skipped; 956 files passed / 3 skipped**; 1 uncached Turbo task, 3m18.997s                      |
| `configured-build.json`, `forced-workspace-build.json`, `final-configured-build.json`                                  | Initial/final configured build pass; forced workspace build **67/67 uncached**, 26.941s; final root bundle succeeds |
| `supplemental-obj-0.json`, `supplemental-obj-1.json`                                                                   | Both exact commands below exit 0; zero diagnostics                                                                  |
| `supplemental-num-new-tests.json`, `configured-all-new-tests-types.json`, `post-build-configured-new-tests-types.json` | NUM configured two-new-test roots and all five new OBJ/NUM/validation roots: zero diagnostics                       |
| `configured-safejs-types.json`, `configured-lint-types.json`                                                           | Package and root configured types pass                                                                              |
| `configured-eslint.json`, `configured-lint-packages.json`, `configured-lint-workflows.json`                            | All pass                                                                                                            |
| `obj10-num11-and-cross-format.json`                                                                                    | All OBJ10, NUM11 and new unit-file formatting pass                                                                  |

The +8 increase over the author adjacent/package/full counts comes solely from the new bounded in-memory unit tests. No existing assertion, skip, timeout, source fixture, or restriction was weakened. `num-selected-exclusions.json` records the exact inherited selector and all 26 excluded test names; **each of those 26 passes in the unfiltered NUM122 run**. They cannot hide an arity or integration failure here. `configured-skips.json` lists the 39 SafeJS skips and the two other configured full-suite skips. Full means this configured unit command, not E2E, fuzz campaigns, or unconfigured tests.

Exact unchanged OBJ supplemental commands:

```text
env -u TERM node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --strict packages/safejs/src/snapshot/array-shape.test.ts
env -u TERM node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --strict packages/safejs/src/snapshot/obj-002-validation.test.ts
```

### Original payload guard and full outputs

Before reading original payload, the metadata bootstrap installs all **38 exact excluded paths** from `inventory-verification.json` plus the **entire `security/` tree**. Only the six concrete nonexcluded paths below are allowlisted. There is no recursive audit/family search, excluded payload read/hash/execution, security research, LLM call, or guest real I/O. Original paths remain read-only and are hash-rechecked through the same guard. No old clone is accessed.

| Allowlisted original                           |    Bytes | SHA-256                                                            |
| ---------------------------------------------- | -------: | ------------------------------------------------------------------ |
| `objects/reductions/structured-sparse.ajs`     |      261 | `e873c44afa16870b1b2725ce50448f0931c0cf474d39ee089ac2d0153a9022df` |
| `checkpoint-composition/03-codec-workflow.ajs` |     4830 | `bc1549cad586b27c49963fe017e9a286c9b87a4463425d14034998a838827844` |
| `checkpoint-composition/results.json`          | 11764391 | `a22fdd90f85d8dc4c6586da9cc4b89ff9899d1d420ec32178d44cca3d4563e7f` |
| `numerics/08-bisector-stable-ordering.ajs`     |     2767 | `48a385b2cc8b7a55a18daae961d849b51eafe9ed476206fb13366f7b7d859b2f` |
| `numerics/10-bisector-explicit-mode.ajs`       |     2644 | `8a1801ee2d1539642887239ec5a3523be7af2c1bdadfdad7c466e2d2f52c17c7` |
| `numerics/11-function-arity-reduction.ajs`     |      336 | `c48df811c81dd2def901ea69e485ae9359ed5c39a91a539114bacd7f22db618b` |

Native anchors are executed before current-source runtime checks and retained completely in `commands/all-original-native-anchors.json` (see the command index for the exact anchor receipt). The original source bytes are not edited or reduced.

- NUM: all three unchanged sources, two direct runs and two completed replays each, compare the entire returned records with native (6 direct + 6 replay comparisons). The original D3-style bisector descending rows are `[[5,7,5],[3,5,3],[1,2,1]]`; sorted IDs, all ascending rows, scaled/restricted modes, comparator/accessor lengths, and reduction fields are compared too.
- Codec: two native fixtures, full packet/base64/UTF-8/decoded/url-safe/alias/receipt graphs. Post-NUM and combined uninterrupted outputs match native. The exact source produces **8 combined checkpoints**, **16 intermediate resumes**, and **4 completed resumes** (including completed snapshots from the post-NUM runtime). All returned data, host calls, outcomes, replay prefix plus live suffix, and complete semantic journal match. Raw snapshots keep their full IDs/stacks; only nondeterministic call IDs/stack text are outside semantic journal equality.
- Codec baseline: exact post-NUM preimages fail sparse serialization at each of the four original host boundaries for each fixture. Backend errors and the final failure are retained; a finally-release prevents a hung validation process. Current checkpoints have zero backend errors.
- Sparse reduction: the dense baseline control passes; the two sparse original cases throw genuine TypeErrors before OBJ. All three combined cases match full native `{length, keys, detached}` outputs.
- Metadata/raw graph: the exact inherited graph witness loses array metadata/raw on the post-NUM baseline and preserves the complete graph after OBJ. This witness’s historical `nativeExpected` field is a graph-preservation expectation from construction, not a separate ECMAScript API. Independent unit identity and own-presence assertions supplement the full witness outputs.
- Active cross-fix: one pending-await sparse/source-function snapshot and two resumes match the full native control. Low-level descriptor restoration is separately exercised by the eight new tests; successful run-level replay is not substituted for that check.

Outputs: `original-codec-proof.json`, `original-sparse-proof.json`, `metadata-graph-proof.json`, `active-sparse-source-arity-proof.json`, `commands/unchanged-num-originals-current-replay.json`, and every per-boundary receipt under `commands/`; all 8 intermediate and 4 completed original snapshots are retained under `checkpoints/`.

### Failures and limitations retained

- Noether’s prior report stays byte-identical, SHA-256 `a414310188a17d1b29c82a03e29eaf0955338c948cac0c022f484083d19d17d0`. Its historical 15-TypeScript-diagnostic result is not deleted or called passing. The incoming immutable manifest identifies the raw failed log as 4,285 bytes, SHA-256 `ab967afefab115791f896ee6baf2acfccc58be7d90d42b45a35a43e70ea4ee7e`; that old-clone log is not accessed, rewritten, or recopied. The supplied local manifest and history entry are preserved under `history/`. The exact two current supplemental checks independently return zero.
- This worker retains its initial baseline-only sparse driver abort and the initial codec driver load-count assertion (four loaded modules rather than five). The latter is repaired by explicitly importing the low-level restore module in the baseline child, retaining the assertion and old failure. No original source or candidate assertion is changed. See `driver-diagnostics.json` and the failed command records.
- Author repository-wide formatting remains a recorded **1,435-warning failure**, copied intact under `history/`; it is not rerun, silently waived, or described as globally clean. Exact OBJ/NUM/validation-file formatting passes. Prior author cross-control diagnostics and the historical NUM expanded-test typing qualification remain preserved, not recast as current passes.
- No claim is added for nonenumerable/symbol/accessor/general property descriptors, host/builtin arity, generalized reflection, low-level closure alias identity, or invocation of a restored generator. Generator source-length metadata is covered. New-reader legacy array compatibility is covered; an older reader consuming the new sparse encoding is not.
- There is no CLI visual change, release, Git publication, actual-main preimage approval, AW approval, or approval of another interpreter/snapshot merge. Any later actual main or cross-issue combination needs new integrated validation and publisher gates. README permission remains pending; no README edit is made.

### Exact OBJ-only delta

The six production files, two unchanged test files and two unchanged author/prior-validator plans below are the **only ten OBJ delta publishables**. Five preimages exist after NUM; `arrays.ts`, both tests and both plans are new relative to this base. Captures preserve exact bytes, not regenerated formatting.

| OBJ delta path                                            | Post-NUM preimage SHA-256                                          | Candidate SHA-256                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/safejs/src/graph-depth.ts`                      | `36b5f0e3a978f73583d086fd3df38303ce7694947c1c55028b9bfb3831391346` | `5ef7bfea2b1dc5826f3796cc03493006b473e186becc25649b0b7328068b5f55` |
| `packages/safejs/src/snapshot/arrays.ts`                  | new / absent                                                       | `5c78f0845f03f356b3b64cdf8835a28139eb2e68897304136de0203fae2c921f` |
| `packages/safejs/src/snapshot/serialize.ts`               | `34c74ba5f75a9ad8a29f1adc034820c37e2b3778b258660d24de6c54a520f7b6` | `12e3dabb85caf9458967f12b2b6b8db3c22bf392365bc05389a2536cd4a35bed` |
| `packages/safejs/src/snapshot/dump-format.ts`             | `c9b10ad6c160a5b20cf52c87e22cc5220de0025fdff002c88e55e6f6ba55ae31` | `ab30f29e1cab5761e189b5cc114c463a3d7b221fe72ad1a91cda754e6d2cc1af` |
| `packages/safejs/src/snapshot/restore.ts`                 | `e1fbab08bc2f6bd6b1fbdf3c50626909ff4d57068053cf6bdd08a9a8f1e6819a` | `659ad4fecb728508c12520edb1fede88ba56a10a88650e0ded53969acb8dcc03` |
| `packages/safejs/src/snapshot/validation.ts`              | `a33dba04490252763a870059a095cb1b27efce6ec913a6735676d4509f90b1c2` | `18efe0c9b8fe248bcb3f750499c92a90e0890836a65961506caca18883cd4324` |
| `packages/safejs/src/snapshot/array-shape.test.ts`        | new / absent                                                       | `99831f1dc6e0b46da6c637b1ee55440ba721a49865bcd706d9ab303715238765` |
| `docs/plans/safejs-fix-obj-002.md`                        | new / absent                                                       | `b85530a2a76669d83e54c83f0c611375692080d3456b9bd366bce981145ce186` |
| `packages/safejs/src/snapshot/obj-002-validation.test.ts` | new / absent                                                       | `813a285c2d32829e2340bde95f0017386b03d2d18de8773e4be5f8d7fc45e49d` |
| `docs/plans/safejs-validate-obj-002.md`                   | new / absent                                                       | `a414310188a17d1b29c82a03e29eaf0955338c948cac0c022f484083d19d17d0` |

### NUM prerequisite and overlap

The seven existing NUM preimage paths are **five production files plus two test files**, not seven production files. Four additional NUM paths are new. None overlaps OBJ `arrays.ts`, `serialize.ts`, `dump-format.ts`, `validation.ts`, or `graph-depth.ts`; only `snapshot/restore.ts` overlaps. NUM does not edit `parse/parser.ts`.

| Existing NUM path                                     | Kind       | Pinned-base preimage SHA-256                                       | Post-NUM SHA-256                                                   |
| ----------------------------------------------------- | ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/async.ts`                 | production | `7702c005879c8abe584120cf8e801ece0302a149092132a7963b192d2ee27c26` | `fc4231ca5f6d03af845c9b19127579d3564bf9cc8ae418d499bac6b8d39ae6cc` |
| `packages/safejs/src/interp/methods/function.test.ts` | test       | `45792d9adc49524326c71eea569e3a8a4860a6e5bebb98e5d8538aec8b9eb48e` | `2738d2efa22916cbe4d2d52e9c0b7a9103bcd7a4b00c221ada5a317c51ef1254` |
| `packages/safejs/src/interp/methods/function.ts`      | production | `1534bcb7a9ee11089044d2633776019e941f119270e73cee62a0f38fda2673f6` | `1543db210f9c40a66148e838973434c85c10bd9e47d46200731e48a6453b5826` |
| `packages/safejs/src/interp/values.ts`                | production | `487d392c295977bdd144713382e5ab142d85a3dfac27a8fe9cfea8c669dbbf75` | `1e027e9c9c100b0849b7b8e4ab02b747181f63ce1383e9e467fecc37e76ad4a6` |
| `packages/safejs/src/parse/bindings.ts`               | production | `ebc6b0da68470dd371da6197a34a5e9dcafc08c087b03feb7606f6868d8460e8` | `6c973479a5340cebee625ad0c81bb134598b3c128599577d97024c5552e74acb` |
| `packages/safejs/src/snapshot/restore.test.ts`        | test       | `6524d83e2ee496fecb4a3c57a0185534cba5ca4a15016167216a1ce53f60e9b3` | `3d08664efcb320d916553c1e37d60c5eea6d2d7515eaafa648663a2117b82f43` |
| `packages/safejs/src/snapshot/restore.ts`             | production | `5bd4247f7fc44348b1f1ef8e91693927013eb36a702b0f6f04f8388d152c1322` | `e1fbab08bc2f6bd6b1fbdf3c50626909ff4d57068053cf6bdd08a9a8f1e6819a` |

New NUM paths: `packages/safejs/src/interp/function-arity.test.ts`, `packages/safejs/src/interp/num-001-validation.test.ts`, `docs/plans/safejs-fix-num-001.md`, `docs/plans/safejs-validate-num-001.md`. All eleven prerequisite bytes are captured separately; the working shared restore intentionally equals the combined OBJ postimage instead of the prerequisite intermediate.

### Immutable handoff

`out/safejs-remediation/obj-002-num-validation/manifest.json` binds the OBJ10 delta, NUM11 prerequisite, five post-NUM OBJ preimages, seven pinned-base NUM preimages, and the separate two validation artifacts. `candidate/obj-delta/` must not be conflated with `candidate/num-prerequisite/`. `evidence-index.json` hashes command receipts and full original outputs; `readiness.json` binds the final manifest/report/evidence hashes. The captured tree is made read-only and filesystem-immutable only after final verification; no author or working source file is made writable or changed.

Final SHA values and freeze verification are returned in the handoff rather than embedded recursively in this report.
