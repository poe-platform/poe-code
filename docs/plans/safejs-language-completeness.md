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
- [x] Markdown: handle multiple executable blocks explicitly rather than quietly
      ignoring code; verify fenced-block boundaries and actionable errors.
- [ ] Snapshot evolution: provide an explicit, validated migration path without
      silently restoring incompatible execution state or repeating side effects.
- [x] Randomness: make default randomness resumable and deterministic without
      requiring callers to remember an extra option.
- [x] Promise construction: implement sandboxed executors, settlement, chaining,
      rejection handling, budgets, and snapshot behavior.
- [x] Agent failures: provide explicit checked/unchecked result handling with
      CLI/SDK parity rather than an implicit unrecoverable orchestration failure.
- [x] MCP: provide usable transport integration without requiring custom glue.
- [x] Environment: make capability configuration explicit and missing/denied
      variables distinguishable without granting ambient host access.
- [ ] Budgets: support an explicit recoverable checkpoint/result policy without
      letting scripts bypass host resource limits.
- [x] Remaining lint/runtime syntax parity: var, switch, this, and supported new
      expressions, including Map and Set, plus top-level await inside nested
      control-flow blocks; retain host-escape protections.
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

Stale-artifact cleanup is also a release gate. Recheck removed outputs after
forced/cache-hit builds and package inventory checks. Archive recoverable output
before deletion, remove only verified obsolete/generated artifacts, and preserve
all unrelated source changes and user assets. Clean up this goal's temporary
repository fixtures after validation; retain external test evidence for review.

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

## Randomness implementation history

Initial tests reproduced missing default RNG snapshot state and
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

### Durable-checkpoint followup

Commit `0b7d3d23` passed the full pre-push suite (18,975 passed, 41 skipped), but
an additional paired-harness crash probe hung. Release workflow `33016194714`
was cancelled before publication; a successful push is not a completed release.
While this followup was being validated, later main commit `c4ab196b` included
the earlier replay commit in `poe-code@4.0.67` (workflow `33017312712`, npm
`gitHead` verified). The randomness item remains unchecked until this corrective
followup is published and verified.

The followup addresses these reproduced issues with regression coverage:

- Cancellation wrappers added replay events when the original and resumed runs
  differed in signal presence. Cancellation aliases now keep the underlying
  promise's replay identity.
- Synchronous source/native functions and constructors returning promises
  implicitly awaited them. Calls now preserve returned promises, allowing the
  actual source `await` to capture the pending operation.
- Failure handling replaced durable replay history with an unwind-time fallback.
  It now preserves the latest captured checkpoint.
- The paired harness's legacy sidecar and SafeJS's host journal disagreed about
  consumed calls and stateful time bindings. A local-state replay hook rebuilds
  built-in time/RNG state from recorded execution, including when the sidecar is
  absent. Rejected calls do not consume a successful sidecar entry. User-supplied
  time modules do not advance the built-in RNG.
- Cached asynchronous sidecar outcomes became synchronous, changing promise
  scheduling. The sidecar now retains asynchronous result identity.
- Throwing or asynchronous local-state hooks now fail replay explicitly rather
  than being swallowed by source exception handling or ignored.

#### Hard-crash manual matrix

Use separate Node processes for original and resumed paired-harness runs. For
each script family, run widths 1, 32, and 256 both with and without the legacy
sidecar (18 cases total):

1. Mix `Math.random`, `time.random`, UUIDs, monotonic timestamps, and asynchronous
   host results returned from ordinary synchronous functions.
2. Catch deterministic host failures every third iteration and retain their
   original messages through replay.
3. Pass source closures through native promise-returning identity functions and
   draw more randomness when invoking the returned closures.

Pause in the middle iteration. Wait for a durable checkpoint whose journal
records all preceding reads as completed and the middle pause as pending, then
kill the original process with `SIGKILL`. Resume in a new process with a different
wall clock and a newly supplied signal. Compare every output against an
independent native LCG/UUID reference and verify the external read log contains
each index exactly once. Do not mistake an earlier pause checkpoint for the
middle checkpoint merely because an external read has started.

All 18 cases passed with exact native-reference arrays and external read counts.
The final matrix took 1.9–12.8 seconds per case, including process startup. Its
scheduler clock is controlled so each original run writes the intended crash
checkpoint, rather than serializing every intermediate await; the real snapshot
and sidecar still use filesystem I/O. An initial all-yield variant exposed
quadratic checkpoint-writing overhead and exceeded the script's bounded runtime
at width 256, so checkpoint cadence was corrected rather than increasing the
timeout. Unit regressions continue to capture every yield in memory.

Followup validation: expanded suites 3,608 passed / 39 skipped; opt-in
adversarial/parser fuzz 9 passed / 5 skipped; 67 workspace build tasks and root
bundle succeeded; root/SafeJS typechecks and focused ESLint passed. The
interaction suite now has 65 cases; paired-loader coverage has 57 cases,
including the 16-case seed/checkpoint/sidecar/custom-time matrix.
Re-ran and inspected the real CLI screenshot: 8,192 random draws and 32 UUIDs
checked, harness passed, zero spawns.

### Remaining release gates

The durable-checkpoint correction is published as `poe-code@4.0.68`, commit
`a7ec0f14`, release workflow `33019509402`. GitHub's release tag and npm's
`gitHead` identify that commit. The final pre-push suite passed 19,963 tests
(41 skipped), and all 18 hard-crash cases passed again after integration of
newer main changes. Lockfile dependencies were synchronized before the final
build and push. No hooks were skipped. The non-TTY tool environment's
`TERM=dumb` disagreed with the new prompt lifecycle tests' TTY assumption;
all 71 targeted lifecycle cases and the full suite passed with
`TERM=xterm-256color`, without changing unrelated prompt code.

### Completed-snapshot followup

Randomness is still unchecked. Review of the replay-equivalence helper found an
explicit expectation that an unseeded random-only harness would fail replay of
its completed snapshot. Six initial regressions reproduced advancing random
state, lost original inputs, and repeated completed host operations.

Completed snapshots now carry the same portable host/input/scheduling history
as pending checkpoints and replay from their original RNG state. Repeated
completed-snapshot generations, returned source functions, seeded/default
randomness, and mixed built-in time calls have focused regression coverage.
Legacy terminal snapshots without recorded history retain the old progression
behavior; once resumed, newly recorded snapshots replay equivalently.

Capturing full terminal history also exposed opaque native handles from FS/MCP
operations. Ordinary execution must remain available for such handles, but they
cannot silently turn into an incomplete replay snapshot. Terminal results now
mark unavailable replay capabilities with `replayError`; dump/restore refuse
them before replaying side effects. Malformed markers must not invoke getters
or coercion hooks. Pending checkpoint serialization remains strict. This does
not claim to serialize executable native closures or live external resources.

#### Completed-run native-reference matrix

Using the compiled public SDK's `run` and `dump`, execute four script families
at widths 1, 32, and 256. For each original run, derive a native LCG reference
from its automatically generated seed, then restore its completed snapshot
three times, serializing each new generation. Supply a conflicting restore seed
to verify that saved history takes precedence.

1. Mutate aliased/cyclic input data and call a nested native read method. Omit
   original data bindings on restore; compare every row and native call count.
2. Return source callbacks through native echo operations. Compare lexical
   counters and three random draws per row, with no repeated native echoes.
3. Catch every third host failure and compare randomness before/after each
   operation. Verify native reads execute only in the original generation.
4. Mix `Math.random`, time random/UUID/now, and reads in a paired harness.
   Delete its legacy sidecar before each restore and change the wall clock;
   compare against original values and independently generated random/UUID data.

All 12 cases passed, including 36 restored generations, in 5–996 milliseconds
per case. The 18 separate-process hard-crash/restart cases also passed again.
These are ad hoc terminal scripts, not committed QA scripts. Unit coverage
additionally verifies legacy terminal progression, source callback restoration,
and malformed/nonportable snapshot refusal. Both `dump(result)` and
`dump(executionPromise)` reject asynchronously for nonportable histories.

Followup validation: 3,802 expanded tests passed, 39 skipped; opt-in
adversarial/parser fuzz passed 9, skipped 5. All 67 build tasks and the root
bundle, root/SafeJS typechecks, focused ESLint, Prettier, and diff checks passed.
Re-ran and inspected the real CLI screenshot: 8,192 random draws and 32 UUIDs,
harness passed, zero spawns.

Committed and pushed as `d448eb8b`; full pre-push validation passed 20,100 tests
(41 skipped). A further public standalone CLI matrix passed six raw/Markdown
cases at widths 1, 128, and 1,024: 24 separate processes, three completed restores
per original, with exact native-LCG outputs. The first release attempt
(`33021450584`) passed 20,100 tests but failed one unrelated Gaslight plan-order
assertion. No SafeJS failure occurred. The complete failed job passed on retry
without altering or skipping tests. Verified GitHub release `v4.0.70` and npm's
`gitHead` as `d448eb8b51da948f9682eccb02eedf22c9de1b9d`; workflow `33021450584`
attempt 2 succeeded, including smoke and publication. Randomness is checked off;
the separate language-completeness items remain open.

### Multiple executable Markdown blocks

Ten failing regressions reproduced ignored later blocks, absent original input
offsets, and CLI/example autofix dropping or ignoring content. Executable `js`,
`javascript`, and `ajs` blocks now form one source module in document order.
Prose, non-executable fences, and fence markers become whitespace with matching
UTF-16 offsets and line endings. An unclosed later executable block fails before
earlier effects. Shared declarations and normal early-return semantics remain
JavaScript, not separate per-block invocations.

The linter returns actual selected edits and accepts allowed `fixRanges`.
CLI/example fixes map only those edits back into original code spans. A fix
crossing an intervening Markdown region stays unapplied; no prose is overwritten.
Regression coverage verifies both entry points, CRLF, frontmatter, Unicode prose,
and idempotent edits. Diagnostic checks found two additional line-mapping bugs:
CLI/example prefixes omitted frontmatter, and AS001's independent scanner plus
unknown-directive locations counted LF but not CR. Red tests preceded both fixes.
SDK hashbang stripping also dropped a source line, or discarded the entire
script with CR-only input. Three further red cases now preserve its line/offset
layout by masking only the hashbang text.
Additional red cases corrected unclosed-fence messages after frontmatter and
kept the original BOM when the CLI writes autofixes.

#### Native-reference and CLI stress procedure

1. Generate declaration-hoisting/shared-mutation, async success/caught-rejection,
   and autofix script families at widths 1, 32, and 128, with LF and CRLF.
2. Alternate indented backtick/tilde fences and supported language tags. Insert
   Unicode prose and executable-looking examples inside non-executable fences.
3. Compare the real compiled standalone CLI's result with native JavaScript.
   Dump and restore each completed result twice in new processes.
4. For autofix cases, compare the entire Markdown file with independently
   constructed expected edits, then check a second fix pass is idempotent.
5. Inspect real success and error CLI screenshots: three blocks, 128 values,
   total 8,256; forbidden `eval` in a later fence reports original line 11.

All 18 cases passed, comprising 54 separate CLI processes. An initial async
fixture exposed the still-existing AS008 restriction on top-level await inside
`try` blocks; it is tracked under remaining syntax parity, not hidden by a
suppression. The Markdown matrix uses an async function spanning blocks, which
is accepted by current lint. Direct runtime native comparisons also cover the
top-level form. This is not a claim of full lint/runtime parity.

Validation after the CR/hashbang/fence/BOM corrections: 3,658 expanded tests passed,
39 skipped; opt-in adversarial/parser fuzz passed 9, skipped 5. Focused ESLint,
root/SafeJS typechecks, all 67 build tasks, and the root bundle passed. The
18-case/54-process CLI matrix passed again against rebuilt output. Inspected
the root CLI regression screenshot: 8,192 random draws and 32 UUIDs, zero spawns.

Released separately in commit `e676828f`. GitHub Release run `33023405259`
passed build, signatures, package lint, unit tests, smoke, and publication.
Verified npm `poe-code@4.0.71` has the exact commit's gitHead and GitHub release
`v4.0.71` was published August 26, 2026 at 23:39:16 UTC. The final pre-push suite
passed 20,288 tests, with 41 skipped. Concurrent main changes were preserved.
The full language-completeness goal remains active.

## Promise execution prerequisites

Native-reference scripts exposed existing failures before constructor work:
thenable receiver binding was missing, repeated settlement could trigger an
unhandled host error, and queued budget errors escaped their promise. Focused
regressions verify first settlement wins and errors remain contained.

Wider scripts exposed synchronous-prefix and thenable scheduling errors. A
per-execution source job queue now serializes synchronous source execution and
resumes asynchronous continuations only when their caller yields. Nested prefixes
inherit the active caller; replay waits relinquish execution to recorded work.
Thenable callbacks finish their synchronous tail before settlement is delivered.

The expanded suite exposed implicit awaiting in `Array.from`, collection
`forEach`, string replacers, and JSON callbacks. Those synchronous builtins now
retain promise values instead. Promise string/JSON representations match the
native reference cases. `Promise.any` uses a branded sandbox `AggregateError`,
preserving its rejection reasons through catch handling.

Armed-signal stress then found builtin constructor/static-property loss and lost
source-function prefix metadata. Builtin cancellation now occurs at await
boundaries; already-cancelable host promises retain settlement-versus-abort
ordering. Source async calls unwind their own finally blocks before their
callers receive completion. Return-value promise/thenable adoption remains
cancelable. All original cancellation and CLI SIGINT regressions pass.

An upgrade probe compiled the unmodified `e676828f` SafeJS source in an isolated
temporary tree. Replaying its snapshots under the new execution model reproduced
silent result drift and a stalled continuation, despite identical source hashes.
New snapshots carry `executionSemantics: "jobs-v1"`. Incompatible replay snapshots
now fail before effects with a precise validation error. Do not relabel old
snapshots: resume them with their original runtime. This compatibility change
must be called out as breaking in the prerequisite release. Explicit migration
and promise constructors remain unchecked, separate follow-up items.

### Native-reference stress procedure

1. Cross six promise-producing expressions in both input positions for `race`,
   `any`, `all`, and `allSettled`: fulfilled, async immediate, async suspended,
   thenable, reaction, and rejected. Compare all 144 results with native JS and
   restore each completed snapshot twice (288 restored generations).
2. Run async prefixes, thenable tails, reaction chains, and JSON callbacks at
   widths 1, 32, 256, and 1,024. Compare against native results and restore twice
   (16 cases, 32 generations). The 1,024-wide concurrent-await case deliberately
   uses `maxCallDepth: 4096`: the existing default counts outstanding awaits and
   correctly stops it at 1,000. This is not a disabled budget check.
3. Run three families through the real standalone CLI at widths 1, 32, and 256,
   in raw files and CRLF Markdown with three executable fences. Each original
   and two restores run in new processes: 18 cases, 54 processes.
4. Re-run the 18 hard-crash/restart cases for mixed RNG/time, caught failures, and
   returned callbacks, with and without the legacy host-call sidecar. Check exact
   native results and effect counts, never just successful process exit.
5. Verify four snapshots produced by the previous runtime now fail safely, not
   with changed results or a hang. Inspect success and compatibility-error CLI
   screenshots. The root CLI fixture runs 256 async callbacks and checks prefix
   32,640 and final total 65,280, with zero agent spawns.

All listed native matrices and the hard-crash matrix passed. The initial native
comparison normalized serialized SDK objects before comparing prototypes; the
one real 144-case mismatch was the lost `AggregateError.errors` payload and was
fixed with failing regressions first. The suite retains its five skipped Test262
cases; none of this is a claim of complete JavaScript conformance.

Pre-release validation: 3,468 expanded SafeJS/agent-harness tests passed, 39
skipped; opt-in adversarial/parser fuzz passed 9, skipped 5. Root typecheck and
focused ESLint passed. All 67 workspace build tasks and the root bundle passed.
The final width and 54-process CLI matrices passed again after the cancellation
fixes, along with the 12-case/36-generation completed-snapshot regression matrix.
Both new CLI screenshots were inspected: successful 256-callback execution and
an actionable compatibility error for a real previous-runtime snapshot.

Released as `poe-code@5.0.0` in commit `3466520a`, after preserving five newer
main commits. Pre-push passed 20,460 tests, with 41 skipped. GitHub Release run
`33026187986` completed successfully, including build, package signatures, lint,
tests, smoke, and publication. Verified npm gitHead exactly matches the commit
and GitHub `v5.0.0` was published August 27, 2026 at 00:24:53 UTC. The breaking
snapshot compatibility requirement is present in the published release notes.

## Promise construction work in progress

This item is not released. Seventeen failing regressions preceded the initial
implementation. `Promise` is now a sandbox constructor with its existing static
helpers. Executors run immediately through their synchronous prefix, ignore
return values, and use first-settlement-wins resolving functions. Direct self
resolution rejects. `instanceof Promise` uses a sandbox constructor brand.

The follow-up native audit found and fixed additional problems with failing
regressions first:

- Detached static helpers now reject invalid receivers synchronously. Promise
  methods use their actual receiver instead of capturing the object they were
  read from. Methods share identity within a run and the intrinsic prototype
  methods are non-enumerable. Sequential budget reuse resets the prototype.
- Cancelable native host bindings no longer double-wrap returned source functions
  and lose their identity, static properties, or constructor capability. The host
  bridge checks cancellation before invoking native effects and marks closures
  whose cancellation it already manages. Existing cancellation tests still pass.
- Fatal executor budgets and re-entry errors cannot be swallowed by an earlier
  resolve/reject. Native user throws after settlement remain ignored.
- `bind` preserves the first receiver and argument order, supports ordinary and
  async executors, forwards construction without the bound receiver, and retains
  captured data for budgets. Nested bound construction consumes call depth.
  Constructor argument effects run before the non-constructable-target error.
- AS001 now permits constructor expressions, including aliases and Map/Set,
  rather than guessing constructability from an identifier prefix. Dynamic
  constructability stays a runtime check; `Function` and `eval` remain forbidden.

The 49 focused constructor tests pass, including completed replay, pending
resolver reconstruction through an explicitly re-issuable operation, preserved
completed host effects, budget exhaustion after settlement, and bound aliases.
The pending test uses automatic checkpointing: manual dump during an active host
operation remains rejected by the existing re-entry guard. Host reconciliation
policy was not weakened. Expanded SafeJS/agent-harness validation passes 3,527
tests, with 39 skipped. Package typecheck, focused ESLint, all 67 workspace build
tasks, the root bundle, and root typecheck pass. Opt-in adversarial/parser fuzz
passes 9 tests, with 5 skipped; those skipped cases remain unverified.

### Constructor stress evidence and repeatable QA

1. Cross all pairings of eleven expressions through `all`, `allSettled`, `race`,
   and `any`: resolved/rejected promises, synchronous/asynchronous functions,
   thenables, reactions, direct constructors, and two bound-constructor forms.
   Compare with strict native JavaScript and restore every completed run twice,
   with cancellation armed and real watchdogs. Passed 484 comparisons and 968
   restored generations, with zero mismatches in this matrix.
2. Exercise direct settlement, async executor prefixes, captured resolving
   functions, borrowed methods, and bound constructors at widths 1, 32, and 256
   through the standalone CLI. Use both raw source and CRLF Markdown with three
   executable fences. Compare exact results against native execution. Passed 30
   cases, each executed originally and restored twice in separate processes:
   90 CLI processes.
3. Kill a harness process after a durable mid-loop checkpoint, then resume in a
   fresh process with cancellation armed. Pre-create pending constructor
   promises and retain their resolving functions across the checkpoint. Exercise
   fulfillment, rejection, and resolver callbacks returned by a host operation,
   at widths 1, 32, and 256, with and without the legacy host-call sidecar. Check
   exact results and that every recorded external effect occurs once. The final
   expanded pass completed 42 cases, including bound constructors and the
   previous RNG/time, caught-failure, and returned-callback regression families.
   Every expected effect occurred exactly once.
4. Build the actual published 5.0.0 source in an isolated temporary directory.
   Produce snapshots for `typeof Promise`, method identity, detached static
   calls, and borrowed method receivers. All four examples have different fresh
   results under the new implementation. The new `jobs-v2` execution marker
   rejects all four old `jobs-v1` snapshots before replay. This is a fail-closed
   compatibility boundary, not an implemented snapshot migration.
5. Inspect the root CLI screenshot of 256 nested-bound constructors. Assert
   executor prefix 256, checksum 32,640, and borrowed receiver result 42 inside
   the script; the harness reports success and zero agent spawns. Both the success
   screenshot and the standalone compatibility-error screenshot using an actual
   5.0.0 snapshot were inspected; the latter exits with code 1 and explains why
   changing the execution marker is not a migration.

The first crash fixture incorrectly omitted the required `(frontmatter)` export
signature; correcting that test fixture did not change production validation.
The first CLI prototype-inspection fixture hit the existing AS011 ban. The CLI
matrix now exercises receiver identity through instance methods; direct
prototype inspection remains covered in SDK tests, not misreported as accepted
by harness lint.

### Expanded receiver and adoption audit — August 27, 2026

Failing native-reference regressions drove the following additional fixes:

- Static helpers construct generic capabilities. Resolve/reject preserve the
  constructor result, callback receiver, executor validation, and asynchronous
  callback prefixes. Aggregates capture the static resolver once, invoke it
  during iteration, and preserve direct callbacks and per-element settlement
  guards. Repeated resolve/reject sequences match native JavaScript.
- Catch/finally invoke the receiver's actual `then`, including custom and replaced
  methods. Cleanup preserves intrinsic promise identity rather than adding
  extra adoption jobs. Constructor-property errors remain synchronous.
- Aggregates accept Map, Set, and synchronous generators. Iterator `next` is
  captured once, receives no argument, and is distinct from an asynchronous
  iterator protocol. Closing reads the current return method only when needed;
  iterator-step failures and resolver failures follow different closing rules.
- Promise adoption uses source jobs for constructor resolution, async returns,
  reaction results, and nested thenables. Settlements happen before releasing
  the owning job. The `then` method is captured before the adoption job runs.
  Await preserves opaque fulfilled promise values instead of assimilating them
  again. Indirect promise self-resolution rejects, while a thenable may resolve
  to itself repeatedly before eventually fulfilling.
- Fatal thenable call-depth failures cannot be hidden by earlier settlement.
  Endless self-resolving source thenables exhaust execution budgets. Rejection
  callbacks receive sandbox error values with the correct error brand.
- Live and restored host promises preserve the same host-call metadata. Missing
  replay metadata had produced different normalization jobs and restore hangs;
  the completed-replay regressions now pass. Raw injected asynchronous closures
  also retain nested-promise adoption and cancellation behavior.
- Legacy cancellation wrappers now preserve construction, static properties,
  cyclic function properties, bound targets, and retained captures. This is not
  a complete cancellation identity fix: the live-result failure below remains.

The expanded source matrix crosses 27 promise expressions through four
aggregates: 2,916 native comparisons and 5,832 completed restores passed. Earlier
expansions found 76 adoption mismatches and then 16 cleanup-order mismatches;
both batches received failing regressions and root scheduling fixes. The final
matrix has zero mismatches, not a claim that all promise behavior is proven.

Repeatable manual QA, extending the steps above:

1. Add nested async/constructor/reaction adoption, finally with synchronous,
   asynchronous, promise, and thenable cleanup, Map/Set/generator aggregates,
   missing-handler chains, and recovery callbacks to the native pair matrix.
   Restore each completed case twice with cancellation armed and watchdogs.
2. Run iterable, adoption, and generic-constructor families alongside the five
   existing CLI families, at widths 1, 32, and 256 in raw source and CRLF
   three-fence Markdown. Passed 48 cases and 144 separate CLI processes. A
   fixture initially compared JSON `0` with native `-0`; it now uses nonzero
   rejection values. A generic fixture initially used lint-forbidden `this`;
   it now returns an explicit capability result object. Neither fixture change
   is reported as a runtime fix for those separate concerns.
3. Add pending constructor adoption, finally cleanup, and Set aggregation to
   the hard-crash matrix. Passed 60 SIGKILL/restart cases across ten families,
   all three widths, and both host-sidecar modes. Every external effect occurs
   exactly once, and recovered values match the reference.
4. Rerun completed replay, pending checkpoints, budgets, host bridging, and
   cancellation tests, plus parser/snapshot fuzz. The last green expanded
   SafeJS/agent-harness suite passed 3,644 tests with 39 skipped; SafeJS alone
   passed 3,512 with 39 skipped. Opt-in fuzz passed 9 with 5 skipped. All 67
   workspace build tasks and the root bundle passed. These counts precede the
   newly added failing cancellation regression below, so they are not a green
   release gate for the current worktree.
5. Recheck real 5.0.0 snapshot rejection and the root constructor screenshot.
   All four published-runtime fixtures still reject before incompatible replay.
   The 256-constructor screenshot was regenerated and inspected successfully;
   the fixture checks prefix, checksum, and borrowed receiver results, with zero
   agent spawns. Root typecheck and SafeJS ESLint pass. The six obsolete package
   output directories remain absent after the full build.

### Cancellation and fatal-rejection audit — August 27, 2026

The live capability identity failure described in the preceding audit is fixed:

- Cancellation no longer clones returned objects, functions, collections, or
  promises. Closures explicitly distinguish sandbox execution from native SDK
  execution. Native capabilities are guarded when invoked, including detached
  functions reached later through object, array, Map, and Set aliases. Source
  callbacks and intrinsic functions retain their sandbox ownership during cleanup.
- One logical SDK promise retains its identity across concurrent runs while each
  AbortSignal selects its own cancellation outcome. Cancellation registration
  traverses own data descriptors without invoking accessors. Frozen objects,
  captured result objects, constructor callbacks, and completed replay retain
  their aliases. The cancellation suite passes 42 tests.
- A separate SDK capability matrix passes 64 native comparisons and 128 completed
  restores: four aggregates, widths 1/32/256/1024, mixed versus all-rejected input,
  and cancellation off/on. Comparison uses structured cloning to normalize the
  sandbox's intentional null-prototype output, preserving undefined values.

Additional red tests exposed fatal promise errors that could leave adoption
pending or allow later host effects. Ordinary `aborted` sandbox errors were also
incorrectly bypassing rejection handlers. Both paths are corrected:

- The run tracks the first fatal budget/reentry rejection independently of
  ordinary unhandled rejection reporting. Pending awaits are interrupted and
  subsequent source evaluation and capability calls stop. Budget failures remain
  fatal even when the source ignores a promise or installs a catch callback.
- Fatal budget cleanup uses an async-context-local scope, allowing awaited finally
  cleanup without clearing the run's failure or enabling unrelated jobs. The
  original fatal error is rethrown afterward. Ordinary aborted rejections remain
  recoverable. Unawaited filesystem budget failures now retain their original
  SandboxError rather than being wrapped as ordinary unhandled rejections.
- Internal promise adoption propagates fatal errors even without a run-level
  rejection tracker. Async SDK then results are normalized and tracked without
  treating their ignored return values as ordinary adoption settlements.
- Adding a separate fatal-race wrapper initially changed two signal-enabled
  native race/any outcomes. Both became failing unit regressions. Fatal handling
  now shares the existing settlement continuation rather than inserting another
  bookkeeping turn for sandbox promises.

Validation executed after these fixes:

1. Run SafeJS and agent-harness suites: 3,675 passed, 39 skipped across 141 passing
   files and one skipped file. No failing tests or unhandled test-process errors.
2. Compare all 2,916 constructor/adoption/aggregate combinations with native
   execution and replay every successful result twice: 5,832 completed restores,
   zero mismatches.
3. Exercise fatal errors through five async/constructor/thenable families, four
   aggregates, three call-depth limits, widths 1/16/256, and cancellation off/on:
   360 cases, zero escaped effects, 360 awaited cleanups, no pending escapes.
4. Repeat the standalone CLI matrix: all 48 cases pass across 144 separate
   processes, including raw source and CRLF Markdown. Repeat the SDK capability
   matrix: all 64 comparisons and 128 restores pass again.
5. Run opt-in parser/snapshot fuzz: 9 passed, 5 skipped. All four real 5.0.0
   compatibility fixtures reject safely before incompatible execution.
6. Build the workspace and root bundle: all 67 build tasks pass. Root typecheck,
   ESLint, package lint (17 rules), and diff whitespace checks pass. Regenerate
   and inspect the 256-constructor CLI screenshot: harness passed, coherent
   result summary, zero agent spawns. All six obsolete output directories remain
   absent after rebuilding.
7. Rerun hard-crash recovery after all builds finish. The first attempt was
   interrupted by the screenshot command rebuilding dependency output while a
   child process was importing it; it is not counted as a successful gate.
   The clean rerun passes all 60 SIGKILL/restart cases across ten families,
   widths 1/32/256, and both sidecar modes, with exactly-once external effects.

No constructor release has been made at this checkpoint. Passing these gates is
evidence for this item, not proof that the full language-completeness goal is done.

### Constructor release verification

- Committed as `0de207aff8e7313353a3e291c2c02006dc3b6876`
  (`feat(safejs)!: implement sandbox Promise constructors`) after integrating seven
  newer main commits. Normal commit hooks passed. The integrated workspace/root
  build, typecheck, and ESLint passed again.
- Pushed to main with normal hooks: package lint passed and the full repository
  suite passed 20,851 tests with 41 skipped across 917 passing files and three
  skipped files. No hook bypass or local npm publish.
- GitHub Release run `33034898845` completed successfully, including build,
  signature audit, package lint, unit tests, smoke checks, and publication.
  GitHub published tag `v6.0.0` at `2026-08-27T03:08:26Z`.
  `npm view poe-code@latest version gitHead --json` returned `6.0.0` and the exact
  commit above. The breaking release requires `jobs-v2`; old snapshots must use
  their original runtime. This is compatibility rejection, not migration.

### Remaining constructor-adjacent work

- AS011 still rejects direct `prototype`/`constructor` access in harness source.
  Keep this in the broader prototype/lint parity work without removing runtime
  host-escape protections. Its existence is not a successful CLI prototype test.
  Obsolete README restrictions have been removed; release gates remain pending.
  Explicit snapshot
  migration, general prototype chains, and the rest of the delivery checklist
  remain open. The `await 0` lint warning also says a non-promise await has no
  effect, despite its scheduling effect; include that diagnostic in syntax parity.

## Syntax parity work in progress

This is a separate, unreleased item after the verified constructor release.

- Added native-execution and completed-replay regressions for var hoisting,
  shared loop captures, switch/default fallthrough, method and lexical `this`,
  top-level nested awaits, primitive-await scheduling, and generators. The first
  run had nine lint failures and five passing controls. Host-escape restrictions
  and missing-async diagnostics remain required.
- Removed the `var`/`switch`/`this` bans and stopped treating switch `default:` as
  a forbidden label. Removed obsolete AS008 and AS-AWAIT-NON-PROMISE scanners and
  their old restriction tests instead of leaving no-op rules. Legacy diagnostic
  names remain recognized for existing suppression comments. Missing-async
  validation continues to own genuinely invalid non-async awaits.
- A six-family stress matrix exposed a false unused-binding warning: the
  AS006/AS007 visitor skipped constructor arguments and switch bodies. Three
  failing tests now cover reads in constructors/discriminants and unused case
  bindings. The visitor handles constructor arguments and shared switch scope;
  all 14 focused AS006/AS007 tests pass.
- Native stress passes 96 cases and 192 completed restores across six families,
  widths 0/1/16/128, LF/CRLF, and cancellation off/on. Separate-process CLI stress
  passes 36 cases and 108 processes across widths 1/32/256 and raw/three-fence
  Markdown. JSON CLI comparisons normalize JSON's negative-zero representation;
  the native matrix uses structured cloning rather than losing that distinction.
- The last green expanded suite passed 3,666 tests with 39 skipped, before the
  subsequent read-visitor fix and var-scoping regressions below. It is not a green
  gate for the current worktree. The root CLI screenshot was generated and
  inspected; inspection found a real error despite the screenshot wrapper
  successfully saving an image. Do not count that screenshot as passed.

### Var failures found during the syntax audit

The initial `lint.syntax-parity.test.ts` run had 17 passes and three failures:

1. AS003 loses a function-scoped `var` binding after its for loop. The root CLI
   screenshot fails with `Unknown identifier 'index'` when returning the loop's
   final index. Fix scope analysis; do not change the valid fixture to use let or
   move the declaration merely to avoid the error.
2. AS003 does not hoist var declarations from nested blocks into their containing
   function/module scope. Runtime and completed replay match native execution,
   but lint rejects the valid references.
3. Runtime rejects `function read(value) { var value; return value; }` with
   `Cannot redeclare binding 'value' in the same scope.` Native execution returns
   the parameter. Fix parameter/var binding identity, including initializers,
   captures, shadowing, and replay, rather than suppressing the error.

### Var environment corrections — August 27, 2026

Those three failures are corrected without changing the valid fixtures:

- Parser, runtime, and lint share binding-name and hoisted-var traversal. Var
  declarations in nested blocks, loops, switches, and catch/finally clauses belong
  to their containing function; traversal stops at nested function boundaries.
  AS003 and AS006/AS007 also visit constructor arguments, switches, sequence and
  update expressions, and tagged templates instead of skipping their reads.
- Parameters initialize mutable var-compatible bindings while retaining their
  temporal dead zones during parameter initialization. Simple parameters and
  body vars share bindings. When parameter expressions exist, the body gets a
  separate var environment, copying same-name parameter values only for body var
  declarations. Default-created closures retain the parameter/outer environment.
  Computed destructuring keys, rest parameters, async functions, and generators
  have native-reference coverage.
- Function-body declarations are mutable and support parameter redeclarations and
  last-declaration-wins behavior. Nested lexical blocks still reject duplicate
  function declarations. The top-level runnable snippet keeps its function-body
  behavior, including function/var redeclarations.
- Parser scope tracking distinguishes lexical, parameter, function, and simple
  catch bindings. It rejects lexical/var collisions in either declaration order,
  including dead branches and loop bodies, before any host effects. Destructured
  catch bindings remain lexical; simple catch/var shadowing remains valid.
  Duplicate arrow parameters are rejected for expression and block bodies.
- The native test setup initially included two `var arguments` declarations that
  strict JavaScript itself rejects. They were replaced with valid default-closure
  uses of the arguments object; those fixtures are not reported as runtime fixes.

Evidence so far:

1. Expanded SafeJS/agent-harness tests pass 3,722 with 39 skipped. Focused coverage
   includes 23 function-var environment cases, 20 declaration-scope validation
   cases, and 26 lint/runtime/replay parity cases. A final mechanical consolidation
   of binding-name traversal then passed the full workspace/root build; repeat
   the test gate on that final worktree before release.
2. Native script stress passes 160 cases and 320 completed restores across ten
   families, widths 0/1/16/128, LF/CRLF, and cancellation off/on. The four added
   families cover parameter environments, computed bindings, mutable function
   redeclarations, and catch/var shadowing.
3. Hard-crash stress passes 24 SIGKILL/restart cases: default-parameter closures,
   loop vars, catch vars, and mutable function declarations; widths 1/32/256;
   host sidecar present/missing. Every external effect occurs exactly once.
   The first fixture attempt omitted the required frontmatter argument and was
   rejected by the harness signature check; correcting that fixture is not a
   runtime fix.
4. An archive of published poe-code 6.0.0 reproduces four changed outcomes for
   unchanged source. Before the compatibility fix, the new runtime silently
   accepted an old snapshot and changed its result. Red unit and archive probes
   now pass with `jobs-v3`: all four old `jobs-v2` snapshots fail with
   `SnapshotValidationError` at `$.executionSemantics` before host effects.
   This requires a breaking release and still does not provide migration.

Final pre-commit gates passed on the consolidated implementation:

- SafeJS/agent-harness: 3,722 passed, 39 skipped; opt-in parser/snapshot fuzz:
  9 passed, 5 skipped. Root typecheck and ESLint pass, as do all 17 package-lint
  rules. The full workspace/root build and subsequent screenshot build each
  complete all 67 workspace tasks.
- Native syntax: 160 cases and 320 restores; standalone CLI: 60 cases and 180
  separate processes; hard-crash recovery: all 24 cases pass again. Native promise
  ordering: 2,916 comparisons and 5,832 completed restores, zero mismatches.
  Fatal-budget stress: all 360 cases pass with zero escaped effects and 360
  awaited cleanups. All four published-6.0.0 upgrade fixtures still reject safely.
- Regenerated and inspected the unchanged 256-iteration root CLI fixture. It now
  passes, showing iterations/checksum/hoistedIndex with zero agent spawns and no
  misleading primitive-await warning. The former AS003 screenshot failure is
  fixed by scope analysis, not by changing the fixture.
- Rechecked the six obsolete package output directories and four deleted-rule
  output files: all remain absent. Unrelated user assets remain untouched.

Released in poe-code 7.0.0:

- Commit `7bfc6eb1181c29c2c9429fffab188192b59907d3`; GitHub Release run
  `33037147560` completed successfully on August 27, 2026. npm publication time
  is `2026-08-27T03:53:37.483Z`; npm `gitHead` and GitHub tag `v7.0.0` both point
  to that exact commit.
- Normal pre-commit/pre-push hooks passed without bypasses. The full repository
  suite passed 20,898 tests with 41 skipped across 918 passing files.
- General prototypes, migration, and the remaining delivery checklist stay open.

### Guidance follow-up — released in poe-code 7.0.1

- Commit `7e802755dac10d295da5873b57e413f1583524cf`; GitHub Release run
  `33037811316` succeeded. npm publication time is `2026-08-27T04:06:39.095Z`;
  npm `gitHead` and GitHub tag `v7.0.1` both identify that exact commit.
- Existing README and skill guidance now matches supported syntax and snapshot
  compatibility. The normal hooks passed; the installed skills were synced.

### Standalone CLI entrypoint — August 27, 2026

Published-package stress uncovered another real CLI boundary failure rather than
a syntax mismatch. Running the published 7.0.0 CLI through `/tmp` on macOS exited
successfully without output: Node resolved the main module to `/private/tmp`,
while the entrypoint check compared the unresolved argument URL. Canonical paths
worked; file links, directory links, chains, Unicode/space-containing link names,
and relative links did not. Five failing memfs regression cases reproduced this
before the fix. The entrypoint now compares both real paths and still leaves
programmatic imports inert; ten regression cases pass.

A direct OS-level workspace-bin probe then failed with `Exec format error`:
the CLI also lacked a Node hashbang. The actual published 7.0.0 file had mode
0644. Added the hashbang and reused the existing `set-bin-executable` helper in
the SafeJS build, since the root package embeds this private workspace without
running a separate private-package prepack hook.

Validation on the corrected implementation:

- Focused CLI tests: 37 passed. SafeJS/agent-harness: 3,732 passed, 39 skipped;
  opt-in fuzz: 9 passed, 5 skipped. All 67 workspace build tasks, root bundle,
  typecheck, ESLint, all 17 package-lint rules, and targeted Prettier checks pass.
- Entry-point stress: 10 invocation variants, 120 execution/replay cases, and
  402 separate processes. Includes executable links, preserved main-module
  symlinks, raw scripts/CRLF Markdown, parameters/receivers/collections, widths
  1/32, two restore generations, help, parse errors, missing files, budget exits,
  and inert imports. Zero mismatches; no real agents are called.
- Rebuilt and inspected both standalone-bin and root-harness screenshots. The
  standalone executable emits the expected structured result, not an empty
  success; the root harness still passes its 256-iteration fixture.
- Separately, the actual published 7.0.0 archive passes 60 syntax cases across
  180 CLI processes when invoked by its canonical path. Its unresolved-alias
  failure remains the reproduced baseline, not a passing alias test.

Release QA: build the package, verify its declared binary has a Node hashbang
and executable permissions, then invoke it through canonical paths, file and
directory links, chained/relative links, and names containing spaces and Unicode.
Repeat execution and two restores with raw and CRLF Markdown inputs. Check help,
parse-error, missing-file, and budget exit statuses; importing the module must not
start the CLI. Inspect the standalone and root CLI screenshots. Repeat the matrix
against the actual published archive after release, not only the working tree.
This entrypoint fix does not change `jobs-v3` execution or snapshot semantics.

Released in poe-code 7.0.2:

- Commit `6de6b67b72f7e045de3698a41e464455ce9a4782`; GitHub Release run
  `33038665608` completed successfully. npm publication time is
  `2026-08-27T04:22:46.738Z`; npm `gitHead` and GitHub tag `v7.0.2` both identify
  that commit. Normal pre-push hooks passed 20,908 tests with 41 skipped across
  919 passing files; no hooks were bypassed.
- Downloaded the actual npm archive to `/tmp/safejs-published-entrypoint.9FSm83`.
  Its CLI has a Node hashbang and mode 0755; the obsolete lint outputs are absent.
  With unchanged workspace dependencies linked for execution, all 402 entrypoint
  processes and another 180 syntax/replay CLI processes pass with zero mismatches.
  The latter run uses the unresolved `/tmp` path that failed on published 7.0.0.
  The Release workflow separately passed its fresh-install build, tests, and
  package smoke checks.

## Agent result policy — poe-code 8.0.0; packaging follow-up pending

- Released commit `fcd82b6ed190f75ba36251200d628635c4137a6e` through successful
  Release run `33042143960`. Verified npm `8.0.0`, its gitHead, and GitHub tag
  `v8.0.0`; publication was August 27, 2026 at 05:27:43.767 UTC.
- Normal pre-push hooks passed: 20,978 tests, 41 skipped; 922 passing test files.
  Additional syntax, Promise-constructor, and fatal-budget matrices pass 160/320,
  2,916/5,832, and 360 cases/restores respectively, with no mismatches or escapes.

- SafeJS returns complete nonzero agent results by default. `check: true`
  explicitly requests `AgentSpawnError.result`; retry policies run before result
  checking. Parallel groups support explicit checking, fail-fast cancellation,
  complete delayed results, and nested aggregate failures. Other users of the
  shared scheduler retain their historical default.
- Updated successful-path templates to request checking explicitly, revised the
  existing README API row/obsolete restriction, documented the contracts outside
  README sections, and synchronized all six installed SafeJS skill copies.
- Regression-first testing exposed lost error identity in replay, cancellation
  reason replacement, lost callable helpers in the real harness replay wrapper,
  invalid retry policies counted as spawns, and missing first-failure snapshot
  directories. Fixed each and retained focused regressions. Error payload copying
  rejects function/promise capabilities and array accessors without invoking them.
- A published-7.0.2 probe demonstrates three incompatible unchanged-source cases:
  unchecked spawn, retry, and nested aggregate failures. `jobs-v4` rejects their
  `jobs-v3` snapshots before effects; this is not snapshot migration.
- Native comparison matrix: 480 cases across ten families, widths 1/4/17/64,
  exit codes 0/1/7, concurrency 1/4, and default retries on/off; 960 completed
  restores without additional provider calls. Separate checks cover 480 SDK
  cancellation cases and 12 throwing-observer/usage-accounting combinations.
- Fatal payload matrix: 120 string/data-budget cases, each reaching one provider
  call, with zero catch-block escapes. CLI matrix: 54 raw/Markdown/CRLF cases,
  90 restores, including caught, unchecked, retry, aggregate, and uncaught errors.
- Hard-crash matrix: 30 SIGKILL/restart cases across five agent-call families,
  widths 1/32/256, with replay sidecars both present and missing. Checkpoints
  occur after handled outcomes; every mock provider effect occurs once.
- Scope boundary: an uncaught terminal failure retains the existing resumable
  checkpoint/fallback semantics and can reattempt a declared re-issue operation.
  The crash matrix does not establish exactly-once behavior in every crash window.
  Non-idempotent operations still require explicit reconciliation.
- Inspected three real CLI screenshots with an injected, non-networked test
  provider: unchecked warning/success, checked error/exit 1, and caught aggregate
  errors/success. The checked screenshot exposed the directory bug and was
  rerendered after fixing it. No real agent or LLM was invoked.
- Full targeted suite before the final directory regression: 3,969 passed,
  39 skipped; final loader checks: 64 passed. All 67 workspace builds, root
  typecheck, ESLint, and workflow lint pass. Adversarial/parser fuzz: 9 passed,
  5 explicitly skipped Test262 cases. A full repository run requires
  `TERM=xterm-256color`; the five TTY lifecycle failures under an unsuitable TERM
  pass when rerun in that environment. The normal pre-push suite remains a gate.
- Rechecked the 153 previously removed outputs and six obsolete output
  directories: all remain absent after builds and screenshots. Archived and
  removed this item's generated CLI failure snapshot, leaving user fonts alone.

### Reproducible QA procedure

1. Run the focused SafeJS, harness-loader/template, shared parallel, and root
   harness-command tests, followed by normal repository checks with a TTY TERM.
2. Run `/tmp/safejs-agent-result-matrix.mjs`,
   `/tmp/safejs-agent-budget-matrix.mjs`, and
   `/tmp/safejs-agent-cli-matrix.mjs`; confirm the counts recorded above.
3. Run `/tmp/safejs-crash-matrix.mjs` through `node --import tsx` with
   `SAFEJS_STRESS_FAMILIES=agent-return,agent-checked,agent-retry,agent-parallel,agent-aggregate`.
   Compare effects and resumed output with each uninterrupted reference.
4. Run `/tmp/safejs-agent-upgrade-probe.mjs --require-rejection` through tsx;
   confirm all three published-version fixtures reject before host effects.
5. Inspect the unchecked, checked, and caught-parallel CLI screenshots. Use the
   explicit test provider loader; never substitute paid or live model calls.
6. Audit npm package contents for regenerated stale files, then repeat the result
   and CLI matrices against the actual published archive. Verify release workflow,
   GitHub tag, and npm gitHead before marking this item shipped.

### Clean-consumer packaging follow-up

- Installing the actual published `8.0.0` as a consumer dependency reproduces
  missing private workspace imports in the shipped standalone SafeJS files.
  The bundled root CLI still passes its zero-agent syntax fixture. Previous
  archive probes using repository node_modules did not establish independence
  from workspace dependencies; final verification now requires a fresh consumer
  install with no repository node_modules links.
- Bundle `index`, `core`, and `cli` as shared ESM entrypoints. Shared chunks are
  required so SDK-created error payloads retain their registry when passed to
  the CLI runtime. Expose `poe-code/safejs`, `/core`, and `/cli`, plus the
  `poe-safejs` binary. Replace the existing README/skill usage commands and sync
  installed skills. Extend the existing installed SDK/CLI smoke test in CI.
- A newly packed, independently installed consumer passes three public imports,
  shared runtime identity, checked-error copying, and completed replay. The
  same consumer passes 480 native/960 restored result cases, 480 cancellation
  cases, 12 observer cases, 54 CLI cases/90 restores, and 120 entrypoint cases
  across 402 processes. Its installed binary screenshot was inspected and its
  public TypeScript APIs pass a strict consumer typecheck with Node ambient types.
- Rebundling removes only its generated chunk directory first. A deliberately
  stale generated marker disappears, and repeated bundling succeeds. All 17
  package-lint rules, workspace builds, typechecks, ESLint, and workflow lint pass.
- The unhandled CLI failure snapshot from visual testing was archived at
  `/tmp/safejs-agent-cli-state.djWI5i/state.tar.gz` before removal. The unrelated
  terminal-pilot font assets remain untouched.
- Released the packaging fix as `poe-code 8.0.1`: implementation commit
  `f6fd29f7`, metadata regression commit `44131b6b`, successful Release run
  `33043430657`. npm gitHead and GitHub tag both resolve to
  `44131b6b9152539afa4b1c117ffabe9b7f05add5`; npm publication was
  August 27, 2026 at 05:55:13 UTC. CI build, package lint, full tests, and
  installed SDK/CLI smoke tests all pass.
- The first push correctly stopped on two metadata expectations listing the
  former exports and binaries. Updated the allowlists and added exact export
  targets/bin checks; the focused 14 tests and full pre-push suite then pass:
  20,978 passed, 41 skipped. No hooks were bypassed.
- A fresh exact-version npm consumer at `/tmp/safejs-published-final.cMte0m`
  independently passes three public entrypoints, shared runtime identity,
  checked-error replay, 480 native cases/960 restores, 480 cancellation cases,
  12 observer cases, 54 CLI cases/90 restores, and 120 entrypoint cases across
  402 processes. All 19 installation symlinks resolve within this consumer;
  none points to the repository or another external dependency tree.
- Public-entrypoint smoke tests pass on Node 18.18.2, 18.20.8, 20.20.0,
  22.22.2, and 24.14.0, including the published consumer. The candidate's full
  entrypoint matrix also passes on Node 18.18.2, 20.20.0, and 24.14.0:
  1,206 processes with no mismatches. The Node 18.18.2 result/replay matrix and
  Node 24.14.0 CLI matrix pass independently.
- Final budget stress passes 120 result-payload cases with zero catch escapes
  and 360 fatal-Promise cases with zero effects, 360 cleanups, and zero pending
  escapes. The published binary screenshot was inspected. All 153 removed
  files and six obsolete directories remain absent locally and in the installed
  release; the local package inventory has 3,336 entries and all five binaries.
- These checks close the agent-result policy and standalone packaging item,
  not the remaining language-completeness checklist or snapshot migration.

## MCP transport integration — release validation

Replace the mandatory custom connector with an opt-in host configuration of
named stdio or HTTP servers. Scripts may select only those names; command,
environment, endpoint, and authorization details stay on the host. Keep custom
connector injection compatible. Never register MCP without explicit SDK options
or a CLI configuration flag, and never inherit the parent's complete environment
for a configured child process.

Use the existing tiny-mcp-client protocol implementation. Connect lazily, share
each connection within one run, isolate concurrent runs, and close connections
after success, failure, cancellation, and resource exhaustion. Bound shutdown,
including unresponsive HTTP termination and children ignoring SIGTERM. SDK users
outside a run can close their clients explicitly. Both CLIs accept the same
configuration shape as the SDK, resolving relative paths from the config file.

Pre-register named client capabilities so completed replay can rebind methods
without opening transports. Tool calls are effectful: replay completed results,
and require reconciliation rather than silently reissuing an uncertain call.
Add failing tests for capability denial, protocol exchange, cancellation,
cleanup, parallel-run isolation, and checkpoint restore before implementation.
Exercise stdio and local HTTP in external stress scripts, with no live LLMs or
paid services. Repeat clean-consumer and stale-artifact audits before release.

### Implemented and verified locally

- Added named stdio/HTTP configuration, SDK/CLI parity, empty-by-default child
  environments, redirect rejection, bounded request/body/shutdown lifetimes,
  pagination limits, per-run connection ownership, and JSON-RPC error payloads.
  Both CLIs require explicit `--mcp-config`; custom connectors remain compatible.
- TDD exposed missing returned-host-method replay identities. Added registered
  capability rebinding, preserving aliases across bindings and modules. Further
  tests caught dotted-key and Map/Set path collisions and a restored-input clone
  identity mismatch. Structured capability paths and rebinding fix those cases.
- Execution semantics advance to `jobs-v5`. An actual published 8.0.1 consumer
  returns false for a shared host function imported and injected under aliases;
  the corrected runtime returns true. Its valid `jobs-v4` snapshot is rejected
  before effects. This is explicit incompatibility, not snapshot migration.
- Focused suites pass 3,938 tests, with 39 skips. Unit tests cover active and early
  cancellation, stalled response bodies, unresponsive HTTP DELETE, SIGTERM
  escalation, parallel ownership, pagination, forged handles, and uncertain
  effect reconciliation. The existing installed SDK/CLI CI smoke now exercises
  managed MCP, completed replay, and shared cleanup ownership.
- `/tmp/safejs-mcp-matrix.mjs` compares four script families with native JS at
  widths 1, 8, and 32, using ordinary, prototype-named, and Unicode server names.
  Each run passes 72 stdio/HTTP cases, 144 completed restores, and 20 cancellation
  cases; all 82 child processes exit and all 82 HTTP sessions terminate. It passes
  against both workspace output and an isolated installed archive, including
  Node 18.18.2 and 24.14.0 in addition to Node 22.22.2.
- `/tmp/safejs-mcp-crash.mjs` passes 12 actual SIGKILL/restart cases at widths
  1, 8, 32, and 128. The installed archive independently passes the same matrix,
  with zero repeated tool effects and no remaining child processes. These are
  checkpointed windows, not a claim of exactly-once effects for arbitrary crashes.
- `/tmp/safejs-mcp-failures.mjs` passes 24 payload-budget cases and 12 protocol,
  process-exit, and request-timeout cases against the isolated archive. No fatal
  budget escapes into catch, and no child process remains alive.
- Promise regression passes 2,916 native cases/5,832 restores; fatal-Promise
  stress passes 360 cases with zero effects or pending escapes and 360 cleanups.
  Agent-result regression passes 480 cases/960 restores, 480 cancellations,
  12 observer cases, and 120 payload-budget cases with zero catch escapes.
- The clean consumer at `/tmp/safejs-mcp-consumer.ZXjSVx/project` passes three
  public entrypoints, strict TypeScript checks, and the exact updated installed
  SDK/CLI smoke script. All 19 symlinks resolve within the consumer. The archive
  contains 3,350 entries and all five binaries. Screenshots of standalone MCP,
  root harness MCP (zero agent spawns), and the new help option were inspected.
- Updated the SafeJS skill template and synced all six installed copies. All
  67 workspace tasks pass a forced build, followed by a cache-hit/root bundle
  build. ESLint, typechecks, workflow lint, and all 17 package-lint rules pass.
  Cleanup still verifies 153 removed files and six obsolete directories absent
  locally and in the installed archive; unrelated terminal-pilot assets remain.

### Root CLI interruption follow-up

Release run 33046923985 succeeded for `1ba5809a22f145996f2aebb24b7848529eb1e258`.
The registry and GitHub tag both identify this commit as 9.0.0, published on
August 27, 2026 (GitHub timestamp 06:54:14 UTC). This initial release did not clear
the gate: final lifecycle validation found that the root harness CLI did not forward
SIGINT to `runHarnessPair`, although the standalone CLI did.

- Four failing unit regressions exposed the missing signal and listener lifetime.
  The root command now aborts its run, awaits resource/worktree cleanup, reports
  interruption once, exits with status 130, and removes its handler on all paths.
  A fifth regression prevents starting the harness if cancellation occurs during
  worktree setup. Normal failures retain their original error.
- `/tmp/safejs-mcp-interrupt.mjs` reproduced four failures in the previous bundle:
  two orphaned stdio children and two unclosed HTTP sessions. The script cleans
  up its own failed-test children. The corrected bundle passes 24 cases across
  both CLIs, including SIGTERM-ignoring children, repeated SIGINT during cleanup,
  pending HTTP requests, and stalled response bodies. Each case checks status
  130, bounded shutdown, no remaining child, and HTTP session termination.
- The focused command, loader, and managed-MCP suites pass 128 tests. The root
  bundle rebuild and ESLint/type/workflow checks pass. Published-package
  verification for the follow-up is recorded below.
- The isolated candidate at `/tmp/safejs-mcp-sigint-consumer.b8ZTFh/project`
  independently passes all 24 interruption cases and the 153-file/six-directory
  cleanup audit, with 19 internal symlinks and no repository links. The root
  interruption screenshot was inspected: one interruption message, exit 130,
  no success claim, and the stubborn child terminated. Package lint passes all
  17 rules.
- Published 9.0.0 independently passes three public entrypoints, the 72-case MCP
  matrix with 144 restores and 20 cancellations, and the cleanup audit in
  `/tmp/safejs-mcp-published9.EKRb6d`. This does not clear the known root-CLI
  interruption defect; the follow-up release must pass that separate matrix.

### Verified MCP release

- Follow-up commit `879230e12ae47a093b943846fe613b5594933f43` passed the complete
  pre-push suite: 21,013 tests passed, 41 skipped. Release run 33047912045 completed
  successfully, including its build, signature audit, package lint, full tests,
  installation smoke, and publication. npm 9.0.1 and GitHub tag v9.0.1 both point
  to that exact commit. npm published at 07:10:32.685 UTC on August 27, 2026;
  GitHub's release timestamp is 07:10:34 UTC.
- Installed exactly `poe-code@9.0.1` in the fresh consumer
  `/tmp/safejs-mcp-published-final.xVWk8i`, without repository dependency links.
  All three public entrypoints, shared runtime/error identity, strict TypeScript
  declarations, and the installed standalone help command pass.
- The published package passes 72 MCP cases, 144 completed restores, and 20
  cancellations, closing all 82 children and all 82 HTTP sessions. It also passes
  12 real SIGKILL/restores without repeated effects, 24 fatal payload-budget
  cases, and 12 protocol/process-exit/timeout cases, with no live children.
- The published root and standalone CLIs pass all 24 interruption cases on each
  of Node 18.18.2, 22.22.2, and 24.14.0. The normal and real-TTY interruption
  screenshots were inspected. Agent-result regression passes 480 cases, 960
  restores, 480 cancellations, and 12 observer-error cases. Standalone entrypoint
  regression passes 120 cases across 402 processes and ten invocation variants.
- Cleanup again verifies all 153 removed outputs and six obsolete directories
  absent locally and from the published package. All five binaries exist; all
  19 consumer symlinks stay inside the consumer. Unrelated user assets remain
  untouched. MCP is checked off; the broader language checklist remains active.
  These results do not establish universal conformance or exactly-once execution
  across arbitrary crashes.

### Manual release QA

1. Run the focused suites and the MCP stress scripts named above, including
   `/tmp/safejs-mcp-interrupt.mjs <package-root> 3` for both CLIs.
2. Run the native Promise, fatal-budget, and agent-result regression matrices.
3. Inspect both CLI screenshots and the new help option; use only the local
   stdio fixture, never a paid provider or a live LLM.
4. Pack and install as a dependency in a fresh consumer, without repository
   node_modules links. Repeat MCP matrices and public-entrypoint/type checks.
5. Run `/tmp/safejs-cleanup-audit.mjs <consumer-directory>` after forced/cache-hit
   builds and again against the exact published version.
6. Commit this item, push main normally, and monitor Release to success. Verify
   npm gitHead and the GitHub tag, then repeat the isolated-consumer checks before
   marking the MCP checklist item complete.

## Explicit environment capabilities — implementation and QA

Keep environment access opt-in. `makeEnvModule(allowList)` remains a host-side
grant, and an options form `{ allow, values? }` supports explicit values without
ambient fallback. Both CLIs accept `--env-config <json>`; the standalone CLI SDK
accepts the same options. Script frontmatter never grants environment access.

`get(name)` returns a string (including an empty string) for a granted, present
variable, returns undefined for a granted but absent variable, and throws an
`EnvAccessError` with code `ENV_ACCESS_DENIED` for a name outside the grant.
Permission checks precede lookup. Names are exact, case-sensitive capabilities,
not silently trimmed; reject empty names, NUL, and equals signs. Whitespace and
Unicode names otherwise remain exact. No enumeration, write, or process export
is added. This intentionally changes the old denied-read and whitespace behavior
and needs a major release, not a compatibility shim that retains ambiguity.

Copy grants and explicit values at module construction. If values are omitted,
read only the granted own data property from the current host environment; if
values are supplied, never fall back to ambient variables. Reject malformed
options and granted accessors without executing them. Denied properties are not
read or evaluated. Preserve structured denial fields through the sandbox and
JSON checkpoint replay. Completed reads remain recorded observations; future
reads use the capabilities supplied by the restoring host. Checkpoints can
contain previously granted secrets and must be protected accordingly.

Manual QA:

1. Add failing unit, replay, and CLI tests before implementation. Cover missing,
   denied, empty, whitespace, Unicode, prototype-named, invalid, and mutable
   configuration cases; no filesystem writes or real LLM calls in unit tests.
2. Run independent SDK/native-result and real-process CLI matrices, including
   changed/revoked grants on restore, malformed configuration, fatal budgets,
   concurrent runs, fresh processes, and active checkpoint restart.
3. Inspect both CLIs and their help/error screenshots. Ensure no ambient values
   appear when the module is absent or when an explicit values map is supplied.
4. Run focused and full tests, lint/types, forced/cache-hit builds, package lint,
   public-entrypoint/type checks, and the standing stale-artifact audit.
5. Commit and push this item; monitor Release to success and verify exact npm
   gitHead/tag. Repeat tests against an isolated installed package and check off
   the environment item only after published-package evidence passes.

### Environment verification before release

- New module/CLI regressions initially failed on missing configuration and
  ambiguous denial. Additional tests exposed inherited-option pollution and
  synchronous host errors losing their name, code, and custom fields on replay.
  Grants now read only own descriptors; replay preserves already-branded sandbox
  errors instead of wrapping them again as generic host errors.
- A real 9.0.1 consumer returns `["TypeError","EIO",true]` initially but
  `["Error",undefined,false]` on replay. The new runtime restores that same `jobs-v5`
  snapshot to the original result, invoking the host only once. This fixes
  replay fidelity without changing the dump format or claiming migration.
- Focused suites pass 3,924 tests, with 39 skips. All 67 workspace tasks pass a
  forced build followed by a cache-hit/root bundle build. ESLint, root types,
  workflow lint, and all 17 package-lint rules pass. The template was updated and
  all six installed SafeJS skills synced.
- `/tmp/safejs-env-matrix.mjs` passes 144 native/SDK cases, 432 completed JSON
  restores, 24 fatal payload-budget cases, and 64 concurrent runs. It covers
  exact whitespace, Unicode, prototype-named variables, explicit/ambient values,
  mutation, caught/rethrown errors, and no denied-value capture in snapshots.
- `/tmp/safejs-env-crash.mjs` passes 12 actual SIGKILL/restores with changed,
  revoked, or newly granted variables. Recorded reads are not repeated; future
  reads use the restoring host's configuration. `/tmp/safejs-env-root-resume.mjs`
  independently passes six active root-CLI SIGKILL/restores, waiting for a real
  periodic checkpoint rather than assuming a file contains current observations.
- `/tmp/safejs-env-cli.mjs` passes 54 real-process cases and six standalone
  completed restores. Both CLIs enforce explicit configuration, missing/denied
  separation, absent-module refusal, and no ambient fallback. Success, denial,
  and help screenshots were inspected; root harness runs make zero agent spawns.
- The isolated candidate `/tmp/safejs-env-consumer.jk7RFD/project` independently
  passes all four environment matrices, the exact updated installed SDK/CLI CI
  smoke, strict public TypeScript declarations, and shared-runtime checks. The
  144-case SDK matrix also passes there under Node 18.18.2 and 24.14.0, in addition
  to Node 22.22.2. Cleanup verifies 153 removed outputs and six obsolete
  directories remain absent, with five binaries and 19 internal consumer links.
- Promise regression passes 2,916 native cases and 5,832 restores. Fatal-Promise
  checks pass 360 cases with zero escaped effects/pending jobs and 360 cleanups.
  Agent regression passes 480 cases, 960 restores, 480 cancellations, and 12
  observer cases. MCP regression passes 72 cases, 144 restores, and 20
  cancellations, closing all 82 child processes and 82 HTTP sessions.

Remaining checkpoint work discovered during QA: an unhandled rejection from a
default-exported async function can leave a standalone `--snapshot` file from a
previous invocation, because the CLI's rejected-promise path does not write a
final snapshot. Source-hash checks correctly refuse restoring that file after a
source change. Root harness periodic checkpoints default to 30 seconds, and an
early failure may leave only the initial checkpoint. Do not treat either file as
proof of a completed observation. Retain this failure-path audit under the open
snapshot/budget items; environment restore claims above use verified completed
or active checkpoints, not assumed failure checkpoints.

### Verified environment release

- Commit `0e871c24a4866faa6c6cb2cc4ecd0cf656ad6b56` passed all 21,051 local
  pre-push tests, with 41 skipped. Release run 33051271218 completed successfully,
  including build, signature audit, package lint, full tests, installation smoke,
  and publication. npm 10.0.0 and GitHub tag v10.0.0 match that exact commit.
  npm published on August 27, 2026 at 07:59:37.867 UTC; the GitHub release timestamp
  is 07:59:39 UTC. The major version explicitly announces denied-read and
  exact-name behavior changes.
- Installed exactly `poe-code@10.0.0` into the fresh consumer
  `/tmp/safejs-env-published.t5cgIz`. It passes the exact installed SDK/CLI CI
  smoke, strict public declarations, and shared-runtime checks. No workspace
  dependencies are linked into this consumer.
- The published package passes the 144-case environment matrix, 432 completed
  restores, 24 fatal-budget cases, and 64 concurrent runs, plus 54 real-process
  CLI cases with six completed restores. Both matrices pass independently on
  Node 18.18.2, 22.22.2, and 24.14.0.
- Published-package crash tests pass all 12 SDK SIGKILL/restores and six active
  root-CLI SIGKILL/restores, including changed, revoked, and replaced grants.
  The existing MCP interruption regression also passes all 24 cases in both
  CLIs, with no orphaned children or unclosed HTTP sessions.
- Cleanup again confirms 153 removed files and six obsolete directories absent
  locally and from the installed package, all five binaries present, and all
  19 consumer symlinks internal. The archive inventory contains 3,350 entries;
  the bundler clears its hashed chunk directory before rebuilding it. User
  terminal-pilot assets remain untouched. A final host-record replacement check
  reopened environment verification as described below; snapshot, budget, class,
  generator, regex, network/process, and source-module work also remain.

### Ambient record replacement follow-up

A final TDD audit found that 10.0.0 captures the original `process.env` object,
although granted ambient values are documented as read at call time. Replacing
that host record therefore returns an obsolete value. A failing regression
replaces the whole record and contrasts it with an explicit fixed-value grant.
Resolve the ambient record only after the permission check on each call; keep
explicit values copied and fixed. Re-run the environment matrices, verify a
published patch release, and only then restore the environment completion mark.

The fix also covers replacement with an empty record, so removed ambient secrets
do not remain readable. The extended matrix adds 64 whole-record replacements
and 64 corresponding completed restores. It passes locally and in the isolated
candidate `/tmp/safejs-env-replacement-consumer.N30nX3/project` on Node 18.18.2,
22.22.2, and 24.14.0. The 12 SDK and six active-root crash matrices, 54 CLI cases,
public types/installed smoke, and cleanup audit pass again. The preceding
documentation-only Release run 33052303602 also completed successfully.

### Verified environment patch

- Commit `e85008c3947c58e3b144ff0e3e9014a3b0e4e609` passes 21,053 local tests,
  with 41 skipped. Release run 33053268979 completed successfully. npm 10.0.1 and
  GitHub tag v10.0.1 both identify that exact commit. npm published at
  08:26:57.313 UTC on August 27, 2026; GitHub records 08:26:58 UTC.
- The fresh exact-version consumer `/tmp/safejs-env-published-final.REUQnb`
  independently passes the installed SDK/CLI smoke, strict public types,
  shared-runtime check, 144 native/SDK cases, 432 ordinary completed restores,
  64 host-record replacements and 64 corresponding restores, 24 fatal-budget
  cases, and 64 concurrent runs. The extended matrix passes on Node 18.18.2,
  22.22.2, and 24.14.0.
- The published patch also passes 12 SDK SIGKILL/restores, 54 real-process CLI
  cases with six completed restores, and six active root-CLI SIGKILL/restores.
  Cleanup verifies all 153 removed outputs and six obsolete directories remain
  absent, all five binaries are present, and all 19 consumer links are internal.
  Environment is checked off again on this evidence, not on the earlier 10.0.0
  results alone. The broader language goal and recorded checkpoint failures
  remain open.

## Recoverable failure checkpoints and budgets

Implemented an explicit host checkpoint policy without weakening sandbox limits:
`dump(originalRunPromise, { onFailure: "checkpoint" })` after a rejected run.
`run()` still rejects, script handlers cannot catch fatal budgets, cleanup is
awaited, and the host must explicitly choose new limits/deadlines for recovery.
The historical default data-size dump remains compatible; explicit
`onFailure: "throw"` always propagates the failure.

Failure snapshots now include the current host journal, original inputs, random
state, and promise replay instead of falling back to an older periodic snapshot.
Standalone `--snapshot` writes current failure state and reports capture/storage
failures without claiming an existing file is current. Paired and legacy harness
SDKs accept `budget`; root CLI now exposes `--max-steps` and `--data-size`, matching
standalone limits. API/recovery boundaries and manual QA are in
`packages/safejs/RECOVERY.md`; the skill template is synchronized.

TDD and stress found two additional recovery defects before release:

- Cancellation unwind settlements can deadlock replay. Capture the precise
  cancellation boundary, not an earlier yield, while retaining existing
  catch/finally behavior for cancellation inside scripts.
- Fatal promise settlements from a second budget-exhausted replay can deadlock
  a later successful replay. Neither original nor restored runs now journal
  fatal termination as an ordinary promise settlement. Fatal rejection still
  reaches the existing tracker and cleanup paths; it is not swallowed.

An old integration fixture simulated process death by throwing a normal error.
That error is now correctly recorded and replayed rather than silently retried;
the test asserts no repeated operation. Separate real SIGKILL tests establish
process-death recovery. Unsupported graph state and missing resume capabilities
still reject capture rather than fabricating a stale fallback. Pending effects
still require reconciliation; no global exactly-once guarantee is claimed.

Validation on August 27, 2026, before publication:

- New SDK script matrix: 138 resource-limit cases over six families, three
  widths, entrypoint modes, and handler forms; 27 ordinary-failure cases; 468
  restore attempts, including deliberately unchanged exhausted limits; and 48
  concurrent recoveries. Native JavaScript supplies successful results. Verify
  effects already occurred before the initial failure, not just after recovery.
- Real CLI matrix: 12 scenarios, 24 restores, 42 processes across both binaries,
  with file-backed effect counts and invalid-limit rejection.
- Real crash matrix: 12 SIGKILL cases, each followed by a budget-limited restore
  and successful higher-budget restore; six require explicit proof reconciling
  an already performed pending effect. No repeated effects.
- Regressions: 2,916 native Promise cases and 5,832 restores; 360 fatal cases with
  zero catch escapes and 360 cleanups; 12 MCP hard restarts and 24 CLI SIGINT
  cases with no leaked children. Opt-in parser/adversarial tests: nine pass,
  five skipped, which remain coverage gaps.
- Inspected standalone/root budget failure and successful resume screenshots,
  plus root help documenting both limits. Nonzero failure exit codes remain.
- All 67 workspace builds, root typecheck, ESLint, 17 package-lint rules, actual
  installed SDK smoke, and isolated declaration checks pass. Cleanup verifies
  153 removed outputs and six obsolete directories remain absent, all five
  binaries exist, and consumer links stay inside the isolated installation.

The first feature commit is `69e8a64027cf9d8874f39423028117b915f5ec94`;
pre-push checks pass 21,081 tests with 41 skipped, and Release `33057270790` is
being monitored. The isolated candidate also passes the matrix on Node 18.18.2,
22.22.2, and 24.14.0, the real CLI and crash matrices, and strict recovery types.

A final lifecycle audit found a follow-up edge: cleanup rejection happens outside
the interpreter's catch. The original run rejected, but explicit
`onFailure: "throw"` could still return a completed snapshot, and a configured
backend did not receive that final failure checkpoint. The follow-up routes
post-cleanup errors through the dump controller and persists the already
completed replay state, preserving the primary error if storage also fails.
TDD covers SDK policy and standalone CLI restoration. A separate 162-case
cleanup matrix awaits 1,134 cleanup calls, exercises 81 storage failures, and
finds zero repeated effects or lost primary failures. It covers synchronous and
asynchronous entrypoints, ordinary script errors, budget errors, and cleanup
rejections with Error, string, and null reasons.

Publication and the final installed-release receipt remain pending. Keep the
budget checklist open until the follow-up release is verified.

## Stale artifact cleanup

- Removed ignored `dist` / `.turbo` output from obsolete `agent-maestro`,
  `agent-script`, and `runner-e2b` package directories; workspace builds pass.
- Removed four leftover generated `.js`/`.d.ts` files for the deleted AS008 and
  AS-AWAIT-NON-PROMISE scanners from SafeJS dist. These ignored build artifacts
  are not staged or committed.
- A subsequent source/output inventory found two more generated files for the
  deleted AS012 rule, plus 60 orphaned package outputs and 87 root outputs,
  including obsolete binary wrappers. Removed only ignored build artifacts;
  retained current generated binaries and all source/user changes. Recovery
  archives for the latter groups are
  `/tmp/poe-stale-outputs-IG6xKj/outputs.tar.gz` and
  `/tmp/poe-stale-root-hhFVyl/outputs.tar.gz`.
- Forced all 67 workspace build tasks, rebuilt the root bundle, then repeated a
  cache-hit build. All 17 package-lint rules pass. A separate npm-pack dry-run
  inventory verifies all 153 removed files and six obsolete output directories
  remain absent, none of the removed files ships among 3,329 package entries,
  and all four current binary entries remain packaged. A full source/output
  scan finds zero remaining orphaned `.js`/`.d.ts` files in the audited root and
  package dist directories. This does not claim every cache or temporary file
  on the machine is obsolete or safe to delete.
- Corrected stale syntax, constructor, binding, and randomness guidance in the
  existing README and SafeJS skill template. Ran `npm run sync-skills`; all six
  installed copies update from the template. This replaces outdated restrictions
  rather than adding new README sections.
- Post-cleanup full repository tests pass again: 20,898 passed, 41 skipped.
  Separate native syntax stress passes 160 cases and 320 restores; CLI stress
  passes 60 cases across 180 processes; fatal-budget stress passes all 360 cases
  with zero escaped effects, 360 awaited cleanups, and zero pending escapes.
- An empty, inactive rebase marker dated June 13, 2026 prevented integration of
  newer main commits. Archived it to
  `/tmp/poe-stale-rebase.oKpckf/rebase-merge.tar.gz`, then used `git rebase --quit`,
  verifying HEAD did not change. No source changes were discarded.
