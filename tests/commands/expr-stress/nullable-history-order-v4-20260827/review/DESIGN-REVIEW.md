# Independent bounded design review

Status: **DESIGN-ONLY / NOT PROMOTION**. Initial `c3e40f8b` remains guarded.
Eight controls were sealed in `a5c2aed54437f68dff5708a0e652fe1e72039c21`
before reading model code, results, or author checkpoint. This review independently
read normative `44eed610` and its reference ledger. Exact input manifest SHA256 is
`458c5c9e5def60b32d963572364998c463f3e185692f6a25ed09d6069f822589` at
`c0aec9fc240f153e0fa18d6e2d1e291871dbe1eb`.

## Accepted design boundaries

- A complete activation tree plus ordered events and a separate live environment
  preserves information final registers cannot. Uncaptured concatenation/repeat
  nodes must participate in the order. Shared immutable prefixes are compatible
  with branch-local updates; mutable env reuse is not.
- Whole-match priority, admissibility, complete-history ranking, and prefix
  dominance are distinct decisions. Exhaustively selecting among supplied valid
  histories proves only that finite selection, not regex matching completeness.
- A completed descendant's origin can belong to an earlier parent iteration.
  TEMP skip must preserve it; only that descendant's actual entry invalidates it.
  Origin bounds and current-parent containment are different checks.
- END, absent child slots, open captures, and participating empty completions
  cannot be collapsed. Required identical-position repetitions remain distinct
  local ordinals. Persistent env snapshots must retain their original meanings.
- No merging of different histories is the safe experimental starting point.
  W3 defeats final-env-only history equality. A same-pc/position reference suffix
  can distinguish different registers; comparison of finished paths cannot prove
  prefix pruning. The papers' regular-model theorems do not supply that proof.

These are independently accepted requirements, not proof that an implementation
meets them. Native plurality, frozen input counts and old 137 controls do not
select a normative order or establish current worker cleanup.

## Exact primary boundary

The publisher's Issue8 XBD 9.3.6 text explicitly rejects
`\(a\(b\)*\)*\2` on `abab`. TEMP's `[ab][a]` followed by retained `b`
accepts a supplied history. This is a deliberate project-profile conflict,
not merely ambiguity in history tie-breaking and not a standards bug.
`PRIMARY-SOURCES.json` records the independent web attempt and exact fallback
curl response hash, matching the normative source ledger. The two author-hosted
tagged-automata papers were checked only for their restricted comparison claims.
No theorem is transferred to arbitrary backreferences.

## P/aaa: eligibility is not ordering or equivalent-cycle removal

`[a][a]` plus reference `a` consumes three bytes and ends capture1 at `[1,2)`.
`[aaa][]` plus empty reference also consumes three, but changes capture1 from
`[0,3)` to `[3,3)`. Thus removing the final empty changes the continuation state.
It is not an equivalent zero-progress cycle. A named optional-postproductive-empty
admissibility rule can reject it; ranking or pc/position deduplication cannot
pretend it was the same history. Root's narrow completed `a` remains conditional
on resolving that separate policy. Required-count changes are likewise not cycles.

The author's pre-implementation `LOCAL-TAIL-HYPOTHESIS` additionally disallows
any later iteration after an admitted optional empty. This is stronger than just
excluding a final empty after productive iterations. Its generality, and any
future quotient's interaction with history ranking, remain unproved.

## Ranking decisions still need explicit resolution

Normative HNODE finishes a static node's contextual occurrences before visiting
lower-priority descendants. HTREE compares an entire earlier dynamic iteration
before a later iteration. W4 separates them without any native claim: A has outer
spans `[2,2]` with first inner empty, B has `[2,1,1]` with first inner length two;
HNODE favors A, HTREE favors B. Flattening offsets loses this distinction.

The author's AGGREGATE-v1 and ITERATION-v1 are separately named experiments, not
aliases for those normative candidates. In particular, omitting the enclosing
repeat extent can change an uncaptured prefix before any capture comparison;
preserving AST nodes alone does not preserve their priorities. Conversely,
aggregate span first can outrank a longer first body occurrence. Tests must expose
these choices rather than silently relabel all profiles as one history order.

A total order needs a fixed domain, context alignment and observationally sound
tie classes. Tree recursion supplies context alignment only for the declared
grammar and constructors. Equivalence of constructed trees does not prove correct
parser translation, arbitrary supplied-event replay, branch-choice coverage, or
capture transparency. Activation numbers must not become semantic tie breakers.

## Resource and implementation boundary

Allocation and work admission must include AST traversal, env persistence, event
retention, validation and comparison. Exhaustion after an incumbent is still a
refusal. Cancellation checks in synchronous code can observe an already-aborted
signal or a cooperative checkpoint; they cannot let an event-loop callback run
mid-computation. Logical counters are not physical memory accounting.

An independent model replay uses no actual worker and establishes no worker
admission/retirement/disposal guarantee. Historical 137 controls remain a bound
future obligation, not rerun evidence. No live engine, broad corpus, native expr,
main-thread RegExp or dependency installation is authorized by this review.

## Smallest next decision

Name and approve (or reject) the optional-empty admissibility profile separately
from the terminal order. Then settle uncaptured-prefix priority and enclosing
repeat versus chronological-body priority using only the frozen prefix, P/aaaa,
W3 and W4 witnesses. Do not choose by matching native votes. Any next source
experiment must remain an explicitly authorized isolated worker copy, keep the
live guard, preserve TEMP lifetime, and bind the future cleanup/137 obligations.
No source experiment is performed or authorized by this report. The final
`REPORT.md` records the subsequently sealed model review, exact authentication,
six failed policy assertions, five mutant kills, and remaining untested limits.
