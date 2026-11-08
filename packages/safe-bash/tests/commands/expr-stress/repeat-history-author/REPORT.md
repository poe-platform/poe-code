# Bounded repeat/history implementation checkpoint — unpromoted

August 27, 2026. Actual delegated implementation leaf; no redelegation. This is
a **source candidate**, not public integration, normative acceptance, full GNU
parity, or a complete expr qualification. No independent POSIX research was
duplicated. Curie's result and a root policy decision remain prerequisites.

## Frozen input and promotion boundary

- Approved Git source base: `21220b465537bf45ffcfb36740956a69f43bf75e`.
- Before-code baseline commit:
  `e9480736ed91e46a4074288888d2e4a8dbc9f802`.
- Baseline worker SHA-256:
  `f5c67e9c76b584337ae506b59449ecdcd945207b2269fdb4f79c5d1f7e81aff0`.
- Final candidate worker SHA-256:
  `663b0b9010d939df16910c75d543f7a41cee832d6cd7cc2ab142996386206890`.

The implementation is `candidate-bre-worker.ts.data`, deliberately classified
as source-candidate DATA, plus `candidate.patch`. Its only product target is
`src/commands/expr/bre-worker.ts`. The candidate is materialized and built in
a unique isolated snapshot of the approved Git inputs, **never in live src or
dist**. Shared protocol/client/worker/matching files, root exports, package
configuration, and prior evidence are unchanged. The task-owned `/tmp` copy is
`/tmp/expr-repeat-author-20260827.patch`. Applying it requires a separate decision.

The architecture can be implemented, but selecting final repeated/nested
capture policy cannot truthfully be claimed from the available interpretation.
This uses the user's explicit patch/evidence fallback. Retaining the old
first-completed DFS tie preference is a provisional policy, not a new normative
comparator. Histories are retained for that later decision, not used as a fake
proof of priority. No unsupported guard remains in this isolated candidate;
the live worker still has its original behavior.

## Mechanism and bounds

1. **Static lowering:** each repeat body is compiled once, with repeat-enter and
   repeat-end instructions linked by the entry PC. Finite intervals no longer
   duplicate the body. Group metadata for repeated descendants is compiled with
   charged traversal and array growth.
2. **Dynamic progress:** each active frame has static entry identity, dynamic
   activation identity, completed count, entry position, required status,
   immutable iteration identity, and history checkpoint. Iterations retain
   parent-iteration links. Forks copy only the capture/frame vectors; immutable
   records and history prefixes are shared without later mutation.
3. **Capture history:** absent, open, and completed states are distinct. Opening
   invalidates completion rather than pairing a new start with a stale end.
   Immutable events record group, state, enclosing iteration, and predecessor.
   Each iteration first records descendant nonparticipation; subsequent open/
   close events record actual participation. The backreference registers retain
   the last participating descendant provisionally; absence in an iteration's
   history does not silently clear an earlier completed register.
4. **Repeat exit:** an optional exit is forked before entering the next iteration.
   Required empty occurrences advance a finite required count. An optional sole
   empty occurrence can participate, but an optional empty overwrite after a
   prior occurrence is discarded. Both the empty rule and descendant retention
   are provisional, not independently accepted POSIX policy.
5. **Selection:** only completed paths with no open captures or active frames
   can win. Whole endpoint is compared first; equal endpoints retain traversal
   order. No flat final-capture-length comparator, capture-vector dominance,
   PC-only epsilon guard, GNU anomaly rule, or native-input special case is used.
6. **Termination:** the only backward edge is repeat-end. A returning iteration
   either consumed input or was a required iteration advancing toward the finite
   minimum. Sole optional empty participation exits; further optional empty
   paths stop. Branch enumeration can still be exponential. Work/state/allocation
   exhaustion throws rather than publishing the best-so-far match.

Reservation order is changed at the actual construction sites: AST and
instruction nodes are admitted **before** object construction; initial and fork
states are admitted before vector/state creation. Parser collections, class-name
copies, decoder/token arrays, repeat metadata, immutable frames/iterations,
capture/history events, and reply objects have prior reservations. Traversals,
set membership scans, capture completion scans, and backreference comparisons
are charged before their bounded loops. State/node counters check ceilings before
increment, and cumulative allocations are never refunded.

The logical accounting uses 12 units per AST/instruction node; vector lengths
plus 12 per fork; 10 per frame; 16 for a new iteration plus replacement frame;
4 per capture; 6 per history event; and 16 for the result. Symbol conversion
reserves `8 * inputBytes + 16`; tokenization reserves `4 * symbolCount + 16`.
These are conservative logical reservations, **not measured JavaScript heap
bytes/RSS or a promise that every byte-admitted input fits the allocation cap**.
For example, large inputs may exhaust allocation earlier than the old worker.
Worker heap/stack caps and parent termination remain separate safeguards.

No new wire fields or host work were introduced. Existing validated byte spans
are returned from completed captures only. Raw C bytes and scalar-to-byte
boundaries are separately tested. No `eval`, untrusted main-thread regex,
dependencies, native product processes, or host product I/O were added.

## Exact observations, not acceptance counts

The original eight, original five failures/three controls, historical
prototype's **projected 4/5** apparent improvements, still-failing `aaa`, and
both old prototype regressions remain unchanged in their original archives.
`baseline.json` authenticates all entries in the three historical evidence trees;
its original-eight object and two regression objects retain the old observations.

Final native oracle is the existing GNU9.7/Darwin binary with SHA-256
`e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c`.
Native calls use isolated unique cwd, literal bounded argv, two-second timeout,
16-KiB output bound, and exactly PATH `/usr/bin:/bin`, LC_ALL/LANG/LANGUAGE `C`,
TZ `UTC`. All 24 tuples are checked against the old frozen tuples. Binary hashes
are checked before/after. This is not GNU/Linux, another libc, or locale coverage.

Each row has two actual executions: `Shell.exec` through the expr plugin for
CLI status/stdout/stderr, and a separate `RegexExecutor` request for validated
whole/capture spans. CLI results below are **not projections from internal spans**.

| Original case | Candidate CLI status / stdout hex | Internal whole / capture | Frozen GNU CLI agrees? |
| --- | --- | --- | --- |
| empty | 1 / `0a` | `[0,0] / [0,0]` | yes |
| a | 1 / `0a` | `[0,0] / [0,0]` | yes |
| aa | 0 / `610a` | `[0,2] / [0,1]` | yes |
| aaa | 0 / `610a` | `[0,3] / [1,2]` | **no** |
| no-reference | 0 / `6161610a` | `[0,3] / [0,3]` | yes |
| not-repeated | 0 / `610a` | `[0,2] / [0,1]` | yes |
| nonnullable | 0 / `610a` | `[0,3] / [1,2]` | yes |
| mandatory-empty | 1 / `0a` | `[0,0] / [0,0]` | yes |

All eight candidate stderr values are empty. Baseline original-eight remains
3/8 equal / 5 different; isolated candidate is 7/8 equal / 1 different. Among
the original five failures this is now **actual CLI equality on 4/5**, not the
old prototype projection. These are compatibility observations, not permission
to relabel the historical failures or promote the policy.

The historical GNU internal anomalies remain separate: `a` reported whole
`[0,1]` despite the candidate's valid whole `[0,0]`; mandatory-empty reported no
match despite the candidate's completed empty match. `aaa` previously exposed
GNU's open `[0,-1]` register. No malformed interval is emitted or emulated here.
Those native internal facts are retained historical probes, not new native
register measurements by this leaf.

Across the unchanged 24 named rows, baseline CLI equality is **10/24**; candidate
CLI equality is **19/24**. Differences remain `aaa`, `end-anchor`, `literal-suffix`,
`nested-history`, and `finite-optional`. Internal whole-span differences can
also exist when CLI bytes agree; byte equality does not certify matching policy.
Both previous prototype regressions are retained and checked: mandatory-no-reference
still prints empty, and alternation-longest still prints `a`. This is not proof
that first-DFS ordering is correct for other repeated/nested ties.

## Scoped validation and failed attempts

Final candidate run `candidate-run-04` passes **183/183 node:test cases**:
137 unchanged existing expr limit/protocol/lifecycle/abort-reason controls,
12 new baseline-compatible invariants, and 34 explicit candidate checks.
The 34 include a **63-subject** bounded complete-witness enumeration, counted
as one test, and **16 exact budget-boundary tests**. Those are overlapping
checks, not additive independent acceptance denominators. Fifteen thresholds
have an engine-limit rejection immediately below admission. Required-empty
uses one state, so the sixteenth tests the protocol's invalid-zero floor.
The 1000-required-empty case fits 16 nodes, demonstrating no AST/code unrolling.

Final baseline `baseline-run-02` passes **149/149**: the same 137 existing
controls plus all 12 new canonical invariants. Candidate checks are maintained
strict TypeScript in `candidate.checks.ts`, but deliberately absent from default
`.test.ts` discovery. They run only against the isolated candidate. No skip,
TODO, existing-test waiver, or canonical source exclusion was introduced.

Both final snapshots pass isolated source/declaration builds and the existing
expr scoped strict source/test TypeScript configuration. No live dist rebuild,
whole suite, broad consumer suite, or public integration claim is made.
The untouched `tests/commands/expr/regex-native.test.ts` still requires the old
unsupported diagnostic for its 11 nullable-audit gap rows. Source inspection
shows that assertion is incompatible with this unpromoted guard-free candidate;
it was not run or waived here. Promotion would require an explicit separate
policy/test decision, not a claim that these 183 checks are the full expr suite.

Earlier observations remain intact:

- `baseline-run-01`: 137/137 existing controls, before new invariants were added.
- `candidate-run-01`: 167/167 before the 16 boundary tests. Earlier candidate
  SHA-256 is recorded in that run's provenance; its counts are not final-source
  certification.
- `candidate-run-02`: **182/183**, author test incorrectly required an
  engine-rejected positive state value below a valid one-state minimum.
- `candidate-run-03`: **182/183**, the corrected test then incorrectly treated
  synchronous protocol validation as an asynchronous rejection. Both failures
  and their complete TAP output remain in `commands.json` and `failure.json`.
  The final test asserts the actual synchronous `PROTOCOL` error, not a waiver.

The worker source did not change to fix either test mistake. Separate allocation
audit changes after run-01 charge class-name copying and sequence traversal;
the last change reserves 16 rather than 8 compile-bootstrap units. Only run-04
certifies the final source hash. Run-02 lacked a pre-execution source receipt
on failure; that provenance limitation is retained, not retroactively repaired.
Runs 03/04 write preparation hashes before build/test work.
The initially generated unified patch contained whitespace-only context lines.
Before sealing, only patch serialization was changed to an exact whole-file
replacement hunk, so whitespace checks pass without altering candidate bytes.

## Reproduction, sealing, cleanup, limits

Read-only authentication:

```sh
node tests/commands/expr-stress/repeat-history-author/verify-candidate.mjs
git apply --check tests/commands/expr-stress/repeat-history-author/candidate.patch
```

Explicit fresh capture (never reuse a committed output directory):

```sh
node tests/commands/expr-stress/repeat-history-author/capture.mjs candidate tests/commands/expr-stress/repeat-history-author/NEW-UNIQUE-CAPTURE
```

The full seal rejects added/removed files, added empty directories, symlinks,
and changed bytes in both owned trees, excluding only its own manifest file.
A new explicit capture necessarily extends that sealed tree and requires a
separate seal; ordinary verification never writes. Captures use immutable Git
source/config/test inputs, not dirty live product overlays. Final source
pre/post checks include new files **and empty directories**, not only original
tracked paths. Test input hashes are recorded after the run; no append-proof
post-run test-tree guarantee is claimed from the source-tree check.

All capture children are synchronous and awaited; unique source/native scratch
directories are removed in finally. Session close, executor dispose and Shell
dispose are awaited before observation output. Final unchanged lifecycle/abort
controls report 20 and 138 observed workers respectively, with **zero active
before safety cleanup and zero afterward**. These are scoped lifecycle controls,
not phase-specific interruption measurements of every new history transition.
No competing owners' processes, artifacts, index entries or source were touched.

Remaining work belongs to the independent/root decision: repeated/nested history
precedence, optional-empty policy, descendant retention, broader BRE/locale
qualification, independent adversarial stress, and any public/source promotion.
No duration, superiority, full GNU/POSIX acceptance or full completion is claimed.
