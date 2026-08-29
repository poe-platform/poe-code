# COLL-001: direct collection iteration

## Scope and constraints

- Implementation worker only; independent final validation and publication belong to other agents.
- Base: `9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc`, clean workspace `/Users/kjopek/Workspace/poe-code-safejs-fixes` on `main`.
- Change only SafeJS implementation/tests and this plan. No README, other issue, commit, push, branch, pull, or dependency installation.
- Audit is read-only. Before family reads, bootstrap `archiveReadPolicy` from `inventory-verification.json`: exactly 38 excluded paths plus all `security/**`. Restrict further reads to COLL-001 report passages and the `collections` and `set-iteration-review` families. No excluded payload reads or security probes.
- New regression tests use in-memory source strings and collections only: no fixture disk writes, LLM, or host/guest network, filesystem, or process capabilities.

## Initial base mechanism

`evaluateForOfStatement` calls `snapshotableIterationValues`, which materializes both Map entries and Set values using `Array.from`. These collections bypass the existing iterator loop entirely. That freezes membership and primitive values, hiding additions and updates and retaining deleted entries.

Additionally, `getSandboxIterator` independently materializes Map entries. Map and Set storage are already native collections, and the shared Set iterator is already live; however, the snapshot fast path prevents direct Set loops from using it. Initial inspection of the shared iterator alone was insufficient: the red integration tests confirmed both historical Map and Set failures still reproduce at this base.

The explicitly eager `keys()`, `values()`, and `entries()` methods must remain arrays with captured membership. Their implementation and callback mutation policy are outside this fix.

## TDD sequence

1. Add direct growth, deletion/update, complete graph worklist, clear/insertion, reinsertion, iterator independence/exhaustion, and pair-identity regressions.
2. Add all six explicit eager-method compatibility controls.
3. Run the focused suite before changing production code and record actual failures for both Map and Set.
4. Remove Map/Set from the snapshot fast path so direct loops use the existing iterator evaluator; replace the Map snapshot in `getSandboxIterator` with its backing Map iterator. Leave arrays, strings, Set iterator construction, and eager methods unchanged.
5. Run focused tests, relevant broader SafeJS checks, formatting/type checks, and hand off for independent validation.

## Audit case mapping

- `collections/07-map-worklist-reachability.ajs` and `08-set-worklist-reachability.ajs`: preserve the complete graph, traversal, distances, path reconstruction, and seven reachable vertices in inline test adaptations.
- `10-map-growth-reduction.ajs`, `11-set-growth-reduction.ajs`, `12-map-update-delete-reduction.ajs`, and `13-set-delete-reduction.ajs`: preserve the ordinary direct-loop mutation cases.
- `14-eager-map-entries-control.ajs` and the Set review eager-values control: extend compatibility coverage to all six explicit eager methods, checking arrays and captured membership against final live membership.
- Historical Set failures are not assumed to reproduce at the current base.

## Execution results

- Red: `node_modules/.bin/vitest run packages/safejs/src/interp/globals/collections-iteration.test.ts` exited 1: 11 failed, 7 passed, 18 total; test time 88 ms. Both worklists processed only `start`, reached three vertices, and returned an empty route; growth/deletion/update/clear/reinsertion cases exposed stale membership. The shared Map iterator also failed the before-first-pull update check. All six eager controls and pair-identity control passed.
- Green: the same focused Vitest command passed all 18 tests after the minimal production change; test time 87 ms, total duration 814 ms.
- Broader package checks: the following command passed all 572 tests across seven files; total duration 1.85 seconds.

```sh
node_modules/.bin/vitest run \
  packages/safejs/src/interp/globals/collections-iteration.test.ts \
  packages/safejs/src/interp/globals/collections.test.ts \
  packages/safejs/src/interp/globals/object-array.test.ts \
  packages/safejs/src/interp/generator.test.ts \
  packages/safejs/src/interp/patterns.test.ts \
  packages/safejs/src/interp/values.test.ts \
  packages/safejs/src/interp/interpreter.test.ts
```

- `node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`: passed, exit 0.
- `node_modules/.bin/eslint packages/safejs/src/interp/iteration.ts packages/safejs/src/interp/interpreter.ts packages/safejs/src/interp/globals/collections-iteration.test.ts`: passed, exit 0.
- `node_modules/.bin/prettier --check packages/safejs/src/interp/globals/collections-iteration.test.ts docs/plans/safejs-fix-coll-001.md`: initially flagged the new test's formatting; applied Prettier's output through `apply_patch`, then passed.
- `git diff --check`: passed. No CLI visual changes; no screenshot run needed.
- Dependency binaries became available during test authoring; this worker performed no dependency installation.

## First handoff and remaining risks

Implementation and implementation checks are complete; final validation must be performed by a separate agent. No commit or publication was performed.

Changed paths:

- `packages/safejs/src/interp/interpreter.ts`: remove collection snapshot branches so direct Map/Set loops use the existing iterator evaluator.
- `packages/safejs/src/interp/iteration.ts`: wrap the native Map entry iterator instead of a prebuilt array.
- `packages/safejs/src/interp/globals/collections-iteration.test.ts`: 18 regressions/compatibility controls.
- `docs/plans/safejs-fix-coll-001.md`: this scoped implementation record.

All six selected historical direct-loop cases reproduce as correctness failures in the red run and pass in green, including both full worklists and both Set reductions. Audit sources were adapted into inline tests; archive drivers and native audit processes were not rerun. All six deliberately eager API controls remain green.

Checkpoint/resume under collection deletion or reinsertion is not newly certified: the existing iterator evaluator restores a positional iteration index rather than serializing a native iterator cursor. Broader interpreter/generator checks pass, but independent validation should assess that boundary separately if required. No checkpoint format, callback mutation policy, eager API, or other issue was changed. No security/adversarial archive payloads or probes, real LLM, or external host/guest capability integrations were exercised. The original workspace remains untouched.

## Reopened after independent validation

The first handoff is superseded. Galileo found 11 blocking raw-cursor restoration failures in the unchanged 112-test `collections-iteration-validation.test.ts` suite. The implementation worker reproduced those failures before editing production. Neither the validator tests nor its report or retained red log were modified. Public journal replay passing does not waive the raw interpreter failures.

### Root cause and repair

- `isRestorableBindingValue` rejected branded Maps/Sets, so declaration replay rebuilt initializers and discarded captured mutations. It now recursively accepts restorable collection data, using a weak visited set to preserve cyclic graphs without recursion loops. Existing unsupported function/generator/promise/regex handling remains intact.
- Counting completed visits is not a cursor into the surviving membership after deletion, clear, or reinsertion. The live collection iterator now exposes checkpoint-only `snapshotIndex()`: it counts the native iterator's remaining suffix, computes its position in current membership, and reconstructs the native iterator at that position. It does not copy a worklist during ordinary traversal and preserves the distinction between a cursor at the end and an already-exhausted iterator.
- A snapshot saves the current iteration value and its collection together in a collision-free internal binding named `#for-of:<nodeId>`. Both participate in the existing binding graph clone/serialization, preserving object-key/value aliases and cycles. The existing `{ index, values }` loop-state shape stores the next cursor position and the internal binding name; no additional production file or snapshot schema edit is needed.
- Restoration resumes the saved current entry once, then advances from the saved next cursor. This also handles an outer current entry deleted before a nested loop checkpoint, clear/reinsert, and inline collection expressions.
- Existing plain-JSON inline-collection checkpoints flatten native collection storage. When their collection brand is absent, retain the saved current entry while evaluating the inline iterable as before. This repairs the two existing compatibility tests without changing their expectations.
- Explicit eager methods, callback mutation policy, array/string iteration paths, generic iterators, and other workers' frozen files are unchanged.

### Follow-up red/green commands

All commands run in `/Users/kjopek/Workspace/poe-code-safejs-fixes`.

```sh
node_modules/.bin/vitest run packages/safejs/src/interp/globals/collections-iteration-validation.test.ts
node_modules/.bin/vitest run packages/safejs/src/interp/globals/collections-iteration.test.ts
node_modules/.bin/vitest run packages/safejs/src/interp/globals/collections-iteration-validation.test.ts packages/safejs/src/interp/globals/collections-iteration.test.ts
node_modules/.bin/vitest run packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/interp/globals/collections-iteration-validation.test.ts packages/safejs/src/interp/globals/collections-iteration.test.ts
```

| Execution                                                           | Exit | Actual result                                                                                                                                                |
| ------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Independent suite, before follow-up production edits                | 1    | 11 failed, 101 passed, 112 total; 1.90 seconds                                                                                                               |
| Author suite after adding six cursor cases, before production edits | 1    | 5 failed, 19 passed, 24 total; 1.23 seconds                                                                                                                  |
| First combined focused green                                        | 0    | 136 passed: unchanged validator 112 + author 24; 1.69 seconds                                                                                                |
| First broader 17-file run                                           | 1    | 2 failed, 873 passed, 875 total; 4.73 seconds. Both failures were existing plain-JSON inline Map/Set checkpoint tests; repaired in production, not weakened. |
| Interpreter plus both focused suites after compatibility repair     | 0    | 613 passed in three files; 1.71 seconds                                                                                                                      |
| Final exact independent command                                     | 0    | 112 passed, no failures; 1.42 seconds                                                                                                                        |
| Final broader command below                                         | 0    | 875 passed in 17 files, no failures/skips; 4.18 seconds                                                                                                      |

All 11 independent red cases are green: Map/Set growth, delete-next, delete-current final membership, clear/insert, and current-entry reinsertion, plus Map next-value update. The original 18 author tests remain present and passing. Six additional author cases cover cyclic collection data/object aliases, deleted outer entries at nested checkpoints, inline Map iteration, and clear/reinsert before nested checkpoints; every captured loop breakpoint is resumed against the native/uninterrupted result.

### Final broader command and per-file results

```sh
node_modules/.bin/vitest run \
  packages/safejs/src/interp/globals/collections-iteration-validation.test.ts \
  packages/safejs/src/interp/globals/collections-iteration.test.ts \
  packages/safejs/src/interp/globals/collections.test.ts \
  packages/safejs/src/interp/globals/object-array.test.ts \
  packages/safejs/src/interp/generator.test.ts \
  packages/safejs/src/interp/patterns.test.ts \
  packages/safejs/src/interp/values.test.ts \
  packages/safejs/src/interp/interpreter.test.ts \
  packages/safejs/src/run.random.test.ts \
  packages/safejs/src/run.completed-replay.test.ts \
  packages/safejs/src/dump.test.ts \
  packages/safejs/src/restore.test.ts \
  packages/safejs/src/snapshot/restore.test.ts \
  packages/safejs/src/snapshot/serialize.test.ts \
  packages/safejs/src/run.snapshot.test.ts \
  packages/safejs/test/integration/crash-resume.test.ts \
  packages/safejs/test/integration/snapshot-roundtrip.test.ts
```

| File under `packages/safejs/`                                 |  Passed |
| ------------------------------------------------------------- | ------: |
| `src/interp/globals/collections-iteration-validation.test.ts` |     112 |
| `src/interp/globals/collections-iteration.test.ts`            |      24 |
| `src/interp/globals/collections.test.ts`                      |      11 |
| `src/interp/globals/object-array.test.ts`                     |      15 |
| `src/interp/generator.test.ts`                                |      16 |
| `src/interp/patterns.test.ts`                                 |      10 |
| `src/interp/values.test.ts`                                   |      25 |
| `src/interp/interpreter.test.ts`                              |     477 |
| `src/run.random.test.ts`                                      |      28 |
| `src/run.completed-replay.test.ts`                            |       8 |
| `src/dump.test.ts`                                            |      11 |
| `src/restore.test.ts`                                         |      17 |
| `src/snapshot/restore.test.ts`                                |      62 |
| `src/snapshot/serialize.test.ts`                              |      15 |
| `src/run.snapshot.test.ts`                                    |      31 |
| `test/integration/crash-resume.test.ts`                       |      11 |
| `test/integration/snapshot-roundtrip.test.ts`                 |       2 |
| **Total**                                                     | **875** |

The integration fixtures use in-memory backends/memfs and stubbed agents/operations, not real guest network, filesystem, processes, or LLM calls.

### Follow-up handoff

- Production changes remain confined to `interpreter.ts` and `iteration.ts`; author changes remain confined to `collections-iteration.test.ts` and this plan. No additional production path was needed or claimed.
- Package `tsc --noEmit` and scoped ESLint pass. Prettier identified only the newly changed restorable-binding signature in production; formatting was corrected using `apply_patch`. Owned production diff checks pass.
- Snapshot cursor capture is linear in current collection size, performed only on capture. Normal traversal remains native/live. This is not a certification of arbitrary legacy raw snapshots that already discarded collection contents or insertion history.
- The 112-test validator file remains SHA-256 `9eb79e3bd34244fc59f90840c3d8dd49ba60165efe1dd65a4677c60233086814`; the retained validator report is `13e8bf2d1b4d7a4583e9b8b27cfd98a87ea6a11fcee3928def418dd1d075b363`; retained `final-focused.log` is `53fbd99244e339c94cab2c63a6abe0c47c9666b82198dc74bb6265e46e33a0eb`.
- No Git mutation, publication, dependency installation, other-issue fix, or frozen-file edit occurred. Galileo must independently revalidate this revised implementation before publication.
