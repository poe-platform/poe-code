# Nullable C-profile engine diagnosis and bounded correction proposal

August 27, 2026. Delegated diagnosis leaf; no delegation. **Evidence only.**
Product candidate: `27a7793526830768484885afba5832bf8bb248b5`.
The independent eight-row cohort remains **five failures and three controls**.
No product, export, old evidence, dependency, canonical test, or build changed.

## Decision requested

Authorize an internal repeat/capture-state correction in
`src/commands/expr/bre-worker.ts`, followed by separate verification, **not a new
shared regex engine or protocol**. Do not remove the guard alone or merge this
diagnostic prototype. First decide whether this work targets coherent C/BRE
matching or exact compatibility with the pinned GNU 9.7/Darwin reconstruction
anomalies. These targets conflict on `aaa`; neither refusal nor a different
oracle resolves that conflict. Keep the frozen GNU expectation unchanged.

The immediate rejection is one guard, but the underlying causes are not five
identical matcher failures: four star cases encounter an information-losing
epsilon guard; the exact mandatory case is conservatively refused despite
having distinct unrolled instruction addresses. GNU has additional failures
in capture reconstruction that must not become invented normative semantics.

## Provenance and exact original denominator

Read `../AGENTS.md`, root `AGENTS.md`, independent evidence `50b1e560`, and
historical diagnosis archive `7f22cb8c13d5520f870585ab0d1b476083a213bc` at
`../nullable-capture-review`. This review adds transition-level evidence to that
diagnosis; it does not repeat its 36-row audit or count its observations anew.

`capture-final/original-eight.json` is a byte-exact copy of
`../extension-review/after-abort-fix/replay/supplement-27a77935/nullable-separate-cohort.json`.
It retains the full argv, native identity, expected/actual status/stdout/stderr,
and original comparison results. The old file is untouched.

Below, `B` is the literal BRE `\(a*\)*\1`. Every argv is
`["+", subject, ":", BRE]`. Tuples are `(status, stdout hex, stderr hex)`.
`R` is exactly `(2, "", hex("expr: unsupported BRE: backreference to a capture in nullable repetition\n"))`.

| ID | Subject | BRE | Frozen GNU tuple | Candidate tuple | Original classification |
| --- | --- | --- | --- | --- | --- |
| empty | empty | B | `(1,0a,"")` | R | failure |
| a | a | B | `(1,0a,"")` | R | failure |
| aa | aa | B | `(0,610a,"")` | R | failure |
| aaa | aaa | B | `(1,0a,"")` | R | failure |
| no-reference | aaa | `\(a*\)*` | `(0,6161610a,"")` | same | control |
| not-repeated | aaa | `\(a*\)\1` | `(0,610a,"")` | same | control |
| nonnullable | aaa | `\(a\)*\1` | `(0,610a,"")` | same | control |
| mandatory-empty | empty | `\(a*\)\{2\}\1` | `(1,0a,"")` | R | failure |

All eight native tuples were reproduced exactly against the **same binary**:
`tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr`, SHA-256
`e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c`.
The process environment was explicitly `{PATH:/usr/bin:/bin, LC_ALL:C, LANG:C,
LANGUAGE:C, TZ:UTC}`. Engine descriptors explicitly select `profile:"byte"`.
There is no ambient-locale inference, GNU/Linux claim, or libc-provider claim
from the host name. Host: Darwin 25.4.0 arm64; Node v22.22.2.

The instrumented candidate module comes from `git show CANDIDATE:path`, not
live source or possibly stale dist. Instrumentation records instructions,
visited states, and counters; it does not alter matching decisions. This is
direct worker-engine evidence, **not another public Shell replay**. Original
public command evidence remains the independent report. Protocol bytes also
come from that Git candidate; SHA-256 values are in each successful capture's
`provenance.json`. Historical dirty-source ambiguity is not silently repaired.
The diagnostic result adds counters outside the public shape; this extra field
is not passed through reply validation and is not a proposed protocol extension.

## Exact five-failure mapping

### Shared immediate cause

`validateCaptureRepetition` (`bre-worker.ts:161`) marks group 1 ambiguous when
visiting a repetition whose maximum exceeds one and whose child is nullable.
`a*` is nullable; a later reference to group 1 intersects that set. Compilation
throws before any match states execute. Every failed candidate row therefore
has the same unsupported result, regardless of subject. The guard is neither
a syntax proof nor support for these valid-looking BREs.

For B, deleting only the validation call yields these instruction addresses:
`0 outer-split; 1 save-start; 2 inner-split; 3 literal-a; 4 jump-to-2;
5 save-end; 6 jump-to-0; 7 backref-1; 8 accept`.
`State.visited` remembers only PC since the last consumed byte. It loses repeat
identity, iteration entry, and which capture history made that PC reachable.

| Failure | Exact unguarded state/capture history | Consequence and correction boundary |
| --- | --- | --- |
| empty | At PC 0, offset 0, captures `[0,0]`, visited `[0,1,2,5,6]`, the newly participating empty group is pruned. The saved zero-iteration exit has `[-1,-1]`, so its backreference fails. | Unguarded says no match. Need one participating empty iteration with continuation, distinct from an absent group. GNU registers are whole `[0,0]`, group `[0,0]`. |
| a | Consuming `a` and closing group yields `[0,1]`; reopening at offset 1 changes start but leaves stale end 1, giving `[1,1]`. PC 2 repeats with visited `[4,2,5,6,0,1]` and is pruned. The empty-at-zero path is also pruned as above. | Unguarded says no match. A coherent nullable match can instead finish at offset 0 with a participating empty capture; its visible tuple equals GNU, but GNU reports whole length 1, which this path cannot justify. |
| aa | The same PC 2 collision occurs at offsets 2 and 1; the empty-at-zero path is pruned. The separately saved exit at offset 1 retains closed capture `[0,1]`; backref consumes the second `a`. | Unguarded already gets whole `[0,2]`, group `[0,1]`, matching GNU. The candidate failure here is over-refusal, not proof that this particular successful history needs repair. Guard deletion is still unsafe for the other rows. |
| aaa | At offset 1, PC 2 is pruned after reopening group 1, preventing the next productive iteration. Surviving single-iteration history captures `[0,1]`, references `[1,2]`, and accepts only two bytes. | Valid full history is group iterations `[0,1]`, `[1,2]`, then backref `[2,3]`. Repeat-aware execution reaches it. GNU's visible empty result instead comes from unfinished `[0,-1]`, not a valid terminal empty iteration. |
| mandatory-empty | Unrolling yields group-one save/inner-loop/save at PCs `0..4`, a second distinct copy at `5..9`, then backref 10 and accept 11. Both required empty captures close at `[0,0]`; no PC is pruned. | Guard conflates finite required copies with epsilon cycling. Unguarded succeeds with whole/group `[0,0]`; GNU reports **no match**, which happens to produce the same empty expr tuple. This difference must remain visible internally. |

`capture-final/unguarded.json.gz` contains each complete small trace, not just the
selected collision. Existing stale close slots are another reason to represent
open versus closed capture state explicitly; `[position, oldEnd]` is not a new
closed capture merely because the numbers coincide.

## GNU reconstruction: new exact transition evidence

The supplemental C probe links the existing local `libcoreutils.a` and calls
GNU `re_compile_pattern`/`re_match` under explicit C, with expr's syntax flags
and `newline_anchor=0`. A **separate instrumented diagnostic rebuild** of local
regex sources logs `set_regs`, epsilon destinations, and fail-stack snapshots.
It is not the oracle. On all 24 local cases its returned register bytes equal
the archive-linked probe; only pinned expr supplies expected command tuples.
Source/archive/header hashes and compile argv are recorded. This equality is
not a reproducible-build proof connecting the archive to expr or to upstream.

For B, native node IDs are: `4 outer repetition`, `0 open`, `2 inner
repetition`, `1 a`, `3 close`, `5 backreference`, `6 terminal`.
The first matching phase sets whole-match end before register reconstruction.
`set_regs` updates capture registers **before** testing whether the current
node repeats in its epsilon set. Its shared terminal/cycle branch returns
`free_fail_stack_return`, whose normal value is success, even when an open
register has exhausted the fail stack. These source locations are in release-
pinned gnulib `regexec.c` (`set_regs`, `update_regs`, `proceed_next_node`) [G2].

- **empty:** node 3 closes `[0,0]`; returning to node 4 triggers the cycle branch.
  No unfinished register is found, so reconstruction returns success without
  traversing terminal 6. Here the returned length and capture have a valid
  interpretation anyway.
- **a:** reconstruction first closes `[0,1]`, saves backref exit at offset 1,
  reopens `[1,-1]`, and collides at node 2. That saved backref fails for lack of
  remaining bytes. Popping the earlier close-node snapshot at offset 0 produces
  `[0,0]`; node 4 is already visited. The cycle branch returns success, still
  carrying the **preselected whole end 1**. It never reconstructs a path to
  terminal 6 at offset 1. This is an additional concrete anomaly, not evidence
  for a productive iteration followed by gratuitous empty capture replacement.
- **aa:** the offset-1 saved backref with `[0,1]` succeeds and reaches terminal
  6 at offset 2. This particular successful reconstruction is complete.
- **aaa:** productive attempts at offsets 3 and 2 fail backreference length;
  the offset-1 reopening hits the inner node-2 cycle, preventing the needed
  second consuming group. Popping the final snapshot restores offset 0,
  node 3, capture `[0,-1]`, previous registers `[-1,-1]`. The loop's subsequent
  `proceed_next_node` traverses this popped close node **without executing its
  `update_regs`**. At node 4, offset 0, another cycle still has `[0,-1]` and no
  remaining fail entries. `pop_fail_stack` returns -1 and the cycle branch
  returns success. Whole end remains 3; group end remains -1. GNU expr maps a
  negative first-capture end to empty [G1]. This traces the prior archive's
  observed unfinished register down to the exact reconstruction branch.
- **mandatory-empty:** matching chooses whole end 0, then reconstruction opens
  group 1 at node 0. Its only epsilon destination is node 2, but the sifted
  state at offset 0 contains **only terminal node 9**. No eligible destination
  exists (`edges node=0: 2/0 state: 9`); no fail entry exists; `set_regs` returns
  no-match. This is not the star loop's premature-success branch. The upstream
  sifting/interval-expansion reason for dropping node 2 has **not** been traced
  further and is an explicitly unresolved native question.

`native-followup.json` contains the focused five-row destination-set trace;
`capture-final/native.json` contains the final expanded observations. No odd/even
law, every-provider behavior, or repaired GNU implementation is inferred.

## Normative semantics versus JS versus pinned runtime

The whole leftmost-longest rule precedes submatch preference; an empty
participating subpattern differs from no participation. POSIX Issue 7 XBD 9.1
states these priorities [P1]. Issue 8 rationale A.9.1 explains the dependence
of subexpression choice on the longest whole match [P2]. Issue 6 XBD 9.3.6
explicitly restricts gratuitous repeated empty matches and specifies the last
participating repeated capture for backreferences [P3]. These are separately
identified editions, not a claim that a historical excerpt certifies every
current nested/repeated tie-break. Issue 8 base-text direct retrieval was not
available in this review; the cited rationale is informative, not normative.

For B on `aaa`, two nonempty one-byte iterations plus one-byte backreference
are a concrete full-length witness with closed capture `a`. There is no need
to use GNU's open register or an optional trailing empty iteration to obtain
that whole match. For empty subject, a sole participating empty iteration is
necessary to distinguish successful backreference from absent capture. For
mandatory-empty, two required empty occurrences are finite, not an epsilon
cycle. The `a` coherent whole span is zero, although its command bytes agree
with GNU's inconsistent whole-one/empty-capture reconstruction. These are
bounded semantic deductions, **not a full POSIX conformance claim**.

Do not implement submatch selection as “longest final first-capture length”
without a specified repeated/nested history policy. The official historical
interpretation 9945-2-135 discusses ambiguity between subexpression and
fencepost models and does not justify declaring a universal conformance
winner from that old text [P4]. The prototype's flat final-register comparator
is deliberately an unqualified hypothesis. Its GNU differences on
`mandatory-no-reference` and `alternation-longest` demonstrate the merge risk.

ECMAScript `RepeatMatcher` rejects optional empty iterations after the minimum
and resets captures within the quantified atom; its backreference semantics
also permit an unmatched capture to act empty [J1]. It is not a substitute
oracle. The fixed literal JS control runs **inside a worker**: `^(a*)*\1` on
empty and `a` returns an empty whole match with absent group, whereas `aa` and
`aaa` return capture `a`. This visible agreement on some rows does not establish
BRE capture presence or whole-longest equivalence. No main-thread untrusted
RegExp is compiled or executed.

## Bounded implementation proposal: existing paths only

### 1. Retain repeat identity and progress

In `src/commands/expr/bre-worker.ts:189`, lower repetition to an internal
repeat-enter/repeat-end pair instead of erasing its identity into split/jump.
The entry instruction index is a stable static repeat identity. Each dynamic
frame also identifies its parent iteration, entry offset, completed count,
required/optional status, and capture/history checkpoint. The prototype already
demonstrates this lowering without changing descriptor or reply fields.

At an optional exit, save the **pre-iteration** state. Permit a productive
iteration even when it reaches an inner instruction at an offset visited by
a previous iteration. Complete required zero-width iterations until the minimum
is satisfied; do not prune them as cycles. Admit a sole participating empty
iteration when it is the repetition's empty match. Do not replace a prior
productive capture with a gratuitous optional zero-progress iteration: return
to the saved exit state instead. Nested frames must be scoped to their dynamic
parent iteration, not just a global PC or offset. Before broadening beyond
these cases, explicitly settle empty-branch histories whose participation
changes without input movement; do not assume a capture-only epsilon key is
sufficient. The prior archive already disproves that shortcut.

### 2. Branch-local captures and history-based selection

In `bre-worker.ts:282`, store absent/open/closed capture states separately from
the numeric interval. Save-open invalidates the current close; save-close marks
participation even for equal offsets. Fork and restore repeat frames, current
captures, and capture-history checkpoints together. A persistent bounded history
arena with parent links can share immutable entries between branches, or small
vectors can be copied after charging; neither may alias mutable branch state.

Tag capture events with group identity and enclosing repeat iteration. Preserve
the last **legitimately participating** capture for a closed backreference;
define nested absent-group behavior against the intended profile before
clearing or retaining descendant registers. The narrow `nested-stale-backref`
case records GNU retaining an inner prior-iteration capture, so blindly applying
JS-style clearing would change existing GNU-compatible behavior.

Accept only completed paths. First compare whole endpoints; then apply the
approved subpattern/history precedence, including empty versus absent, earlier
and enclosing groups, and repeated occurrences. Never fix `aaa` by preferring
empty output. Capture-vector equality alone is not a safe dominance rule when
future backreferences or repeat frames differ. An initial correctness version
can enumerate bounded alternatives without merging; later pruning requires a
proof that future continuations and priority histories are equivalent.

### 3. Charge before work, not after

Use existing `Work` budgets (`bre-worker.ts:13`), but audit reservation order:
charge a node **before constructing** its AST/instruction object; reserve a
state before creating the initial state or cloning a branch; reserve all vector,
frame, history-entry, and comparison scratch units before allocation/copy. Charge
every history scan, comparison, frame traversal, epsilon decision, and compared
backreference byte before performing it. Count cumulative allocations even if
later discarded. Array growth and retained snapshots need a conservative unit
formula, not an assertion that JavaScript object bytes equal logical units.

The existing `tree(object)`/`emit(object)` callers construct objects before
the method charges, and the initial state calls `state()` after allocation.
The diagnostic prototype inherits these details and its logging is outside
product budgets: **its counters are not a complete allocation proof**.
Production reservation order must therefore be fixed as part of the proposed
worker change. No unbounded native regex, dependency, or main-thread fallback.

### 4. Closed references, anchors, and unchanged protocol

Retain the parser's syntactically closed-reference check at `bre-worker.ts:82`:
self/forward references remain syntax errors; a runtime absent group makes a
backreference fail, while a closed empty group consumes zero bytes. Preserve
whole-string anchoring and byte offsets. `$` checks the actual end, not JS's
before-final-newline rule. The controls `unmatched-closed`, `required-empty`,
`open-backref`, `end-anchor`, `literal-suffix`, and `newline-anchor` pin these
boundaries without expanding the accepted anchor dialect.

`src/commands/regex-execution/protocol.ts` **need not change**. Its existing
`matched`, `hasCapture`, nullable `overall`, and nullable `capture` already
distinguish no capture in syntax, absent first capture, empty closed capture,
and no whole match. Invalid/open internal captures must never be serialized as
negative spans. If a separately approved GNU-compatibility mode were ever
required, an explicit dialect selector would affect protocol/input validation
and public configuration; it is **not proposed or authorized here**. In
particular, `profile:"byte"` means encoding behavior, not permission to silently
choose between POSIX and GNU anomalies.

### 5. Cancellation and retirement remain transport responsibilities

Keep `src/commands/regex-execution/client.ts` and `worker.ts` unchanged for the
repeat correction. Worker matching is synchronous; a worker-local AbortSignal
cannot be delivered mid-loop through the same blocked event loop. The parent
must continue enforcing deadlines/abort with worker retirement and await
termination. Preserve checks before admission, after startup, after exchange,
after reply validation, and before resolving; preserve the explicit rejected
boolean so even an undefined rejection remains a rejection. Never return a
previous best match when a budget/deadline aborts exhaustive selection.

`withRegexSession` must still synchronously register cleanup before opening the
session; overlapping close calls share completion. Dispose/abort settlement
must await cooperative tracked retirement, not accept a late result or reuse a
retired worker. Late replies must not satisfy a new request. No new shared-memory
cancellation protocol is needed for this scoped change. The earlier installed
candidate report has separate 26-case cancellation evidence; it is **not rerun
or counted as prototype acceptance**. This leaf's four diagnostic jobs all
await termination; it does not claim to have interrupted the prototype in a
particular compile/match phase.

## Algorithm, correctness obligations, and complexity

The proof obligation is path preservation: every accepted path follows actual
input transitions and closed backreference values; every required repetition
is represented; forbidden empty stuttering is eliminated without discarding a
distinct productive/history-relevant continuation. Branch checkpoints restore
the exact pre-iteration state. Whole-match selection examines all admitted
paths, not merely the first greedy success. History precedence must then be
specified and checked independently; the current prototype does not prove it.

Let P be compiled nodes, D active repeat depth, G captures, N subject bytes,
S admitted states, and T charged work. Counter-based repetition can compile
in O(P) space rather than multiplying instructions by large interval counts.
A straightforward clone costs O(G+D); comparing a history of H events costs
O(H), all charged. Backreferences compare up to O(N) bytes per transition.
Ambiguous repetitions/backreferences can still explore exponentially many
histories; **no linear-time claim** is made. Hard ceilings on T, S, P and
cumulative allocation A turn exhaustion into a limit error, not a partial
match. Peak retained arena/vector storage is bounded by reserved A logical
units, not a measured RSS guarantee. Worker heap/stack limits and the parent
deadline remain independent bounds. Dynamic counts must respect finite maxima
and safe arithmetic; accepted intervals currently top out at 32767.

## Prototype measurements and counterexamples

`prototype.mjs` is a transformation recipe applied only to Git-loaded text in
a unique OS-temp directory. Its repeat frame has identity/count/entry offset;
branch forks copy frames and captures; save-open invalidates the end. Its
flat final-capture comparator is **not the complete proposed history policy**.
No generated TypeScript or C fixture is placed in canonical discovery.

The final local cohort is **the unchanged eight plus sixteen named narrow
controls**, not an expanded official denominator. Each of four variants also
gets four limit probes (`maxSteps`, `maxStates`, `maxNodes`, allocation, each 1).
All four prototype limit probes throw category `limit`; none produces a match.
Counters below omit diagnostic logging overhead and use existing Work units.

| Original failure | Repeat-frame whole / capture | Steps | States | Nodes | Allocation units | Observed ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| empty | `[0,0] / [0,0]` | 240 | 3 | 16 | 218 | 0.687 |
| a | `[0,0] / [0,0]` | 308 | 6 | 16 | 271 | 0.367 |
| aa | `[0,2] / [0,1]` | 444 | 12 | 16 | 375 | 0.296 |
| aaa | `[0,3] / [1,2]` | 710 | 24 | 16 | 579 | 0.069 |
| mandatory-empty | `[0,0] / [0,0]` | 274 | 3 | 16 | 245 | 0.055 |

The three original control tuples are unchanged by the repeat-frame prototype.
If its spans are mapped to expr's output rule, four original failed tuples
would agree; **aaa would still differ**. This is a diagnostic projection, not
a Shell result or four new candidate passes. `a` and `mandatory-empty` also
continue to differ from GNU's internal whole-match result despite equal bytes.

Important negative results retained in `capture-final/summary.json`:

- Removing only the guard still fails empty participation and underconsumes
  `aaa`; anchored/suffixed variants expose the underconsumption as no match.
- `exactMandatoryOnly` opens only finite exact repetitions. It fixes the
  mandatory-empty command tuple, but does not address repeated submatch choice;
  `mandatory-aa`/`mandatory-aaa` and the frame prototype choose different capture
  histories. There is no demonstrated safe tiny complete fix. The one-line
  `rejected-mandatory-only.patch` is **a rejected hypothesis, not a recommended
  production patch**, and has never been applied to live source.
- `mandatory-no-reference`: candidate/GNU capture `[3,3]` and print empty;
  the prototype chooses `[0,3]` and would print `aaa`. This defeats any claim
  that the new comparator preserves previously accepted GNU C behavior.
- `alternation-longest`: GNU/candidate capture `a`, prototype `aa` at the same
  whole length 3. BRE alternation is an extension-sensitive control, not a
  warrant to label that result universal POSIX semantics.
- `bounded-aaa`: GNU whole length 2, prototype length 3, but both expose `a`.
  Byte-only command comparisons conceal this difference.
- `nested-stale-backref`: GNU, candidate, and prototype all use an inner capture
  from an earlier outer iteration. This is a recorded compatibility boundary,
  not proof that arbitrary nested capture restoration is correct.

The prototype job including all 28 rows took 32.35 ms including startup;
largest retained trace was 154 events. These are single-run, sequential,
instrumented, cohost-load-dependent observations, **not a performance comparison,
benchmark win, stable memory measurement, or order-controlled cohort**.

## Proposed validation/write set after approval

Product write: only `src/commands/expr/bre-worker.ts` initially. The product
integration owner, not this leaf, would own any later public/export decision.
Scoped tests should extend inspected `tests/commands/expr/regex-native.test.ts`,
`regex-cases.ts`, `regex-protocol.test.ts`, `regex-limits.test.ts`, and
`regex-lifecycle.test.ts`; preserve `abort-reason-regression.test.ts` behaviors.
Record exact eight original tuples beside independent internal-span assertions,
never replace them with POSIX-witness or JS expectations.

Before relaxing the guard: qualify nested repeats, finite minimum/maximum and
optional empties, absent versus empty, ancestor capture rollback, equal-whole
submatch histories, repeated references, anchors/final newline, all state/node/
step/allocation boundaries, and late abort/timeout/worker replacement. Rebuild
and check strict consumers after production changes. A different agent should
stress the proposed candidate; this leaf did not delegate or substitute itself
for that later independent verification.

Unsolved: the desired policy for GNU malformed/missing reconstruction; complete
repeated/nested disambiguation; an allocation-before-work audit; the cause of
GNU mandatory-empty state sifting; broader-than-local semantics; and prototype
phase-specific cancellation. These are approval/verification blockers, not TODO
passes. No full parity, default integration, superiority, completion, or 72-hour
claim is made.

## Reproduction, preserved failed attempts, cleanup

Explicit fresh capture: `node tests/commands/expr-stress/nullable-design-review/capture.mjs UNIQUE-NAME`.
Read-only verification: `node tests/commands/expr-stress/nullable-design-review/verify.mjs`.
Optional focused native trace: `node tests/commands/expr-stress/nullable-design-review/native-followup.mjs UNIQUE-NAME`.
Capture refuses an existing output directory; focused trace refuses an existing
file. Default verification does not invoke an oracle, run a prototype, or write.
The eight verbose variant traces are losslessly stored as `.json.gz` to avoid
about 90,000 lines of repetitive JSON in the patch. `PACKING.json` binds both
compressed and decompressed hashes to `PREPACK-MANIFEST.json`, the preserved
earlier seal. Verification checks byte-exact decompression; no event, case, or
failed outcome is removed. The current seal is `manifest.json`. Packing changes
storage only, not the original captured bytes. The rejected zero-context patch
passes `git apply --check --unidiff-zero`; a plain check initially refused its
zero-context form. Neither command applies it.

Initial command failed at module parse due to an extra closing parenthesis
in `fingerprint`; no fixture, child, or output directory had been created.
`capture-first` retains a wrong local `config.h` path failure and zero-child
cleanup. `capture-second` retains the compiler's required-config-before-stdio
failure and cleanup. `capture-third` retains the first complete 22-case run.
The follow-up adds epsilon-destination instrumentation; `capture-final` adds
two named history controls and hashes the current driver recipes. Earlier
captures and outputs are unchanged; neither helper correction changes an
original fixture or expected tuple.

Final capture ran `2026-08-27T18:36:59.744Z` through
`2026-08-27T18:37:02.392Z`; this is execution time, not total work duration.
All native children use literal argv, ignored stdin, local small fixtures,
2-second kill deadlines, and bounded output; every child close is awaited.
All four worker jobs have 2-second watchdogs, 64 MiB old-generation limits,
and awaited termination. Each capture removes only its own unique OS-temp root.
Cleanup receipts report zero active owned children/workers. No other process,
staging, native temporary artifact, or owner's file was altered.

The final selected-path pre/post hashes agree. This does not detect arbitrary
new repository entries; the separate evidence manifest/verifier does detect
extra entries **within this owned evidence directory**. It is not a full
repository gate. Sources/dependencies used for native compilation are only the
enumerated authenticated inputs, not an exhaustive transitive SDK/build proof.

## Primary sources consulted via web.run

No GNU implementation is copied into product code. Interpretation derives from
these primary sources, plus the separately labeled local execution evidence.

- [G1] GNU v9.7 `src/expr.c`, `docolon`, negative capture end and no-match result:
  `https://raw.githubusercontent.com/coreutils/coreutils/v9.7/src/expr.c`
- [G2] Release-pinned gnulib `regexec.c`, reconstruction/cycle/register functions:
  `https://raw.githubusercontent.com/coreutils/gnulib/41e7b7e0d159d8ac0eb385964119f350ac9dfc3f/lib/regexec.c`
- [G3] Official GNU 9.7 release announcement, April 9, 2025, pins coreutils and
  gnulib revisions: `https://lists.gnu.org/archive/html/coreutils/2025-04/msg00025.html`
- [P1] POSIX Issue 7 XBD 9.1, whole/subpattern longest and empty participation:
  `https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap09.html`
- [P2] POSIX Issue 8 informative rationale A.9.1/A.9.3.6:
  `https://pubs.opengroup.org/onlinepubs/9799919799/xrat/V4_xbd_chap01.html`
- [P3] POSIX Issue 6 XBD 9.3.6, repeated empties/backreferences, and 9.3.8 anchors:
  `https://pubs.opengroup.org/onlinepubs/009696899/basedefs/xbd_chap09.html`
- [P4] Official historical interpretation 9945-2-135, finalized November 20, 1995;
  ambiguity discussion, not a current universal disambiguation specification:
  `https://www.open-std.org/JTC1/SC22/WG15/docs/rr/9945-2/9945-2-135.html`
- [J1] Official ECMAScript 2024, RepeatMatcher and backreference matching:
  `https://tc39.es/ecma262/2024/multipage/text-processing.html`
