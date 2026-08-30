# Independent O01 validation — August 30, 2026

## Scope and restrictions

Review Plato's immutable seven-path candidate, not author a replacement. Work directly in this fresh isolated main clone. Do not alter the original dirty checkout, author workspace, README, skills, master ledger, or home configuration. No commits, pushes, nested agents, exploit stress, deadline increases, or unrelated regular-expression review.

Candidate manifest SHA-256: `53eddaee3cc644efa6e22857582b24a9996b203983cb4f16b042c5ffcbcdf7d5`.
Candidate patch SHA-256: `ba51476a6abf7d174fd8a84a769bc4d025402a6218066d5be80b69e0ca5e9844`.
Author base: `af779824231010e84f334337d3416e9658641442`.
Fresh clone and fast-forward pull: `1fede06f0956d5133b3e94eb4508f3e710c7d156`.

## Agent-executed validation sequence

1. Verify every candidate artifact and exact seven-path patch; compare current and author preimages without relying on the author's build.
2. Resolve original O01 worklist only through approved copied capsule metadata. Never dereference logical original/A paths or read original audit/security archives. Record missing original qualification if no approved copy is established. Report a C06 sticky copy locator only if directly established in the same metadata.
3. Install current locked dependencies locally with global skill sync disabled. Reproduce focused RED before production patch and GREEN after exact application.
4. Inspect cursor ordering, mutation notifications, explicit reentry guards, cleanup, retained-data accounting, step and depth limits. Compare bounded append/delete/readd/clear/throw/thisArg/nesting controls with native Map/Set.
5. Run current source and freshly built public entrypoints, genuine pending checkpoints, new-process replay, alias assertions, complete journals, and zero completed-call reissues. Preserve all original resource caps and timeouts. Do not substitute new controls for an absent original oracle.
6. Run SafeJS unit tests, current build, production types, owned strict fixture types, lint, and formatting. Keep unchanged expanded array-fixture diagnostics separate from owned strict results.
7. Freeze evidence, exact preimage records, report, manifest, and sidecar hashes. State bounded readiness separately from original-case qualification and publication readiness.

## Independent disposition

**READY_BOUNDED_CANDIDATE.** No blocking implementation defect was found in the exact seven-path candidate under the bounded checks below. This is not original-case closure, publication approval, or a claim covering arbitrary native iterators/classes. **Full O01 original qualification remains NOT READY: the approved executable original copy was not established.**

The reviewer did not author or amend the production patch. All seven applied files still match Plato's frozen postimage hashes. No nested agents, commits, pushes, original-checkout writes, README/skill edits, or home-configuration changes were performed. The only reviewer-authored tracked-path artifact is this document. Installation disabled global skill sync and used a clone-local npm cache. Generated evidence and build outputs remain in this isolated clone.

Immutable capsule: `out/safejs-remediation/o01-independent-review/candidate-20260830-b16e7eeb-independent/manifest.json`. Its SHA-256 is in the adjacent `manifest.sha256`; this report's hash is in the adjacent `report.sha256`. The capsule contains the report, exact author manifest/patch, preimages, both validation generations, and hash-indexed evidence. Files are sealed read-only with macOS immutable flags after verification.

## Source and dependency boundaries

The clone was created from upstream `main` and pulled before work at `1fede06f0956d5133b3e94eb4508f3e710c7d156`. Initial gates passed there: 61 focused tests, 8,751 SafeJS tests with 39 skipped, and a fresh 68-task build. Those receipts are preserved separately under `baseline-1fede-evidence`, not relabeled as a later build.

During finalization on August 30, 2026, a remote check found `b16e7eeb20cdf56d726267de2b5fa5d356157278`, adding Float32Array source and replay support. The isolated clone was fast-forwarded again. There was no overlap with the seven candidate paths. All production/source/build/replay gates below were then repeated against **b16e7eeb**, including a forced build with **zero cached tasks**. Float32Array is therefore present in this reviewed source composite; npm publication was not checked or claimed.

The actual checked-in lockfile SHA-256 is `b7d81fc4361d00a1c8f7eefb666c1f15d14b3ca80cfd6e281976133adb97db5f`. At these heads, `node_modules/@poe-code/safe-fs` is locked as a link to `packages/safe-fs`, version `0.0.0-dev`. It is not an independently verified external-registry pin. `package.json`, `package-lock.json`, `packages/poe-agent/package.json`, and `scripts/bundle.mjs` did not change between 1fede06f and b16e7eeb. The first locked installation consequently remains applicable; no dirty dependency changes from the original checkout were copied in. Evidence records actual root package, lockfile, bundle script, and built entrypoint hashes.

The publisher must pull again and recheck any later dependency/source changes. This review approves neither a future dependency pin nor an untested later main.

## Exact patch and preimages

All 28 artifacts listed by the author manifest independently match their byte counts and SHA-256 hashes. The patch target set exactly equals the manifest's seven paths: three production files, three test files, and the author's plan. Forward application in temporary indexes, resulting blob hashes, reverse application checks, and whitespace checks pass. The real Git index was not staged.

| Modified path                                      | Exact preimage SHA-256 at author base, 1fede06f, and b16e7eeb      |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/methods/map.ts`        | `c256f2b1a349a0ac054aeba9376580750686bdda7d775c3e88b19454fd5b1765` |
| `packages/safejs/src/interp/methods/set.ts`        | `b6c533dedd720dc223367a6bb5b74cf6b42b6bb56818ae9db14a347cd6218c7d` |
| `packages/safejs/src/interp/running-state.test.ts` | `83efec1a4d1ecb5e3f15c48b6422ed10570e84fff03e620edf66325ca1c31c75` |

The four additions have absent preimages: `docs/plans/safejs-o01-mapset-callback-mutation.md`, `packages/safejs/src/interp/methods/collection-callback.ts`, `packages/safejs/src/interp/methods/mapset-callback-mutation.test.ts`, and `packages/safejs/src/interp/methods/mapset-callback-replay.test.ts`. Every postimage is checked against the author manifest; no reviewer production fix was introduced.

Temporary-index result trees:

- Author base af779824: `daffe3ec5c4237bb38cf798dc587cb2c25f1e9d6`, exactly reproducing the author's tree.
- Initial current base 1fede06f: `7962a2a402c36be73b7e0d75eb1eac6ad5742434`.
- Final validated base b16e7eeb: `2ef0fc18427b37d3c81445629ee24c48564bd336`.

## Root-cause review

- `collection-callback.ts:15` gives each callback traversal a separate pending-key Set. Map `set` and Set `add` notify only on a genuinely new insertion; successful deletion removes unvisited keys; clear removes pending keys. Deletion followed by readdition appends a new visit. Map values are retrieved at visitation time rather than captured before callbacks.
- Nested callbacks share the receiver's running-state lifetime but have independent pending sets. Mutation notifications reach every active cursor. The outer cursor is not replaced by an inner cursor, and callback return values do not terminate traversal.
- Initialization charges every inserted pending key, cursor advancement charges a step, and each mutation notification charges each affected cursor. Collection-entry and retained-data limits remain enforced. Pending values participate in retained-value accounting; exit clears accounting and references. Cleanup covers normal return, thrown sentinel, initialization failure, nested failure, and budget exhaustion.
- This is not merely guard removal. `packages/safejs/src/interp/running-state.ts` is unchanged; `assertCollectionMutable` remains in mutation methods. An explicitly already-running receiver still rejects entry. Array mutation locks, snapshot guards, and generator/iterator exclusions retain their tests.
- Transient native collection iteration is used only inside charged synchronous traversal operations. No raw native iterator is stored in callback cursor state or persisted across restore. There is no unbounded native-forEach fallback. Small nonterminating append and delete/readd controls reject at the unchanged configured step limit, and nested recursion rejects at the configured call-depth limit.

## Independent execution results

The final b16e7eeb receipts are under `evidence`; the original 1fede06f receipts remain under `baseline-1fede-evidence`.

| Gate                                                                    | Independent result                                                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| RED before production application, final candidate fixtures on 1fede06f | 33 failed / 24 passed, reproducing the old refusal; not relabeled as the author's earlier 23 RED / 36 GREEN development stage |
| Focused final candidate tests on b16e7eeb                               | 61 passed across 3 files                                                                                                      |
| Complete SafeJS default suite on b16e7eeb                               | 8,781 passed / 39 skipped; 221 files passed / 1 skipped                                                                       |
| Forced current build                                                    | 68 successful tasks, 0 cached; root bundle and SafeJS public bundles rebuilt                                                  |
| Production types                                                        | PASS                                                                                                                          |
| Strict types of the two new owned test fixtures                         | PASS                                                                                                                          |
| Expanded strict check including running-state fixture                   | Exactly 3 unchanged array-fixture diagnostics; qualification below                                                            |
| ESLint, all six candidate TypeScript files                              | PASS                                                                                                                          |
| Prettier, all seven candidate paths                                     | PASS                                                                                                                          |
| Exact patch/reverse check, postimages, `git diff --check`               | PASS                                                                                                                          |

Fourteen independent finite controls are compared with native JavaScript through the public source index and the freshly built `poe-code/safejs` export: **28 native matches plus 28 completed restores**. Cases cover append, delete-unvisited, readdition of visited and unvisited keys, clear/reinsert, current/next value update, nested mutation with caught inner throw and subsequent traversal, strict primitive/undefined/null thisArg, empty-receiver invalid callback, SameValueZero, object identity, cycles, aliases, and direct for-of after callback completion. Complete return graphs are compared, not only success flags or final collection sizes.

Both source and built entrypoints also run six bounded guard controls: Map/Set append, delete/readd, and recursive nesting. Append/readd reject at steps **501 > 500**; nesting rejects at call depth **5 > 4**. Guest catch handlers do not swallow the budget exception. Candidate resource tests additionally cover retained-state initialization/addition/nesting failure, native-closure callback accounting, array-length limits, cleanup, explicit reentry, and bounded single-entry reinsertion.

Finite reviewer controls retain `maxSteps: 3000`, `maxCallDepth: 32`, `arrayLength: 64`, and `dataSize: 10000` across original runs and restores. The five-second abort bound is never increased. No original oracle cap was changed because the original recipe was not executed. The author's existing recovery fixture deliberately tests failure at 120 steps, repeated failure at the same cap without reissuing completed effects, and then a separately declared 3,000-step recovery. That fixture is preserved, not misrepresented as same-cap completion or original-worklist qualification.

## Pending, fresh-process, and journal validation

Four fresh lifecycle origins run on the final source: Map and Set on both source and built public surfaces. Each origin completes one `start` call, three synchronous `record` calls, and reaches three genuinely unresolved `pause` calls at keys a/c/d. Dumps are captured while the run remains incomplete and all three promises remain held. The callback returns a promise that forEach does not await; the checkpoint deliberately tests pending callback tasks after visitation, not a fabricated persisted native iterator.

An independent process restores each origin's pending and completed checkpoint through both source and built exports: **16 fresh cross-surface restores**. Each is then dumped and completed-replayed again: **16 further completed replays**. Pending restores reissue exactly the three declared unresolved pause operations, never the completed start/record effects. Completed restores and subsequent completed replays issue **zero external calls**.

Full cyclic/aliased results equal the native reference, including root/alias identity, self-cycle, and aliases shared by callback answers. Full `snapshot.hostCalls` and full modern `snapshot.replay` equal their originating completed checkpoint without stripping fields, sorting entries, dropping run IDs, or normalizing outcomes. The capsule retains complete serialized checkpoints and both whole journals.

One earlier validator attempt compared modern journals from two independently originated executions; their intentionally distinct run UUIDs made that assertion invalid. The corrected check compares each restored journal against its own exact origin, including UUIDs. The initial validation mistake and dependent missing-artifact read are explicitly preserved in `validation-adjustment.json`; no product code, journal contents, resource caps, or rejection outcomes were altered to obtain a pass.

## Original-copy qualification and C06 handoff

**Q1 — missing original O01 qualification, not closed by new controls.** The approved H3 followup manifest hashes to `d513b006769864efbabf45adcbdb4a21237a9d4c31e09e1295c5022e16b6d848`; its oracle index hashes to `939e2b555497f19c21eeb1c73073290a51c0654594887a667b56157e41bf46ff`. The approved copied inventory metadata is:

`/Users/kjopek/Workspace/poe-code-safejs-final-composite-validation/out/safejs-remediation/final-oracle-resolution/candidate-20260829-6e3733a0-h3-followup/data/00ca8535d28a90d9bc0810090db149a91491a6ed1048d8e55c75fa7d3f78a822.json`

Its envelope SHA-256 is `94362e4e5b7f9ffacfae75d10ad32eb081e8b42b31444b25f183075c8157e5d4`; the verified embedded metadata text SHA-256 is `00ca8535d28a90d9bc0810090db149a91491a6ed1048d8e55c75fa7d3f78a822`. Only this copied metadata was read, never its logical original archive path.

That metadata confirms `collections:09-map-foreach-worklist` with source SHA-256 `e2f0eaf935504804faf4b9b5439c3af0a0ad839a02b07278bae266a3690d9541` and 858 original bytes. However, the followed approved data catalog, hash-verified parent catalog, and approved dispatch inventory do not establish an executable approved copy for that identity. The old disposition Map control is a different control, not a substitute. Original source/expected/input/schedule/cap execution remains unqualified. A publisher must obtain an explicitly approved, hash-bound copied capsule before claiming original-case closure.

The same copied metadata identifies `strings:c06-sticky-flag`, source SHA-256 `3bc2c2e1e66d5f8c014f7400e4cb89b26963f732ae4ace7470223ba938f6f764`, 92 original bytes. **No approved executable-copy locator or matching sidecar was established**, so none is invented here. This hash identifies the historical source in metadata, not a newly located copied payload. No unrelated regex review or execution was done.

All metadata read locators and hashes are recorded in `oracle-resolution.json`. Original archive/security payload reads and logical A/path dereferences are zero. H3's existing lost-initial-chronology qualification is preserved; this review does not retroactively certify it.

## Expanded fixture type qualification

**Q2 — three preserved, out-of-owned-scope array diagnostics.** Strict expansion reports TS2345 at `packages/safejs/src/interp/running-state.test.ts:104`, `packages/safejs/src/interp/running-state.test.ts:114`, and `packages/safejs/src/interp/running-state.test.ts:117`. They arise from the unchanged Array comparator fixture's `readonly never[]` callback arguments.

An independent TypeScript compiler-host check overlays the b16e7eeb HEAD preimage in memory, without writing a test file. All three candidate diagnostics exactly equal the baseline array diagnostics, including locations and full messages. The modified Map fixture no longer has its former type diagnostics. Production types and the two new owned fixtures pass strictly. The expanded command's exit 2 is retained, not turned into an all-tests-typecheck success or repaired outside the seven-path scope.

## Handoff limits

- Eligible for root-publisher consideration: the exact hashed seven-path candidate on the verified b16e7eeb preimages, with this bounded readiness decision and Q1/Q2 preserved.
- Not eligible to claim: original O01 worklist closure, C06 copied-oracle resolution, broad array-callback compatibility, arbitrary native iterator/class support, or npm release success.
- No CLI presentation was changed, so screenshot validation is not applicable. No standalone QA runner, new screenshot tests, broad security stress, slow-adversarial opt-in, or timeout increases were introduced.
- Integration/publication remains the root publisher's responsibility. Re-pull, check exact current preimages and dependency identity, and rerun affected actual-main gates if the source composite advances again.
