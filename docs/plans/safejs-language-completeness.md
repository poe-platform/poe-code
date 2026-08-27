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

## Stale artifact cleanup

- Removed ignored `dist` / `.turbo` output from obsolete `agent-maestro`,
  `agent-script`, and `runner-e2b` package directories; workspace builds pass.
- An empty, inactive rebase marker dated June 13, 2026 prevented integration of
  newer main commits. Archived it to
  `/tmp/poe-stale-rebase.oKpckf/rebase-merge.tar.gz`, then used `git rebase --quit`,
  verifying HEAD did not change. No source changes were discarded.
