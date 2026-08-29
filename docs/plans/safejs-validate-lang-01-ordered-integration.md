# Independent LANG01 ordered integration validation

## Scope and execution

Validate the frozen five-file LANG delta on `32caeaddbac72bccea1cb3fd0a07fb293a1bee71` without source/assertion/README/Git changes or racing CTX access. Preserve published own-property lookup and structural mutation restrictions; independently record the shadowed-map serialization limitation.

1. Verify exact current preimage, captures, and archive guard.
2. Review callback lifetime and unresolved serialization scope.
3. Reproduce genuine baseline RED, unchanged focused tests, and five full original native/current/replay comparisons.
4. Run relevant broad and configured build/type/lint/format gates with TERM unset.
5. Append results and freeze a delta-only manifest including this report and the integrated author plan; keep pinned prerequisites separate.

## Independent decision — August 29, 2026

**SCOPED READY for LANG01 only, under the coordinator’s subsequent explicit scope disposition. All LANG-specific gates pass on `32caeaddbac72bccea1cb3fd0a07fb293a1bee71`; the current publisher array preimage matches. The separate own-map-shadow serialization bug remains OPEN / PENDING FIX with a frozen handoff, not waived or claimed intentional. Global all-checks-green remains false; the newer publisher tree still needs its own integrated gates.**

Author manifest: `out/safejs-remediation/lang-01-integrated/candidate/hash-manifest.json`, SHA-256 `aa0da0315f7e77b30e527dbfa6aaed065fb5c687d28b975c3a0ae817531fa68e`. All 56 author artifacts, five working postimages, and the single pinned-base/captured preimage match exact bytes and hashes. The author works in another clone; this worker neither reads nor writes that racing CTX clone. No source, existing test, README, home configuration, index, branch, commit, push, publisher, or original archive change is made.

### Surgical integration review

The only production delta is **13 insertions / 2 deletions** in `packages/safejs/src/interp/methods/array.ts`. Its entire `getArrayMember` implementation is byte-identical to pinned main. The 126-byte published own-property lookup survives unchanged. Removing exactly that lookup from the candidate reproduces the inherited LANG production postimage; copying the old whole-file candidate would wrongly remove published behavior.

Array-local WeakMap depth retains one generic callback lock until the final nested or overlapping reader exits. `finally` decrements the count and releases only at zero, including early exits, validation failures and user throws. Mutating methods still check `assertCollectionMutable` before entering the callback path. A separately held generic guard is not bypassed. Generic running-state, Map/Set methods, interpreter, graph-depth and snapshot serializer are unchanged and hash-checked against this base.

The unchanged independent 41 tests cover aliases and three-level combinations, twelve nonmutating read combinations, sparse/empty traversal, six early-exit methods, throws, nested callback validation, four structural mutation boundaries, three overlapping-reader settlement orders, and two active aliased checkpoint/caught-throw variants. The unchanged author 202 tests cover the method-pair matrix, sort/toSorted comparator reads, detached callbacks, lock retention/release, separately held guards and active/completed replay. No existing assertion or restriction is weakened. The eight author integration controls preserve published own metadata, own method precedence and call order, Object.fromEntries, regex metadata, and source arity.

### Genuine RED and independent gates

An in-memory Vitest pre-transform substitutes only the exact current-main `array.ts` preimage. Its load is asserted. Author tests: **164 failed / 38 passed**; unchanged independent tests: **36 failed / 5 passed**; integration tests: **8 failed / 0 passed**. Thus the genuine baseline has 208 failures / 43 passes. The unchanged candidate suite has **251 passes / zero skips**.

| Gate / receipt under `out/safejs-remediation/lang-01-ordered-validation/commands/` | Result                                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `focused-current-main-red.json`                                                    | 208 failed / 43 passed, including independent36/5                                                 |
| `focused-unchanged-green.json`                                                     | Author202 + independent41 + integration8 = 251 passed                                             |
| `safejs-package-unfiltered.json` — `vitest run packages/safejs --reporter=json`    | 6,510 passed / 39 skipped; 170 files passed / 1 skipped                                           |
| Existing control subset of the unfiltered package run                              | 109 passed across seven files: ARRAYOWN26, call-order15, array20, running-state13, collection35   |
| `configured-full-forced.json` — configured root unit task with cache bypass        | **23,895 passed / 41 skipped; 960 files passed / 3 skipped; 1 uncached task; 3m44.7s**            |
| `configured-build.json` — `npm run build` before typechecks                        | 67 workspace tasks pass (67 cached); root generation, types, wrappers and bundle run successfully |
| `package-types.json`, `root-types.json`                                            | Configured package/root types pass                                                                |
| `author-new-tests-types.json`                                                      | Exact author explicit three-test project passes                                                   |
| `configured-package-and-three-new-tests-types.json`                                | Independent package-configured source plus all three new test roots: zero diagnostics             |
| `configured-eslint.json`, `lint-packages.json`, `lint-workflows.json`              | Pass; ESLint excludes only the two evidence trees, not production/tests                           |
| `final-publication-format.json`, `final-diff-check.json`                           | Exact six publication files and diff whitespace pass                                              |

Every test/build/type/lint command unsets TERM. Runtime gates use `SKIP_SYNC_SKILLS=1 POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error`. Exact argv, cwd, timestamps, exit status, full stdout and full stderr are preserved in command receipts. The forced full command is:

```text
env -u TERM SKIP_SYNC_SKILLS=1 POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error node_modules/.bin/turbo run test:unit --concurrency=1 --force
```

This runs the same configured unit task as `npm test`, without extra test/name filters and with forced cache bypass. The earlier REPL full attempt lost its completion receipt after a session reset and is explicitly **not credited**; the final full result is independently completed and retained. `configured-skips.json` lists the 39 SafeJS skips and the two other configured full-suite skips. No new skip is introduced. “Full” does not mean E2E, unconfigured tests, or a new security campaign.

### Original sources and exact full outputs

The metadata bootstrap installs all **38 exact excluded original paths** and the **entire security directory** before any payload. Only eight concrete nonexcluded captured paths are allowlisted: the five sources below and their three supplied result/oracle metadata files. This worker reads the approved immutable source captures, not original archive payloads; original bootstrap metadata and, for the later finding classification, explicitly allowlisted nonexcluded root REPORT metadata are read. There is no recursive original/family search, excluded payload read/hash/execution, security investigation, guest real I/O or LLM call. Native fixtures and callback controls are pure and bounded. No extra unit test file is necessary because the existing proper-package 251-test set covers this scope.

| Unchanged approved original source                               | Bytes | SHA-256                                                            |
| ---------------------------------------------------------------- | ----: | ------------------------------------------------------------------ |
| `language/examples/12-typescript-cartesian-readonly-ranking.mjs` |  1109 | `cd7debc6a748a9003a0c2900894706ca641fb217f498c64dd022dda1414a57d3` |
| `language/reductions/10-reduce-nested-readonly.mjs`              |   173 | `994244aa12dc2147bf34c534203291046967ba84f8cd64fe288e56469104e1e3` |
| `language/reductions/13-sort-catch-reduce-reentry.mjs`           |   357 | `bbafae353985dc33473c5cb1fb7bef4437eeecd31f3a6863b590b1a68000414c` |
| `linear-algebra/examples/02-householder-qr-least-squares.safejs` |  4050 | `dba34834f1d7225b1096bd69853c979e3c7e8ae45c16fcecc3ce612647157ddd` |
| `linear-algebra/reductions/read-only-nested-map.safejs`          |    91 | `8a4656d74dbe0596c002b9ece35bf0c374e47a9b2c01b151b46c6cb0201e8904` |

All five source bodies execute unchanged twice. Native anchors are established before current-source runtime checks and compare complete results against the supplied original expectations. Exact current-main preimage execution yields **10 reentry failures**. Candidate execution yields **10 full native matches**, and completed snapshots yield **10 full replay matches**: **30 successful native/current/replay comparisons**, with no dropped fields or numeric tolerance. Cartesian combinations, all ranked rows and best row, sort/finally trace, nested reduction/map output and every Householder QR fixture, matrix, diagonal and solution are compared.

Full outputs and snapshots: `commands/original-native-anchors.json`, `commands/five-originals-baseline-red.json`, `commands/five-originals-current-replay.json`. `original-full-comparison-summary.json` indexes them. Active checkpoint and cleanup behavior is independently reexecuted by the two unchanged independent checkpoint cases and the author checkpoint controls; completed original replay is not used as a substitute for active coverage.

### Unresolved shadowed-map serialization — repair handoff

**`packages/safejs/src/graph-depth.ts:80` remains defective for arrays with an own `map` containing a source function, undefined, zero, or null.** All four normal guest programs return the same values as native on both unchanged main and the candidate. Public `dump()` then throws `TypeError: value.map is not a function` for all four on both versions. `graphEntries` calls the shadowable host `value.map` to enumerate array entries.

This is an **unresolved baseline serialization defect**, not a regression caused by LANG and not an established intentional mutation restriction. The own-property lookup contract accepts these values; the public dump documentation (`packages/safejs/README.md:274`) does not establish an own-map-shadow exclusion. This worker does not change graph-depth, expand production scope or silently close the issue. No replay/serialization approval is given for the four shadowed-map integration cases.

`shadowed-map-unresolved.json` retains exact baseline/candidate outputs and all eight TypeErrors. `commands/shadowed-map-unresolved-positive-contract-red.json` deliberately asserts the positive completed-serialization expectation and exits 1, retaining the failed assertion. `repair-handoff-shadowed-map.json` gives the exact path, line, normal source reproducers and RED receipt for coordinator routing to a separate author. A later repair or OBJ/snapshot combination needs fresh integrated validation.

The author’s initial GREEN contained four serialization failures; the frozen integration test file now marks those four cases direct-only. Its other four cases retain completed replay. The 202 author and 41 independent LANG oracles remain byte-identical to the inherited validated files. The original failed author log and baseline limit record are copied unchanged under `history/`; they are not discarded or claimed passing.

### Preserved diagnostics and limits

- Author initial root typing failed because declaration generation was still in flight. Both original failure and later success logs are retained. This worker waits for build completion before its passing typechecks.
- The metadata aggregation helper initially assumed separate map.test.ts/set.test.ts files and asserted 5 versus 7 discovered files. `aggregation-helper-failure.json` retains that diagnostic. The correction selects the actual configured collections files; the seven-file count and every test assertion remain intact.
- REPL state resets are recorded separately. Completed native/build/type/lint receipts survive; an incomplete full attempt is not credited. The final forced full gate has an independent complete receipt.
- Historical inherited repository-format and cross-issue qualifications remain in the captured readiness metadata. This validation checks exact publication-file formatting, not repository-wide formatting cleanliness. It neither reopens nor silently waives those historical items.
- General Map/Set reentrancy, callback thisArg, generalized array serialization/descriptors, CTX, and another actual-main combination are not added to LANG scope. No racing CTX files are accessed. No visual CLI change or live E2E is involved.

### Exact delta and prerequisite separation

The scoped LANG publication delta contains **six files only**: the five frozen author files below plus this new relevant validation plan. The author integration plan is included. There is **one exact existing preimage** and **five absent new-file identities**. All three tests reside in `packages/safejs/src/interp/methods/`; no evidence-tree test is a publication target.

| Frozen author path                                               | Role             | Pinned-base preimage SHA-256                                       | Postimage bytes | Postimage SHA-256                                                  |
| ---------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------ | --------------: | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/methods/array.ts`                    | production       | `6de97e76745d9bac348957c78717c7dda4766385ce004f92ce49d71202e874ba` |           23188 | `00ed651f1d5a526b270210a25ef483960bb791066a11d4319aba0e168543efee` |
| `packages/safejs/src/interp/methods/array-nested-reads.test.ts`  | test             | absent                                                             |           11944 | `d279f8cd1ffe93321e54cf60ea1b11b706ab73c1dedc4bcf9943cf79aa2b851d` |
| `packages/safejs/src/interp/methods/lang-01-validation.test.ts`  | test             | absent                                                             |           11259 | `5abe5b7958fefb1904634c810534f5f3166bb3917def9e8f0525b7505fd67eca` |
| `packages/safejs/src/interp/methods/lang-01-integration.test.ts` | test             | absent                                                             |            3434 | `6a617ab6a6a29587b6ed81eb3a89f4ff6158ac877f5a0c788fe8ef3d382a1c19` |
| `docs/plans/safejs-integrate-lang-01.md`                         | integration-plan | absent                                                             |            5636 | `672cb76dd8171da9c202f17d74e3368fc55f9647e706ddb9d3f2688c64ecca02` |

Additional publication plan: `docs/plans/safejs-validate-lang-01-ordered-integration.md` (absent on pinned main; its exact final bytes/hash are bound by the final manifest). No author file content is edited by this validator.

`prerequisites.json` records the external pinned main base, including the published ARRAY own-property ancestor `7fec2826bac2933483c2579ff47d2264f8e1f422` and already-published NUM behavior. These prerequisite files are **not** copied into or republished by the LANG delta. The sole source preimage is 22,757 bytes, SHA-256 `6de97e76745d9bac348957c78717c7dda4766385ce004f92ce49d71202e874ba`; the integrated postimage is 23,188 bytes, SHA-256 `00ed651f1d5a526b270210a25ef483960bb791066a11d4319aba0e168543efee`.

### Immutable handoff

`out/safejs-remediation/lang-01-ordered-validation/manifest.json` records the six-file delta and exact preimage/absence identities; `candidate/postimages/` and `candidate/preimages/` contain exact bytes. `evidence-index.json` binds the full receipts, originals and retained failures. `readiness.json` records scoped LANG readiness and the separate pending serialization fix. The captured tree is sealed read-only with macOS uchg after final verification; working author files and source permissions are not changed.

Publisher must check actual destination preimages and rerun full publisher gates. This frozen snapshot does not certify future actual main, a metadata release’s resulting tree, or any other combination. Final manifest/report hashes are returned separately to avoid recursive hashes.

## Historical interim hold — superseded by final scope disposition

The coordinator reports regex-order 11.0.15 published at `04370307df002810a336985a660585af4358b905`, with publisher intake held. The supplied current array preimage is `6de97e76745d9bac348957c78717c7dda4766385ce004f92ce49d71202e874ba`. It exactly matches this candidate’s captured preimage and `git show 32caeaddbac72bccea1cb3fd0a07fb293a1bee71:packages/safejs/src/interp/methods/array.ts`; the obsolete `ceb6b56c…` preimage is not used. No fetch or other-clone read is performed, and the whole newer publisher commit is not validated by this pinned snapshot.

The coordinator also requires no READY while any failure remains. Therefore the final status is **HELD / NOT READY**, notwithstanding passing LANG-specific gates. The four normal own-map-shadow dump failures are handed to the root at `packages/safejs/src/graph-depth.ts:80` with an explicit positive-contract RED receipt. Do not resume publisher intake on this manifest. No production scope is expanded and no failure is waived. The six-file capture, including both relevant plans, is immutable review evidence only until the remaining failure is repaired and validated or the coordinator explicitly resolves the publication scope.

## Final scope disposition and separate open finding

The coordinator subsequently directs: keep LANG approval scoped if unaffected, explicitly disposition the newly observed serialization failure, and provide one frozen handoff for a distinct author. This supersedes the interim publication hold above; it does **not** waive or resolve the bug. LANG is **SCOPED READY** because all LANG tests and originals pass and the identical shadowed-map failure occurs before and after the isolated LANG delta.

Minimal benign guest case:

```js
const values = [1];
values.map = 0;
return 1;
```

Native and both runtime versions return 1. `dump(result)` throws `TypeError: value.map is not a function` at `packages/safejs/src/graph-depth.ts:80`; deleting only the `values.map = 0` assignment makes dumping succeed. This contains no callback, sparse array, source closure, external capability, security probe, or guest I/O. The four existing function/undefined/zero/null shadow controls also remain captured, so the minimal numeric case is not the entire known reach.

**Disposition: real bug, NEW FOLLOW-UP / PENDING FIX, not an intentional documented restriction.** The public dump contract accepts completed runs; `CHECKPOINT_REPLAY.md:30` describes completed-run replay, while its opaque-host-handle limitation does not fit this data-only example. Published ARRAYOWN tests accept own fields and own map shadowing. No documented own-map-shadow exclusion is found. This is tracked explicitly rather than dismissed as unrelated.

Original-finding attribution uses only guarded root REPORT metadata, SHA-256 `40d467e72bd741dfeaa5c6b776c3d2cc7dc61d622e0e08419c05506c2c428fb1`, lines 489–498. Original OBJ-002 is the sparse-array clone/checkpoint failure (`undefined is not iterable`), and ARRAY-OWN-METADATA concerns accepted own writes/enumeration disagreeing with reads. The checked report has no shadowed-map entry. Thus this is a **newly discovered shadowed-map follow-up/case**, related to those original findings, not a separately named original case. A separate authoritative 47-entry registry was not supplied/read, so no original47 ID or extra independent root-cause count is invented; coordinator triage may deduplicate it into OBJ-002. It remains explicitly open either way. No linked original source/result/security payload is read for this attribution.

Separate immutable handoff: `out/safejs-remediation/shadowed-map-serialization-handoff/manifest.json`, SHA-256 `b0180aa4b983af140d713e51a17360aec6dc501f9928cb9fd1be9832b9dcffcf`. It retains the minimal baseline/candidate/control outputs, four-shadow baseline/candidate outputs, positive-contract RED, exact graph-depth preimage/hash, contract excerpts, original-finding metadata and pending-fix disposition. It contains no production changes or publication delta. Per coordinator, CTX/Anscombe’s qualification is the same issue: reuse this one handoff; do not duplicate their source investigation or race a second repair. A distinct author must produce proper-package regression tests and a fix, followed by fresh integrated validation of affected combinations.

The final LANG manifest keeps the six-file delta separate from the external pinned main prerequisite and this open issue. It may support scoped LANG intake, but does not approve the newer publisher tree’s full combination or close the overall remediation goal.
