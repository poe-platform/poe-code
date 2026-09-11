---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
readiness: ready
---

# Jq work admission: kamilio #654 and #655

## September 8: root #655/#666 delivery gates

Evidence: `/tmp/kamilio-655-666-gate.2t9R06`. The complete uncached maintained
`npm run test:unit --workspace=virtual-bash` passes on candidate `2efcacf01`:
282 runner assertions plus 22,216 unit cases, comprising **22,153 passes,
63 skips and zero failures/cancellations**. Skipped cases are not passes.
The earlier interrupted sweep and subsequent 80/81 focused failure remain
recorded separately; the test-only correction passes 109/109 focused cases
before this complete successful rerun.

Root rebased onto upstream `b49a48946`, preserving its SafeJS dynamic-import
feature. Git-tree comparisons verify the entire SafeBash and SafeFS inputs
are byte-identical before and after that rebase. The selected maintained
SafeFS/SafeBash build closure was rerun successfully on rebased `29b645404`;
exclusive guarded root `npm run lint` also passes (ESLint, types, workflows).
No full root `npm test` or root-release success is implied by this package gate.

Playground: 166/166 tests and maintained build pass. Built public Node exports
match native Bash for the 8,192-character no-match replacement case and preserve
jq entries, reverse, Unicode length and JSON-string results. The browser's
existing 64 KiB expansion profile refuses the 8 KiB case with maxExpansionBytes;
that refusal is retained, not counted as success. The 2,048-character case and
jq controls succeed in the actual production preview. Inspected captures:
`/tmp/kamilio-655-666-browser-qualified.png` and corresponding YAML; the earlier
running/refusal captures are preserved. Browser and preview were closed.

These checks establish the scoped behavior and admission guarantees documented
here, not universal unchanged near-limit headroom, RSS or latency guarantees.
Remote-main delivery and publication are verified separately after pushing.

TDD implementation handoff, September 8, 2026. Active-jq #655 is implemented;
the latest integration corrections are recorded below.
Earlier frozen handoffs remain historical records.

## #655 exact numeric async migration — GREEN and frozen

September 8, 2026: root authorized current migration support in
`packages/safe-bash/tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts`,
not changes to historical seals or manifests. This resolves the predecessor
80/81 failure recorded below. The local binding admits only
`tests/commands/structured-stress/independent-increment/numeric-safety.test.ts`:
6,800 current bytes with SHA-256
`0c77ece2993547da2bc7aee9192c728e2ab199bb6ccd0e87f4ea0b23ba2c04eb`.
It removes exactly `async ` at current byte offset 2020 and `await ` at 2212,
then requires 6,788 reconstructed bytes and the original sealed SHA-256
`5ad8d138f3733aa57f2c3a3147d20cb72affc6323111852cf646069da335e363`.
Any supplied historical snapshot must equal the reconstruction. This member
has an immutable manifest hash but no snapshot in the historical patch manifest;
the positive control independently reconstructs bytes, not a new historical artifact.

Thirteen controls cover acceptance and rejection of wrong/aliased paths, wrong
old hash, current-byte mutation, changed operands/depth/collection/assertions,
extra edits, missing await/async, and changed snapshot bytes. No new framework
or receipt. Preserve all 140 live comparisons and 23 historical snapshots;
account explicitly for one numeric async migration and **133 byte-unchanged**
members, rather than misclassifying the migrated member as unchanged.

Final focused GREEN: **109/109**, no failures/cancellations/skips/TODOs, using
Node 22/tsx, strict rejection handling and the maintained reporter. Exact cohort:
`tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts`,
`tests/commands/structured/whole-value-admission.test.ts`,
`tests/commands/structured-stress/independent-increment/numeric-safety.test.ts`,
and `tests/commands/structured/resources.test.ts`.
Only evidence.test.ts and this plan changed in this final migration step.
The prior resource restoration and new five-test file remain as recorded below;
root owns new-file inventory registration. No product/API shim, historical
artifact rewrite, Git/build/lint/full-suite execution, or running worker process.
All follow-up files are now frozen for root integration.

## #655 resource-seal correction — predecessor evidence

September 8, 2026: root reported four resource-depth seal failures in its
incomplete full-unit sweep, retained at `/tmp/kamilio-655-666-gate.2t9R06/unit.log`.
Under the narrow follow-up grant, removed only the 24 appended lines from
`packages/safe-bash/tests/commands/structured/resources.test.ts`. Its original
SHA-256 is restored exactly:
`55e0aecebc8c3e2deb3b78d90fcb612a54103866b7d8b2488900b2dcf1ba4a91`.
Moved the identical five test bodies, with assert/test/run imports, into the new
`packages/safe-bash/tests/commands/structured/whole-value-admission.test.ts`.
Root must register this exact new path in the canonical inventory.

Requested three-file focused validation: **80 pass, 1 fail, 81 total**, no
cancellations/skips/TODOs. The remaining failure is
`frozen historical evidence and retained non-native canonical seals remain intact`
in `tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts`:
the earlier approved async-only adaptation of
`tests/commands/structured-stress/independent-increment/numeric-safety.test.ts`
has current hash `0c77ece2993547da2bc7aee9192c728e2ab199bb6ccd0e87f4ea0b23ba2c04eb`,
but its retained seal expects
`5ad8d138f3733aa57f2c3a3147d20cb72affc6323111852cf646069da335e363`.
This is an unresolved integration blocker, not GREEN. No product, numeric test,
seal, receipt, evidence assertion, or historical artifact was changed in this
follow-up. Exact follow-up write scope: restored resources, new admission test,
and this plan. All are frozen; no worker processes remain.

Command, from `packages/safe-bash`, with Node 22/tsx and maintained reporter:

```sh
TSX_DISABLE_CACHE=1 timeout 45s node --max-old-space-size=512 --import tsx --test \
  --test-concurrency=1 --test-reporter=./scripts/test-reporting.mjs \
  tests/commands/structured/whole-value-admission.test.ts \
  tests/commands/structured/resources.test.ts \
  tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts
```

Active jq only: held/inactive query-core/yq remains excluded and unvalidated.
No Git/build/lint/full-suite execution or inventory write by this worker.

## #654 integration follow-up — frozen

September 8, 2026: root's full Safe Bash run found two older synchronous compare
consumers in the active canonical file
`packages/safe-bash/tests/commands/structured-stress/jq-grammar-review-fixes/limits.test.ts`.
Root granted this exact test file plus this plan; no product-source change.

- Fresh RED, maintained reporter and `--unhandled-rejections=strict`: six tests,
  four pass, two fail. The failures were Promise-versus-`-1` and synchronous
  assert.throws against an async rejection, followed by post-test uncaught/
  unhandled rejection activity for the original abort reason.
- Minimal five-line adaptation: make both callbacks async, await compare,
  and await assert.rejects for maxSteps and abort. Preserve every operand,
  the four alias/NaN cases, synchronous identity equality, maxSteps 8, the exact
  limit error predicate, and original abort-object identity.
- Focused GREEN: **102/102 tests pass**, zero failures/cancellations/skips/TODOs,
  with no post-test async activity. Cohort: the six-test target plus
  `tests/commands/jq-control-flow-limits.test.ts` and
  `tests/commands/structured/string-work.test.ts`; Node 22, tsx, cache disabled,
  concurrency 1, default process isolation, maintained reporter, strict rejection
  handling. No full test/build/lint/Git command was run by this worker.
- Bounded active TypeScript import/call audit used maintained test discovery and
  boundary declarations, excluded held query-core/yq, declared fixtures, snapshot/
  sealed/evidence/archive copies and manifest-listed paths except this expressly
  granted active target. It inspected 900 selected source/canonical TS files;
  no oversized/nonregular file was skipped. Four direct compare/binary importer
  modules were identified: interpreter, jq-control-flow-limits, string-work and
  this target. All identified calls now await results/rejections or return their
  promise to the awaited stable-sort comparator; no additional synchronous direct
  consumer was found. This does not qualify held or historical replay consumers.
- Provenance: no deeper AGENTS instruction applies. The target's pre-edit hash
  matched its historical `MANIFEST.sha256` entry
  `e3cbea29f8661193eba400c608c8ffa2012f1b42225e6a3544559891b9b7e513`.
  Root's current explicit active-test grant authorizes this adaptation. Preserve
  the historical manifest, captures and verifier unchanged: its old seal no
  longer matches the adapted active test, and no historical sealed replay or
  integrity pass is claimed. Root must retain this provenance qualification.

**Follow-up changed paths: exactly this plan and the single test file above.
Both are now FROZEN for root integration.** No source changes, inventory changes
or outstanding worker test processes. #655 preparation is paused; its existing
`/tmp` fragments/evidence are retained, with no assembled or applied #655 patch.

Exact focused command from `packages/safe-bash`:

```sh
TSX_DISABLE_CACHE=1 node --unhandled-rejections=strict --import tsx --test \
  --test-concurrency=1 --test-reporter=./scripts/test-reporting.mjs \
  tests/commands/structured-stress/jq-grammar-review-fixes/limits.test.ts \
  tests/commands/jq-control-flow-limits.test.ts \
  tests/commands/structured/string-work.test.ts
```

## #654 frozen handoff

Root opened the source-writer window after reporting the full npm test pass and
#658 delivery. This worker implemented only #654 within the granted literal
paths. **Source/test writes are now frozen; await root before #655 or any further
source/test edits.** Root retains Git/build/lint/inventory ownership.

Exactly six final changed files: three production files, two existing test
files and this plan. No new canonical file or inventory change is needed:

1. `packages/safe-bash/src/commands/structured/limits.ts`
2. `packages/safe-bash/src/commands/structured/values.ts`
3. `packages/safe-bash/src/commands/structured/interpreter.ts`
4. `packages/safe-bash/tests/commands/jq-control-flow-limits.test.ts`
5. `packages/safe-bash/tests/commands/structured/string-work.test.ts`
6. `docs/plans/bugfix-654-655-jq-work.md`

Implementation: monotonic 25ms/1024-step checkpoints, counted tick(0) checkpoints
without extra work charges, ordered key iteration without a full key-array
clone, pre-admitted scratch/reference movement, stable cooperative merge sort,
allocation-free budgeted code-point comparison, and complete async propagation
through binary operations, sorting families and deletion paths. Ordered string
comparison admits equal-content operands before any engine equality shortcut.
The collector/sorter is named `sortedKeys` rather than introducing a separate
copyKeys-only abstraction; it performs both real operations in one helper.

TDD and validation receipt:

- Added 35 dedicated #654 tests to the already existing
  `tests/commands/jq-control-flow-limits.test.ts`; no new canonical path to register.
  Five existing string-work tests only adapt to binary's async return/rejection;
  their resource-accounting expectations are unchanged.
- Before production edits, the first 31 focused #654 tests produced **27 RED,
  4 passing controls**. After the first implementation they passed **31/31**.
- Initial adjacent regression run passed **278/278** across five maintained
  files. Four final boundary tests then produced **1 RED / 3 GREEN**: equal-content
  ordered strings skipped admission; actual command cancellation already preserved
  false/null/JqError identity with no output. The equality shortcut was moved
  after the charged string-comparison dispatch, addressing that genuine RED.
- Final five-file maintained regression run: **282 tests, 282 pass, 0 fail,
  0 cancelled, 0 skipped, 0 TODO**. This includes all 35 new #654 tests, the
  unchanged neighboring regression cases, and the async assertion adaptations.
- Canonical tests ran with Node v22.22.0, tsx cache disabled, concurrency 1,
  maintained reporter and **default process isolation**, outside the sandbox
  after approved escalation. The sandbox's file-level failures provided no leaf
  evidence and are not product RED. No canonical isolation setting was changed.
- No build, lint, inventory, Git, full npm test, push or release was run by this
  worker. Those remain root gates; the earlier full pass reported by root does
  not cover the newly changed candidate. No wall-time/RSS or abort-latency claim.

Final command, from `packages/safe-bash`:

```sh
TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 \
  --test-reporter=./scripts/test-reporting.mjs \
  tests/commands/jq-control-flow-limits.test.ts \
  tests/commands/jq-control-flow.test.ts \
  tests/commands/structured/string-work.test.ts \
  tests/commands/structured/resources.test.ts \
  tests/commands/structured/semantics.test.ts
```

Scope qualification: this is **active jq only**. Inactive/held query-core and
yq were neither inspected nor modified nor qualified by these tests. The issue's
historical/shared-yq assertion is not evidence that the current held route is
fixed. Root must preserve the unresolved yq qualification when deciding #654
closure; these results establish no yq behavior or release/publication result.

#655 admission/serialization/diagnostic changes have not started. The elapsed
checkpoint primitive is required by #654 and naturally shared by active jq;
that does not make #655's missing proportional/producer admission fixed.

## 1. What we're building

Fix active jq's unpriced key sorting/comparison (#654), then its whole-value
scans, copies, serialization and hidden intermediate allocations (#655).
Charge work before performing it, cooperate during long operations, preserve jq
ordering/value/error semantics, and preserve cancellation reason identity.

### Authority and current write scope

- Original planning-stage permission allowed only this document in the repository.
  The subsequent explicit source-writer grant allowed #654's listed paths; the
  frozen handoff above is the current authority/status boundary.
- Canonical source/tests are **FROZEN again after #654 focused GREEN**. Root must
  explicitly reopen the window before more source/test edits or starting #655.
- Root owns Git, build, lint, canonical integration, delivery and releases. This
  task does not run Git, build, lint, full tests, installs, screenshots or release
  commands. Do not change root configuration, inventories, lockfiles or READMEs.
- The user's subsequent authorization permits unique `/tmp/kamilio-654-655-*`
  test files, bounded memory-only runs and optional unapplied patch artifacts.
  Temporary tests are evidence, **not canonical inventory**. #654 has since been
  implemented in the exact files listed in the frozen handoff; #655 has not.
- Respect `packages/safe-bash/AGENTS.md`; no deeper AGENTS files were found at
  the exact prospective source/test ancestors. No docs ancestor AGENTS file was
  present. Recheck ownership/instructions when root opens the writer window.
- Preserve unrelated edits. Do not restore files, stage anything, create a
  branch, interfere with the active full test, or silently broaden this scope.

### Current issues and validation boundary

Read both current issues with authenticated `gh issue view` against
`poe-platform/poe-code` on September 8, 2026. Both are OPEN, authored by
`kamilio`, with no comments at inspection:

- #654: unpriced synchronous code-point-array sorting in `keys` and object
  comparison, with reported late abort/deadline observations.
- #655: constant-charge whole-value builtins and diagnostic serialization,
  with reported CPU and transient-memory observations.

The initial network-restricted `gh` call failed; the approved network read
succeeded. The issue bodies are reports, not measurements performed here.
**No reported wall time, RSS, heap peak, maxCpuMs overshoot or yq behavior is
verified by this work.** No large witness loops were rerun.

Carry forward prior validated evidence from earlier root/leaf investigations,
without rerunning those witnesses. These are not user-originated measurements:

| Issue | Prior validated evidence, not new measurements |
| --- | --- |
| #654 | Object `keys`: 8 to 128 keys stays at 3 steps; comparisons grow 7 to 127 and code-point arrays 14 to 254. |
| #654 | Comparing 128-key objects at `maxSteps: 1` performs 254 comparisons and 508 arrays before the step-2 refusal. Native sort is synchronous. |
| #654 | Prior `foreach` witness: 32 steps, zero yields, 3200 fake milliseconds; the 1024th tick finally delivers abort. Fake time is not wall time. |
| #655 | Unicode length, to_entries, array keys, reverse, tojson/tostring and diagnostic error work have constant-step gaps. |
| #655 | to_entries registers 128 objects before the step-3 refusal with `maxSteps: 2`; zero calls to `Budget.value`. |
| #655 | A 57-byte object under `maxValueBytes: 64` creates a 185-byte intermediate that succeeds behind length, although direct output refuses it. |

### Explicit non-goals

Do not inspect, change or import held `structured/query-core.ts`, yq or its
evidence trees. Do not infer that fixing active jq fixes the yq portion of #654.
No dependency additions, new public limits/flags, scheduler framework, generic
resource accounting rewrite, global value-size cache, host-process fallback,
new benchmark harness or claimed hard real-time/host-JavaScript sandbox guarantee.
Do not reopen unrelated operators just because they also use native intrinsics.

## 2. User-facing shape

The existing `createStructuredCommands({ limits })` / jq command surface stays
unchanged. The active route is `structured/index.ts` -> `jq.ts` ->
`interpreter.ts`, with `values.ts`, `input.ts` and `limits.ts`. The inspected
structured registration returns jq only; held query-core is not this route.

- Admitted operations preserve output bytes, key ordering, array ordering,
  Unicode code points, number/Decimal behavior and shallow value identity.
- Oversized work fails with the existing `JqLimitError` and diagnostic names,
  e.g. `jq: maxSteps limit exceeded\n`, exit 5 at the command boundary.
- Intermediate value bounds apply before the value can be discarded by
  `length`, `empty`, optional `?`, or `try ... catch`. Jq resource-limit errors
  remain noncatchable by jq filters.
- Ordinary jq type errors remain catchable and keep their existing bounded
  preview bytes. No new error wrapper or generic replacement diagnostic.
- Pre-abort and checkpoint abort preserve the original reason, including
  `false`, `null`, and a `JqError` instance; cancellation must not become jq
  output or be swallowed by optional/try handling.
- A 25ms elapsed checkpoint supplements the existing 1024-step checkpoint.
  This is an opportunity to yield between bounded chunks, **not** a guarantee
  that a host timer fires within 25ms under all loads or inside native work.

Examples of required outcomes after implementation:

| Invocation/filter | Required observation |
| --- | --- |
| `keys` on keys `😀`, `\uE000`, `10`, `2`, `é`, `A` | `["10","2","A","é","\uE000","😀"]`, without native sort. |
| `length` on `"A😀é"` | 4 code points, not UTF-16 length or grapheme count. |
| `to_entries \| empty` on `{"a":0,"b":0}`, maxValueBytes 44 | Refuse the 45-byte intermediate; no output. |
| Same to_entries value at maxValueBytes 45 | Exact-size success, subject to independent work/depth/collection limits. |
| `tojson \| empty` or non-string `tostring \| empty` on `["\n"]`, maxValueBytes 7 | Refuse the resulting string's JSON-encoded value size, not just its raw text size. |

## 3. Implementation details and technical decisions

### Autonomy and prerequisites

Available now: checkout reads, Node v22.22.0, installed tsx, maintained reporter,
in-memory inputs, `node:test` mocks and `registerYieldCheckpoint`. No credentials,
LLMs, VFS disk fixtures, services, dependency installs or build are needed for
the temporary RED tests. Native jq is not required for deterministic unit tests.

Canonical execution starts only after root grants the exact writer window and
coordinates the current full-test boundary. The executor rechecks current bytes
and reruns the focused RED tests before editing. Build/export dependencies,
guarded lint and broader gates remain root-owned; a worker cannot substitute a
direct compiler/linter run for those routes.

### Current call sites that determine the implementation

| Active location at inspection | Relevant behavior |
| --- | --- |
| `src/commands/structured/limits.ts:45` | Budget.step checks abort and maxSteps; tick only yields at 1024 steps. |
| `src/commands/structured/limits.ts:72` | Synchronous Budget.value; value strings already pre-admit UTF-16 length. Do not regress that contract. |
| `src/commands/structured/limits.ts:100` | Ordered object metadata in a WeakMap; objectKeys clones its entire key array. |
| `src/commands/structured/values.ts:8` | describe serializes everything, converts everything to Buffer, then truncates. |
| `src/commands/structured/values.ts:13` | stringCompare materializes two Array.from code-point arrays. |
| `src/commands/structured/values.ts:21` | compare sorts both object key arrays synchronously before recursive comparison. |
| `src/commands/structured/values.ts:55` | entries eagerly maps all pairs before a caller's first awaited tick. |
| `src/commands/structured/values.ts:108` | binary calls compare and recursively calls binary for object multiplication. |
| `src/commands/structured/interpreter.ts:129` | Binary dispatch; assignment at 219, join errors at 328/333 and add at 432 also call binary. |
| `src/commands/structured/interpreter.ts:238` | Deletion path sorting also uses compare; its duplicate comparison at 241 must be awaited. |
| `src/commands/structured/interpreter.ts:265` | String length scans; object length clones keys. |
| `src/commands/structured/interpreter.ts:278` | Array keys maps payloads; object keys uses native sort. |
| `src/commands/structured/interpreter.ts:377` | tostring/tojson serialize or reuse a string, then only text-admit it. |
| `src/commands/structured/interpreter.ts:390` | to_entries eagerly maps pairs to copyObject wrappers, with no intermediate admission. |
| `src/commands/structured/interpreter.ts:429` | Reverse spreads then native-reverses the whole array. |
| `src/commands/structured/interpreter.ts:443` | Shared keyed native sort for sort/unique/group/min/max families. |
| `src/commands/structured/input.ts:290` | stringify charges nodes, allocates scalar encodings before append checks, and joins all parts. |
| `src/commands/structured/jq.ts:176` | Command output calls stringify with a distinct maxOutputBytes allowance. Preserve suffix accounting/backpressure. |

Paths in this table are relative to `packages/safe-bash`.

### Atomic fix A: #654 first

Keep this fix independent of #655's serializer and whole-value changes. Its
source scope is only `limits.ts`, `values.ts`, `interpreter.ts`.

1. **Budget checkpoint, not a second scheduler.** Import existing `monotonicNow`
   alongside `yieldTurn`. Track last completed yield time. Extend
   `tick(count = 1)` to call step(count), then yield when either 1024 charged
   steps have elapsed or monotonic elapsed time is at least 25ms. Update the
   next step threshold and time after the await; check abort afterward.
   `tick(0)` checks abort/time and yields after previously admitted work without
   charging it again. Keep step synchronous and preserve existing default tick
   accounting. Do not edit `src/contracts/yield.ts`.
2. **Enumerate before copying, not copy before charging.** Add an internal
   ordered-key iterator in `limits.ts`. For interpreter-owned objects borrow
   the existing ordered metadata through iteration, never expose its mutable
   array. For plain own-data objects use own enumerable keys without constructing
   an explicit full Object.keys result. Preserve current enumeration semantics;
   do not claim control over an engine's internal enumeration allocation or
   hostile host getters/proxies. Leave existing objectKeys callers outside this
   fix unchanged. A budgeted async key collector checks collection capacity and
   admits each copied slot before push, with awaited checkpoints.
3. **Allocation-free code-point comparison.** Make stringCompare async and
   budget-aware. Before the first codePointAt, admit one comparison step plus
   `ceil(min(left.length, right.length) / 32)` scan units using O(1) lengths.
   This is an explicit conservative work price, not a byte measurement.
   Walk two UTF-16 offsets with codePointAt and advance each independently by
   one or two units. Checkpoint before each group of at most 32 paired code
   points (at most 64 codePointAt calls). Return at the first difference or when
   an operand ends; prefix ordering uses exhaustion, not UTF-16 length alone.
   No Array.from, spread, localeCompare, per-comparison arrays or substring
   materialization. Empty strings still pay the comparison admission.
4. **One stable cooperative sorter.** Implement bottom-up merge sort in
   `values.ts`, accepting an async comparator. Check maxCollectionSize and
   pre-admit scratch capacity before allocating one scratch array. Admit each
   reference move before writing it and checkpoint in bounded batches; await
   every comparator. Choose the left item on equal keys to retain stability.
   O(n log n) comparisons, O(n) scratch references, no native sort and no O(n²)
   insertion-sort substitute. Do not replace actual work charging with a guessed
   n-log-n lump that still leaves a synchronous native sort uninterruptible.
5. **Make comparison genuinely awaitable all the way up.** compare becomes
   async, ticks at each recursive node and awaits string/array/object comparison.
   For objects, budget-collect and sort each key list; compare sorted key vectors
   before corresponding values, preserving jq's existing order. Async binary
   awaits relational comparison and recursive object multiplication. Update all
   interpreter binary calls, including calls intended to throw in join.
   Existing arithmetic step counts remain unchanged; async return mechanics
   alone do not justify extra work charges.
6. **Replace every active comparator-driven native sort.** Object keys, object
   compare, keyed sort-family operations and reverse-order deletion-path sort
   all use the same cooperative sorter. Await deletion dedup comparison too.
   Leaving the keyed/deletion paths native after asyncifying compare would be
   a correctness bug, not a permissible follow-up.

Do not asyncify equality, contains, parsing or Budget.value in this fix. Their
existing behavior is a regression boundary, not implied coverage of all work.

### Atomic fix B: #655 after A

Implement separately on A's accepted source, not as a competing patch against
the same old `values.ts`/`interpreter.ts`. The two fixes have disjoint behavioral
scope, even though they necessarily touch shared files sequentially.

#### Work admission rules

- Known-length shallow work: admit the element/slot count before allocation or
  payload reads. Use checkpoints at most every 32 copied elements. Checking
  collection size alone does not admit work or bytes.
- String scanning/encoding: charge UTF-16 units before scanning or encoding
  each bounded chunk. A work chunk is at most 32 units, adjusted downward so a
  valid surrogate pair is not split. No unpriced Buffer.byteLength or
  JSON.stringify of the complete operand just to discover its price.
- Serialization also prices the final output-string copy before parts.join.
  Native operations remaining in the implementation must have bounded inputs
  or a previously admitted result-size bound; do not call them first and price
  their output afterward. This is not arbitrary native-operation preemption.
- Check signal/work admission before corresponding copies/scans. Keep
  maxSteps refusals noncatchable and preserve pre-abort identity even when a
  type/size error would otherwise be available.

#### Bounded serializer and measurement, without a parser rewrite

In `input.ts`, factor the current writer into a shared bounded JSON-fragment
generator and async consumers. Iterate arrays by index and objects through A's
ordered-key iterator, avoiding whole Object.keys/entries copies.

The generator charges before traversal/scan, produces bounded tokens, checks
depth/collection limits, and preserves compact/pretty syntax, property order,
Decimal spelling, nonfinite numbers and escaping. For a string/key chunk,
calculate exact escaped UTF-8 width before materializing its encoding; admit
that width against the remaining allowance. Account for quotes, backslashes,
short control escapes, six-byte escapes, UTF-8 widths and lone surrogates.
Do not split valid surrogate pairs. No whole-value JSON.stringify shortcut.

- `stringify` becomes async: checkpoint while consuming fragments, admit bytes
  before retaining them, pre-admit final copy work, then join once. Preserve
  separate maxValueBytes/maxOutputBytes names and pretty-output accounting.
- `measureValue` consumes the same bounded fragments without retaining a full
  serialized value. Return exact compact JSON bytes; use the existing
  Budget.value depth convention, including the extra container depth check for
  empty containers. Accept a starting depth for prospective nested values.
- The serializer's `asStringValue` option, used only by tojson and non-string
  tostring, additionally counts how its text will be encoded as a JSON string:
  outer quotes and escaping of the generated JSON text. Admit this total before
  retaining/joining the complete result. Raw text fitting is insufficient.
- Keep synchronous `Budget.value`, `scalarJson` and parseJson contracts intact
  in this bounded fix. In particular, preserve existing string-work tests that
  pin string pre-admission and leave unrelated object-key accounting unchanged.
  The new async measurement is producer-side intermediate admission, not a
  wrapper around the old whole-value synchronous validation.

`maxValueBytes` remains a JSON-value bound, not an aggregate heap/RSS limit.
Fragment storage and partial result storage must remain O(admitted value size),
not an extra unbounded representation of the entire input. No global memoized
byte sizes that can become stale across interpreter updates.

#### Builtin changes

| Path | Minimal implementation and admission point |
| --- | --- |
| String length | Count code points with an offset loop; pre-admit each UTF-16 chunk and checkpoint between chunks. No code-point array. Scalar/null/array length semantics stay unchanged. |
| Object length | Avoid objectKeys(...).length's copy; count ordered keys with charged checkpoints. No sorting. |
| Array keys/keys_unsorted | Pre-admit array length and result slots; generate numeric indices without reading element payloads. Measure/admit numeric JSON widths and commas before each append. |
| Object keys/keys_unsorted | Reuse A's charged collector; only keys sorts. Admit the resulting key-string array as an intermediate before yielding; preserve source order for keys_unsorted. |
| entries | Replace eager pair-array construction with a charged async iterator. Check type/collection and known-length work before payload reads, then checkpoint before yielding each bounded pair. Update iterate, paths, map/map_values, join, with_entries and from_entries loops to for-await. |
| to_entries | No entries(...).map or full pair-array temporary. Admit outer capacity/work first. Before each wrapper registration, measure the key and value at depth 2, check depth and the two-field wrapper's collection size, then check cumulative bytes and only then create/put/push. |
| reverse | Pre-admit slot work and collection size; asynchronously measure input's exact compact bytes/depth before copying. Reversal preserves that total, including nested values. Copy into a new result in reverse order with checkpoints; retain nested references and leave input unchanged. |
| tojson / non-string tostring | Await stringify with asStringValue admission. Admit the returned string before the following filter can discard it. |
| String tostring | Return the same string value, but use charged async exact string-value admission rather than an unpriced whole Buffer.byteLength scan. |

For to_entries the exact prospective entry size is
`17 + encodedKeyBytes + encodedValueBytes` for `{"key":...,"value":...}`;
outer bytes are `2 + sum(entryBytes) + max(0, entryCount - 1)`.
Keys from array inputs remain numbers. Object keys remain strings. Accumulate
bytes incrementally: never remeasure the growing prefix on every append.
If the next wrapper will exceed a limit, refuse before object()/WeakMap
registration for that wrapper. A late `budget.value(fullyBuiltResult)` alone is
not the fix. Exact incremental admission substitutes for that late whole-value
call; admission must finish before yield even when there is no output consumer.

Changing entries to a lazy iterator must not silently erase errors. In
particular, the current non-array unique branch calls entries merely to trigger
type validation. Replace that reliance with explicit equivalent type-error
handling; constructing an unconsumed iterator cannot validate anything.

#### Bounded diagnostics

Keep describe synchronous because its traversal is intentionally tiny, not
because it can serialize an arbitrary operand synchronously. Consume only
enough compact JSON fragments to obtain 15 encoded bytes, or reach EOF.
Keep at most that prefix plus one bounded encoder chunk, never the full operand.

- If EOF occurs below 15 bytes, return the complete text.
- At 15 bytes or more, return the first **11 bytes**, decoded as before, plus
  `...`. Preserve replacement-character behavior when byte 11 splits UTF-8.
- Preserve the `type (preview)` wrapper, current error wording and catchability.
- Do not visit later fields/elements once the preview threshold is satisfied.
  Do not first stringify then slice, even if maxValueBytes would eventually
  reject the complete operand.
- Price the bounded scan/encoding actually performed; no whole-operand scan to
  price a preview. Repeated errors still incur bounded nonzero work and normal
  interpreter checkpoints. Do not charge the full unused operand as a substitute
  for fixing the diagnostic allocation.

This fixes describe-generated type errors. It does not claim every parser error
formatter is bounded; for example, the separate fromjson parse-error input
embedding is outside the validated describe path and is not silently included.

## 4. Interfaces and test plan

### Internal interfaces

No cross-package/public SDK interface changes. Proposed internal signatures:

```ts
Budget.tick(count?: number): Promise<void>;
objectKeyIterator(value: Record<string, Json>): IterableIterator<string>;
copyKeys(value: Record<string, Json>, budget: Budget): Promise<string[]>;
stringCompare(left: string, right: string, budget: Budget): Promise<number>;
compare(left: Json, right: Json, budget: Budget): Promise<number>;
stableSort<Item>(items: Item[], budget: Budget,
  comparator: (left: Item, right: Item) => Promise<number>): Promise<void>;
binary(operator: string, left: Json, right: Json, budget: Budget): Promise<Json>;
entries(value: Json, budget: Budget): AsyncGenerator<[string | number, Json]>;
measureValue(value: Json, budget: Budget, depth?: number): Promise<number>;
stringify(value: Json, budget: Budget, pretty?: boolean, maxBytes?: number,
  limitName?: "maxValueBytes" | "maxOutputBytes", asStringValue?: boolean): Promise<string>;
describe(value: Json, budget: Budget): string;
```

The private fragment encoder belongs beside stringify in input.ts; it provides
real scan/admission behavior shared by measurement, serialization and preview,
not a proxy helper. Its bounded traversal must allow early iterator close from
describe. Avoid a new module/dependency just for these helpers.

### Temporary RED evidence actually obtained

Temporary files, importing the current repository's active `.ts` modules by
absolute path, with fixtures constructed only in memory:

- `/tmp/kamilio-654-655-20260908T055554Z-sort.test.ts`
- `/tmp/kamilio-654-655-20260908T055554Z-values.test.ts`

The completed maintained-reporter run used Node v22.22.0 and tsx, no build or
canonical test discovery. It reports 22 tests: **18 failing leaf assertions,
2 passing control leaves, and 2 failed parent aggregates**. Thus 20 reported
failures do not mean 20 distinct product defects. No cancellations/skips/TODOs.
All 18 leaf failures are assertion failures against current product behavior.

| Temporary test contract | Observed RED |
| --- | --- |
| #654 keys sorts six mixed Unicode/numeric-looking keys without native sort | Correct ordering, but 1 native sort call instead of 0. |
| #654 common-prefix comparison without code-point arrays | 2 string Array.from calls instead of 0. |
| #654 maxSteps 1 refuses before first code-point scan | Missing expected maxSteps rejection. |
| #654 fake time 24ms then 25ms, below step threshold | Missing checkpoint cancellation at 25ms. |
| #654 a single 513-character comparison cooperates, reasons false/null/JqError | Three missing cancellation rejections; no cooperative checkpoint in comparison. |
| #655 to_entries/reverse/array keys pre-admit 64 slots at maxSteps 2 | Three missing rejections; tests require refusal before payload getter reads. |
| #655 length of 33 supplementary code points at maxSteps 2 | Missing work rejection. |
| #655 serialization at maxSteps 1 before native encoding | Missing work rejection. |
| #655 13-byte object -> 45-byte to_entries at cap 44, discarded by empty/try/optional | Three missing maxValueBytes rejections. |
| #655 serialized string value admission for tojson and tostring | Two missing maxValueBytes rejections behind empty. |
| #655 diagnostic preview stops before an irrelevant tail property | 1 tail read instead of 0; expected diagnostic bytes already match. |

Passing controls preserve mixed ordering/prefixes/pre-abort identity, and
diagnostic UTF-8 truncation behavior. These are small new contract tests, not
re-executions of the supplied large/counting witnesses.

Evidence qualification: initial static imports from `/tmp` encountered CJS vs
import-only export resolution; temporary tests now dynamically import the
current ESM source. Initial default-isolation runs returned only file-level
failures, not usable leaf evidence. A first sort spy also hit node:test's refusal
to mock an Array receiver; it was replaced with a scoped try/finally-restored
native-method counter. Those attempts are **not counted as product RED**.
The successful evidence-producing profile uses test isolation `none`, solely
for these temporary probes, with concurrency 1. No maintained runner setting
was changed, and this is not a canonical/default-isolation gate result.

Exact evidence command from the repository root; expected exit is 1 on the
unfixed source. The 128MiB old-space setting is a process cap, not a measurement
of product heap or a maximum total RSS claim:

```sh
TSX_DISABLE_CACHE=1 timeout 15s node --max-old-space-size=128 \
  --import /home/kjopek/project/poe-code/node_modules/tsx/dist/loader.mjs \
  --test --experimental-test-isolation=none --test-concurrency=1 \
  --test-reporter=/home/kjopek/project/poe-code/packages/safe-bash/scripts/test-reporting.mjs \
  /tmp/kamilio-654-655-20260908T055554Z-sort.test.ts \
  /tmp/kamilio-654-655-20260908T055554Z-values.test.ts
```

### Canonical RED tests ready for the writer window

Port contracts to existing maintained files, use package-relative `.js` imports,
and keep tests fast, deterministic and memory-only. Parse filters under a
separate ample Budget before installing work spies; use a fresh execution
Budget so lexer/parser/input work cannot create a false RED. Restore global
mocks in finally and keep their tests serial. Getter instrumentation observes
copy order; it is not a claim that arbitrary host getters are safe jq inputs.

**A / #654, before production edits:**

1. Port the seven RED leaves and ordering control into
   `tests/commands/jq-control-flow-limits.test.ts`.
2. Add an object-comparison budget test with fresh small unequal objects: no
   key copy/scan after the recursive node exhausts maxSteps. Inspect work before
   refusal, not merely eventual rejection. Add collection refusal before sort
   scratch allocation using the input array's exact size boundary.
3. Exercise keys, sort/sort_by, unique/unique_by, group_by, min/max variants and
   deletion paths through Interpreter. Assert no native sort; retain stability
   for equal keys, including which original item min_by/max_by selects.
4. Test empty/equal/prefix strings, differing supplementary/BMP characters,
   combining characters and lone surrogates; nested arrays/objects, integer-like
   key insertion order, null/boolean/number rank, Decimal and nonfinite cases.
5. Test the 1024-step checkpoint with a constant fake clock, the 24/25ms
   boundary, clock reset after yielding, and a comparator that advances fake
   time. Verify cancellation from inside a single comparison, not just before
   sort starts or between foreach iterations. No real timer/RSS assertions.
6. Add interpreter `try`/optional cases for false/null/JqError abort reasons and
   maxSteps; require exact rejection identity, no caught value, and no writes.
7. In `tests/commands/structured/string-work.test.ts`, mechanically await binary
   results and use assert.rejects for its now-async failures. Preserve all
   existing numeric accounting expectations and unrelated assertions.

**B / #655, before its production edits:**

1. Port the eleven RED leaves to `tests/commands/structured/string-work.test.ts`.
2. Add first-refusal spies for JSON.stringify/Buffer.byteLength/Buffer.from,
   per-entry object registration and array payload reads. Pre-admission tests
   must fail before the corresponding expensive operation, not after it.
3. For each scan/copy path compare small and larger bounded fixtures and sum
   charged units, not merely count step() calls. Test equality at the selected
   work boundary and one unit below, independently of parser charges.
4. Test to_entries exact 45/44 bytes, array numeric keys, escaped/multibyte keys,
   nested depth, wrapper collection size 2, final outer length, and no next
   wrapper registration when its cumulative bytes would exceed the cap.
5. Exercise every rebuilt result both directly and behind `length`, `empty`,
   `try` and `?`; add command-level assertions in resources.test.ts for exit 5,
   no swallowed limit and no accidental output. Do not count emission-only
   validation as producer admission.
6. Test serialized string values containing quotes, backslashes, NUL/control
   escapes, BMP/supplementary characters and isolated surrogates. Test pretty
   output, exact output cap including suffix, and raw/join-output compatibility.
7. Test diagnostic serialized lengths 14 and 15, an 11-byte UTF-8 split,
   giant-but-bounded first string and unread later field, wrong-type entries,
   fromjson/tonumber type errors and repeated catchable arithmetic type errors.
   Assert identical preview bytes and no full-operand serialization.
8. Use fake elapsed time and abort checkpoints inside scan/copy/serialization,
   plus pre-abort tests. Preserve false/null/JqError identity and iterator
   retirement/backpressure at jq output. Never await a thenable hidden in a Json
   result or catch a limit as an ordinary jq error.

### Focused validation and real command boundary

After writer permission, root/assigned executor uses the maintained reporter
for exact files rather than adding filename arguments to scripts/test.mjs:
that script still appends the whole discovered suite. From packages/safe-bash:

```sh
TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 \
  --test-reporter=./scripts/test-reporting.mjs \
  tests/commands/jq-control-flow-limits.test.ts \
  tests/commands/structured/string-work.test.ts \
  tests/commands/structured/resources.test.ts \
  tests/commands/structured/semantics.test.ts
```

Start with the changed issue's exact files/test names, then run these adjacent
regressions. Keep default isolation for canonical tests; the temporary profile
is not permission to change canonical runner policy. Existing oracle-dependent
tests need root's maintained environment; report missing prerequisites instead
of silently skipping or claiming parity.

Real command-boundary checks use existing `runWithBytes`/`run` in
`tests/commands/structured/helpers.ts`, which dispatch actual registered jq
with in-memory stdin/stdout/stderr and MemoryFileSystem, not a replacement
interpreter. Add and execute these exact cases in resources.test.ts:

1. `run(["-c", "keys"], '{"😀":0,"\\uE000":0,"10":0,"2":0,"é":0,"A":0}')`
   returns the ordered key array in level 2 plus newline, status 0, empty stderr.
2. `run(["-c", "to_entries | empty"], '{"a":0,"b":0}',
   { limits: { maxValueBytes: 44 } })` returns status 5, empty stdout and
   `jq: maxValueBytes limit exceeded\n`; at cap 45 it succeeds with empty output.
3. Run `try (to_entries | empty) catch 99` and `(to_entries)? | empty` with the
   same input/cap: no 99, same resource refusal. Repeat tojson/tostring escaped
   value cases to prove the producer, not an output sink, admitted the result.
4. Pass an AbortSignal and observing sinks to the actual command; trigger its
   checkpoint after the target operation starts. Assert the exact reason and
   no additional writes. Retain existing falsey sink-failure/retirement tests.

Root-only gates, scheduled after the source window and focused results: the
selected maintained build closure is
`npm run build:workspaces -- --workspace=virtual-bash`; root may select the full
`npm run build` when required by export dependencies. Typecheck only after the
required declarations exist, using the maintained workspace route. The inspected
root `npm run lint:eslint` accepts no arbitrary path selector; do not invent one
or bypass the guard with direct eslint/tsc. Root schedules lint and full `npm test`
as needed, with existing uncached/environment-scoping policy. No README or
visual CLI redesign is part of these fixes; any later terminal smoke/screenshots
are root-coordinated, not new screenshot tests or a reason to interrupt the freeze.

### Must-work checklist

- [ ] #654 seven temporary RED contracts pass after porting; cooperative
  comparison aborts within the first completed bounded scan chunk in fake time.
- [ ] Stable sort and jq ordering/deletion/number regressions pass in canonical
  semantics and focused new cases; no active comparator-driven native sort remains.
- [ ] #655 eleven temporary RED contracts pass after porting; prospective wrapper
  refusal and hidden intermediate byte boundaries are proven before yield.
- [ ] Bounded diagnostic prefix fixtures match exact prior bytes and never read
  the irrelevant suffix; ordinary errors remain catchable.
- [ ] Command-level resource, cancellation, falsey sink and retirement checks
  pass with exact identities and output bytes.
- [ ] Root-owned build/type/lint/current-test gates pass on the actual candidate;
  focused or temporary evidence is not presented as a full gate.

## 5. Code plan

### Exact prospective source-writer grant

All paths below are relative to `/home/kjopek/project/poe-code`. These are
**requested future paths**, not current permission. No new source/test file is
necessary, so no inventory/script edit is included.

| Atomic fix | Exact path | Change |
| --- | --- | --- |
| A | `packages/safe-bash/src/commands/structured/limits.ts` | Elapsed/count-aware tick; read-only ordered-key iterator. |
| A then B | `packages/safe-bash/src/commands/structured/values.ts` | A: charged copy/sort, async code-point/Json comparison and binary propagation. B: lazy entries and bounded describe. |
| A then B | `packages/safe-bash/src/commands/structured/interpreter.ts` | A: await all compare/binary/sort paths. B: whole-value pre-admission and async iterator/serializer consumers. |
| B | `packages/safe-bash/src/commands/structured/input.ts` | Bounded fragment encoder, async exact measurement and serializer. |
| B | `packages/safe-bash/src/commands/structured/jq.ts` | Await output serializer without moving output admission, catch/finally or sink semantics. |
| A then B | `packages/safe-bash/tests/commands/jq-control-flow-limits.test.ts` | Comparison/checkpoint/resource/cancel REDs and B's cooperative-control regressions. |
| A then B | `packages/safe-bash/tests/commands/structured/string-work.test.ts` | A's async binary assertion adaptation; B's scan/copy/serializer/preview REDs. |
| A then B | `packages/safe-bash/tests/commands/structured/semantics.test.ts` | Sort/deletion/key-order and whole-value semantic boundaries. |
| B | `packages/safe-bash/tests/commands/structured/resources.test.ts` | Intermediate byte/depth/collection and actual jq command-boundary tests. |

No changes to `parser.ts`, `numbers.ts`, `split.ts`, structured public index,
`contracts/yield.ts`, package exports, scripts/integration-inputs.test.mjs,
held query-core/yq, archived fixtures or README files. If a needed implementation
cannot fit this grant, stop before touching an additional file and return the
concrete scope delta to root. Do not use unrelated test relaxation to fit it.

### TDD implementation order

1. **Already done, temporary only:** current gh issue read, active-source audit,
   two `/tmp` test files, 18 genuine leaf REDs and two passing controls.
2. **After root grants A's window:** port A tests, verify genuine canonical RED,
   then implement tick and key iteration. Implement async comparator and stable
   sort together with all consumers so no Promise enters native sort or Json.
   Update binary tests' async mechanics without changing expectations. Run A's
   focused tests and semantic regressions; refactor only with GREEN evidence.
3. **Root accepts A independently:** hand off exact paths and before/after
   evidence. Suggested atomic subject: `fix(safe-bash): charge cooperative jq sorting`.
   Do not postpone a valid A handoff for B's larger serializer work.
4. **After root grants B's window on A:** port B REDs; implement bounded encoding
   and exact measurement, then prospective collection construction and bounded
   diagnostics. Adapt all async consumers, including output serialization and
   lazy entries validation. Run B's focused tests plus A's regression set.
   Suggested atomic subject: `fix(safe-bash): admit jq whole-value work before allocation`.
5. **Root delivery only if requested:** preserve atomic commits and include the
   relevant plan. Report local commit, verified remote-main delivery and release
   publication separately. Monitor any authorized push through successful release.
   #655 can be closed after its validated fix is verified on remote main. #654's
   jq result alone does not authorize claiming its yq portion resolved; root must
   retain the explicit remaining issue scope before deciding closure.

If root requests unapplied #655 patch artifacts while canonical files are still
frozen, prepare separate `apply_patch`-compatible `/tmp` patches for A and B,
clearly naming B's A dependency and leaving both unapplied. An unexecuted patch
is not GREEN evidence. The #654 GREEN receipt above records actual focused
execution only; no canonical inventory update, commit, push or release is claimed.

## September 8: #655 canonical handoff

The seven-file active-jq implementation is frozen after 380/380 passing
assertions across ten focused files, with no failures, cancellations or skips.
Before implementation, eleven temporary contract witnesses failed alongside
one passing control; five canonical command-admission cases also failed.

The serializer now measures and renders bounded fragments with proportional
work and cooperative checkpoints. Prospective keys, entries and reverse
results are checked before construction; Unicode length is charged and
cooperative, and diagnostic descriptions stop after a bounded prefix.
Iteration is lazy instead of constructing a full entries array. All active
serializer callers await results and entries callers iterate asynchronously.

Changed sources are structured `input.ts`, `values.ts`, `interpreter.ts`, and
`jq.ts`. Existing `string-work.test.ts` and `resources.test.ts` contain the
regressions. The active independent-increment `numeric-safety.test.ts` changes
only one callback to async and awaits its serializer; operands, quotas and
assertions remain unchanged. Its prior SHA-256 is
`5ad8d138f3733aa57f2c3a3147d20cb72affc6323111852cf646069da335e363`.
No historical manifest, sealed copy or held query-core/yq source was changed;
this handoff makes no historical replay or inactive-yq qualification claim.

Temporary patch artifacts are `/tmp/kamilio-655-20260908T063023Z-production.patch`
and `/tmp/kamilio-655-20260908T063023Z-tests.patch`; their temporary candidate
passed 21/21 before canonical application. No new test path was introduced.
Root build, package-wide validation, lint, push and publication follow separately.
