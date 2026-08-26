# SafeJS language completeness

Objective: resolve every item in the SafeJS README's “Gotchas” and “What's
intentionally limited” sections. Ship each item as a separate conventional commit
on main and verify its GitHub release before shipping the next item. Do not claim
language completeness from passing existing tests alone.

## Delivery checklist

- [x] Mutable closures: accept shared mutable lexical captures in lint, verify
      read/write, shadowing, default parameters, per-iteration bindings, async branches,
      and snapshot/restore behavior.
- [x] Function syntax: lint declarations and expressions, including default
      exports, with the same semantics and diagnostics as runtime. Native-JavaScript
      audit also found missing ordinary-function `arguments` bindings; include their
      strict-mode semantics and arrow inheritance in this item.
- [ ] Markdown: handle multiple executable blocks explicitly rather than quietly
      ignoring code; verify fenced-block boundaries and actionable errors.
- [ ] Snapshot evolution: provide an explicit, validated migration path without
      silently restoring incompatible execution state or repeating side effects.
- [ ] Randomness: make default randomness resumable and deterministic without
      requiring callers to remember an extra option.
- [ ] Promise construction: implement sandboxed executors, settlement, chaining,
      rejection handling, budgets, and snapshot behavior.
- [ ] Agent failures: provide explicit checked/unchecked result handling with
      CLI/SDK parity rather than an implicit unrecoverable orchestration failure.
- [ ] MCP: provide usable transport integration without requiring custom glue.
- [ ] Environment: make capability configuration explicit and missing/denied
      variables distinguishable without granting ambient host access.
- [ ] Budgets: support an explicit recoverable checkpoint/result policy without
      letting scripts bypass host resource limits.
- [ ] Remaining lint/runtime syntax parity: var, switch, this, and supported new
      expressions, including Map and Set; retain host-escape protections.
- [ ] Classes and prototypes: implement language-level objects and inheritance
      inside the sandbox, never exposing host prototypes.
- [ ] Generators: implement async generators and resumable suspended generators.
- [ ] Regular expressions: support backreferences, lookaround, named groups, and
      Unicode properties while preserving enforceable execution budgets.
- [ ] Network/process modules: provide explicit opt-in capability-scoped modules
      rather than requiring every caller to implement their own.
- [ ] Multi-file imports: resolve source modules, bindings, cycles, errors, and
      snapshots consistently, keeping host access capability-controlled.

## Validation and release gates

The user additionally requires thorough stress testing via varied scripts, not
just acceptance examples. This is part of the goal for every item. Compare
supported language behavior with native JavaScript using deterministic,
reproducible script matrices. Exercise interactions, repeated mutations,
asynchronous scheduling, checkpoint/restore, host failures, resource exhaustion,
and sandbox escapes. An unexpected mismatch blocks that item's release until it
is understood and fixed. Keep fast regression coverage in tests and manual QA
steps in markdown; do not replace QA with a new automation script. Record the
actual cases and results, including remaining gaps, rather than claiming
perfection from a green suite.

For every item: add failing regression tests first, implement the change, run
focused tests and the SafeJS suite, typecheck/lint, and inspect CLI screenshots
when output or CLI behavior changes. Unit tests use memfs and mock external
services. Update existing documentation by removing obsolete restrictions; new
README content requires permission. Keep the complete checklist until all items
have direct evidence. No blanket staging, no skipped hooks, no local publishing.

The private SafeJS workspace ships in poe-code through the root Release workflow.
Record commit, workflow conclusion, and published version for each item here.

## Initial audit

- Runtime already implements mutable lexical captures and per-iteration scopes;
  the AS002 lint rule still prohibits them.
- Release run 32991576445 failed in an unrelated experiment-ralph ordering test.
  Recheck the release gate when shipping; do not bypass it.

## Releases

### Mutable closures — released in poe-code 4.0.58

- Removed the obsolete AS002 rule; legacy suppressions remain recognized.
- Regression coverage exercises sibling writes, loop captures, parameter defaults,
  shadowing, asynchronous branches, and checkpoint restore.
- SafeJS and agent-harness suites: 3,077 passed, 39 skipped.
- Workspace build: 67 successful tasks; root typecheck passed.
- CLI screenshot inspected: `harness run /tmp/safejs-mutable-closures.md --yes`
  completes successfully with the shared mutable count of 2.
- Updated the SafeJS skill template and ran `npm run sync-skills`.
- Commits: `486b9f1f` and `9e5cb5a5`.
- GitHub Release run `33000545959`: success. Verified npm `latest` is `4.0.58`
  and GitHub release `v4.0.58` was published on August 26, 2026.
- Pre-push full repository suite: 18,557 passed, 41 skipped. Hooks were not bypassed.
- Stress follow-up: eight script families at widths 1, 7, and 24 compare directly
  with native JavaScript. They exposed rejection of arrow reassignment; fixed
  assignment-expression parsing, including chained/logical assignments,
  destructuring defaults, conditional alternates, and yielded arrows.
- Added 14 parser regression cases and four closure checkpoint/restore scenarios.
- Expanded SafeJS and agent-harness suites: 3,119 passed, 39 skipped.
- Opt-in adversarial/parser fuzz run: 9 passed, 5 skipped. The skipped Test262
  cases remain explicit gaps, not evidence of full language conformance.

### Ordinary functions — released in poe-code 4.0.59

- Lint visits function declarations, expressions, default exports, parameter
  defaults, and yielded expressions. Hoisting, recursion, named-expression scope,
  imported bindings, and async diagnostics have direct regression coverage.
- Removed obsolete AS012 comparator restrictions. Ordinary functions and
  numeric-coercible comparator results now work through the public API.
- Native comparisons exposed missing `arguments`. Added strict, unmapped
  invocation-local objects, lexical arrow capture, iterable/indexed access,
  mutation, host-boundary copies, and allocation/depth accounting.
- Snapshot tests preserve aliases, cycles, non-enumerable data, descriptor flags,
  property order, frozen objects, and argument bindings in restored closures.
  Corrupt snapshot metadata is rejected before restoration.
- Four deterministic script families run at widths 1, 6, and 12 against native
  strict JavaScript. Declaration/expression recursion must hit call-depth limits.
- SafeJS and agent-harness suites: 3,200 passed, 39 skipped, followed by a passing
  14-case function stress suite including two additional budget regressions.
- Opt-in adversarial/parser fuzz: 9 passed, 5 skipped. Root typecheck passed.
- Updated the skill template and ran `npm run sync-skills`.
- Commits: `a3fe17b3` and `be05fabc`, rebased onto concurrent main changes without
  discarding them. Pre-push: 18,646 passed, 41 skipped; no hooks bypassed.
- GitHub Release run `33004449377`: success, including build, signatures, package
  lint, tests, smoke, and publication. Verified npm `latest` is `4.0.59` and GitHub
  release `v4.0.59` was published on August 26, 2026 at 19:34:20 UTC.
- Pre-push consumer coverage exposed a stale code-mode test that still expected
  functions to be rejected. Replaced its negative fixture with forbidden `eval`
  and added an ordinary-function/arguments integration regression.

#### Manual CLI stress verification

Create three harness pairs with frontmatter `kind`, `version: 1`, and `width`.
Use ordinary default function entry points, async for the concurrent case.
Adapt the corresponding bodies in `src/lint/function-syntax.stress.test.ts` to
read `frontmatter.width` instead of the test's local `width`:

1. Factories: width 64, 64 independent counters initially 0 through 63, each
   incremented by every round from 0 through 63. Sort descending with a named
   ordinary comparator. Assert 4,096 mutations, endpoints 2,079 and 2,016, and
   total 131,040.
2. Concurrent async calls: width 128. Each call captures its own `arguments` in
   an arrow, awaits twice, and increments `arguments[0]` by 128 without changing
   the formal parameter. Assert every row is `[index, index + 128, 1]`.
3. Delegated generators: width 1,000. Delegate sequences starting at 10 and 20,
   reading the starting value from `arguments[0]`. Assert 2,000 values and
   endpoints 10 and 1,019.

Executed these together using `npm run screenshot-poe-code -- harness run` with
the three `/tmp/safejs-functions-{factories,async,generators}.md` paths and `--yes`.
Inspected the screenshot: all three harnesses passed with results 131040, 128,
and 2000 respectively. No LLM calls or external services were needed.
The same three large scripts also matched native strict JavaScript through the
public SDK at widths 64, 128, and 1,000.

## Randomness work in progress

Not released. Tests first reproduced missing default RNG snapshot state and
seeded top-level replay drift. The implementation now auto-seeds, normalizes
seeds, records the run's initial state and pre-await argument state, and shares a
replayable generator factory between the SDK and paired harness loader.

Initial fixes to partial loop restoration were insufficient. Five new regressions
exposed lost factory captures, repeated awaited-argument mutations, mismatched
host-call ordinals, and RNG drift across consecutive checkpoints. New checkpoints
now rebuild lexical state by replaying source and recorded host outcomes; legacy
snapshots retain their existing restoration path.

Completed replay outcomes are immutable copies, encoded as explicit portable
graphs. Focused tests cover cyclic/aliased objects, sparse arrays, descriptors,
strict arguments, collections, regular expressions, special numbers, and
tag-shaped user objects. Accessor/prototype audits exposed getter invocation in
the initial validator; replay data now rejects accessors, custom prototypes,
proxies, and malformed arrays without invoking their properties.

Immediate replay of completed promises changed `Promise.race` winners. A per-run
settlement trace now gates promises by recorded interpreter positions and
settlement order. Recording leaves the original promises intact so that it does
not change cancellation timing. Native comparisons cover host/pure races,
`Promise.any`, `Promise.allSettled`, and random draws in asynchronous reactions,
including 1, 8, and 32 rounds. Console calls and caught sink failures now use the
host journal to avoid repeating pre-checkpoint output.

Replay results, host-call entries, and promise trace reservations count against
the existing aggregate data budget. Regression tests cover discarded host
results, synchronous calls returning no data, pure promise loops, provisional
charges, reconciliation, and budget reset. Invalid legacy host-call identities
are still rejected before external reconciliation even when replay data is
present.

Validation completed on August 26, 2026:

- 28 dedicated RNG cases, 41 checkpoint interaction cases, 11 promise scheduling
  cases, 9 portable result graph cases, and 42 paired harness loader cases pass.
- Expanded SafeJS, harness, and code-mode suites: 3,340 passed, 39 skipped.
- Opt-in adversarial/parser fuzz: 9 passed, 5 skipped. Skips remain gaps, not
  evidence of conformance.
- Full workspace build: 67 successful tasks, followed by successful root type
  generation and bundle. SafeJS package typecheck, root typecheck, focused ESLint,
  and diff whitespace checks pass.
- Inspected the CLI screenshot from `npm run screenshot-poe-code -- harness run
/tmp/safejs-random-stress.md --yes`: 4,096 iterations checked 8,192 direct
  `Math.random`/`time.random` draws and 32 unique UUIDs, with an await every 128
  iterations. The harness passed without LLM calls.

### Callback replay and external recovery

The original callback-resume hang is fixed and covered by a regression:

```js
const values = [];
await apply((value) => values.push(value));
await wait();
return values;
```

Recorded host calls now retain immutable callback arguments and invocation
identities. The execution trace orders callback starts, callback completions,
and promise settlements. Coverage includes sequential and deferred callbacks,
callbacks returned by callbacks, aliased cyclic arguments, caught rejections,
nested host effects, repeated checkpoint chains, and checkpoints inside a
re-issuable host operation's callback. Transferred promises are marked observed
so native handling of callback rejection is not falsely reported as unhandled.

Another audit found premature non-idempotent recovery: a resumed operation
returned count 1 instead of 11 because its callback was still running. External
proofs now explicitly specify `callbackDisposition` as `joined` or `detached`.
`HostCallResumeContext` exposes saved callback results and adapters for continuing
native protocols, without repeating the original non-idempotent operation.
Future callbacks wait until replay catches up to the checkpoint. The public
contract is documented in `packages/safejs/CHECKPOINT_REPLAY.md`.

Malformed callback traces are cross-checked against the host journal before
external reconciliation. A scheduled callback failure rejects pending replay
work instead of leaving promises stalled or producing an unhandled rejection.
Callback argument budget charges agree before and after restoration.

#### Manual callback stress verification

Run four script families at widths 1, 32, and 256. An asynchronous host `apply`
calls a source callback sequentially. Each source callback records its index and
one random draw, then awaits a pure promise. Compare original and resumed arrays
with an independently generated native reference using the checkpoint's seed:

1. Completed operation: checkpoint after the loop; assert the native `apply`
   executes only once across original and resumed runs.
2. Pending operation: checkpoint inside callback `floor(width / 2)`; assert the
   re-issuable native `apply` executes twice, without repeating source mutations.
3. Nested effects: each callback awaits a native `read(index)` before recording
   its row; checkpoint after the loop and assert only `width` native reads.
4. Pending nested effects: checkpoint inside the middle callback; assert total
   native reads are `2 * width - floor(width / 2) - 1`, because only work after the
   checkpoint runs again in the resumed continuation.

All 12 scripts passed, including exact arrays and host invocation counts. Each
case completed in 3–375 ms in the recorded run. They made no LLM calls.

### Input and callable capability recovery

Two additional public-SDK probes exposed defects, now fixed with regressions:

1. **Initial injected data was not retained.** With
   `const value = payload.value; await wait(); return value;`, the original run
   returned 1, but restoring with `payload.value` set to 2 returned 2. Source replay
   now preserves original bindings, imported data, entry arguments, and import
   metadata, while rebinding explicitly named capabilities. Data-only inputs may
   be omitted on resume. Tests also cover aliases, cycles, collections, and
   mutable data attached to injected sandbox capabilities.
2. **Returned source functions were treated as opaque host results.** With a
   native asynchronous identity function `echo`, the script
   `const callback = await echo(() => 42); await wait(); return callback();`
   failed checkpoint creation. The bridge now recovers the original source
   closure from its native adapter and records a validated capability reference.
   Replay restores identity and lexical mutations, including callback factories,
   functions passed back in callback arguments, both host-operation policies,
   and repeated checkpoint chains.

Further TDD audits fixed two issues in that implementation: retained source
closures could escape the aggregate data budget, and callers could mutate
capability/callback metadata through a returned snapshot. Registry roots now
participate in scope reconciliation; snapshot metadata is copied. Initial input
history also retains a budget reservation after source mutations drop its data.

Preserving initial data initially rejected injected promises even without a
durable backend. Injected promises now use the host journal: completed results
restore without their original native objects, while pending operations require
external reconciliation. A corruption regression verifies initial input shape
validation happens before invoking that resumer.

A detached producer callback exposed a replay stall, then a host-call ordering
mismatch. Function references now resolve when their source functions are
registered, rather than waiting for producer completion. Callback replay also
records AST node order to keep competing continuations in their original order.
Trace shape and source-node membership are validated before execution.

#### Additional manual script matrix

Run four script families at widths 1, 32, and 256, using a fixed seed and an
independent native LCG to verify every returned random value:

1. Mutate aliased, cyclic input data before checkpointing; omit it on resume.
2. Pass source functions through native identity operations; verify source
   identity, per-function lexical counters, and exactly one native call each.
3. Return functions from asynchronous callback factories and invoke them after
   replay reconstruction.
4. Pass source functions back through callback arguments and verify identity.

All 12 cases passed, including exact native-reference arrays and host counts.
The recorded run took 3–968 ms per case. A separate matrix covers detached
producers, completed promise inputs, and mutable callable input properties.
All nine additional cases passed at widths 1, 32, and 256, including native
reference equality and no repeated producer launches; times were 3–1,083 ms.

Latest validation on August 26, 2026:

- Expanded SafeJS, harness, harness-tool, and code-mode suites: 3,619 passed,
  39 skipped.
- Dedicated interaction suite: 56 cases; execution scheduler: 16; portable graph:
  16; initial inputs: 7; host journal: 17.
- Opt-in adversarial/parser fuzz: 9 passed, 5 skipped.
- Workspace build: 67 successful tasks and completed root bundle. SafeJS
  typecheck, focused ESLint across changed TypeScript files, and whitespace
  checks pass.
- Root typecheck passes. Re-ran and inspected the real CLI screenshot:
  8,192 random draws and 32 UUIDs checked, harness passed, zero agent spawns.

Final bridge review reproduced repeated execution of nested native methods.
Nested methods and function-valued properties now use the same journaled bridge
as top-level native bindings, while retaining existing diagnostic paths. Three
more native-reference scripts at widths 1, 32, and 256 combine nested reads with
returned source functions; they pass with exactly one read and echo per item
(16–555 ms per case). This brings the additional script matrices to 24 cases.

### Remaining release gates

The identified replay regressions and the current validation gates pass. Review
authoring guidance, commit this item, run the full pre-push suite, and verify
actual GitHub/npm publication. No randomness release has been made yet. The full
language-completeness goal remains active; the remaining checklist items are not
claimed complete by this release.

## Stale artifact cleanup

- Removed ignored `dist` / `.turbo` output from obsolete `agent-maestro`,
  `agent-script`, and `runner-e2b` package directories; workspace builds pass.
- An empty, inactive rebase marker dated June 13, 2026 prevented integration of
  newer main commits. Archived it to
  `/tmp/poe-stale-rebase.oKpckf/rebase-merge.tar.gz`, then used `git rebase --quit`,
  verifying HEAD did not change. No source changes were discarded.
