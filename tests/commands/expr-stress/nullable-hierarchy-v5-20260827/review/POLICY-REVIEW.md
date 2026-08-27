# Independent literal-profile review, version 5

This is the independent leaf's reading of committed `44eed610` and `f561bd9f`,
not a replacement standard or selection of a general comparator. No new primary
survey or native call was needed to check the internal derivation. The freeze's
standard/paper boundaries are retained as declared qualifications, not promoted
to new independently observed native behavior or a backreference theorem.

## Exact correction to historical C1 prose

P is `cat(repeat(group1(repeat(a))),ref1)`, not a capture-only AST.
All positions below are independently derived from supplied byte plans on aaaa.

| History | Whole | Outer repeat | First body | Reference |
| --- | --- | --- | --- | --- |
| A `[aa]+aa` | `[0,4)` | `[0,2)` | `[0,2)` | `[2,4)` |
| B `[a][a][a]+a` | `[0,4)` | `[0,3)` | `[0,1)` | `[3,4)` |

The immutable HNODE prose visits semantic nodes in fixed static priority order,
and its AST mapping retains repeat nodes. HTREE explicitly visits the current
complete span before children. Both therefore decide at the outer repeat: **B**.
`e38a68af` C1 instead expects **A**, citing first-body priority and asserting both
normative candidates do so. That derivation is incompatible with the literal
all-repeat-node definitions. The old result remains 46/52 with six historical
failures; the original first adapter result remains 44/50. We neither edit those
files nor rescore them. The new literal-profile assertion deliberately expects B,
and the old A expectation remains a separately reported policy conflict.

Capture-wrapper transparency does not resolve this contradiction. In P, the
capture aliases the inner repeat, not the outer repeat whose aggregate decided
the pair. Removing only the outer aggregate changes priority. Removing every
repeat aggregate also breaks longest uncaptured prefix: after equal byte-prefix
occurrences, END prefers a shorter nonzero prefix. Changing initial absence does
not repair that latter problem. These are separate design choices.

## Independent tree/table construction

`oracle.mjs` was written and its twenty expected pair matrices calculated before
prototype inspection. It consumes only committed review ASTs/plans/subjects. It
derives spans through byte consumption and TEMP reference bindings, then uses a
direct recursive subtree order for TREE and contextual lists per semantic node
for NODE. Wrappers are removed only from ranking, never from the independent
constructor's capture lifetime. This is a small test oracle, not a bounded product
engine; its JavaScript allocations are harness work, not candidate budget evidence.

For W4, both outer extents are `[0,4)` and both first bodies `[0,2)`. NODE compares
all body occurrences first: A's second body `[2,4)` outranks B's `[2,3)`. TREE
instead enters the first body's earlier inner repeat: B's `[0,2)` outranks A's
`[0,0)`. Thus NODE A and TREE B are intentionally different. Bare and extra-wrapper
ASTs preserve this distinction. These are explicit ASTs, not parser translations.

Zero repeats have a participating empty aggregate but an absent body slot. A first
empty body outranks that absence. After an equal participating prefix, END precedes
another occurrence. The one-empty/two-empty comparison is finite-permissive; the
second body cannot be removed before comparison merely to obtain the desired rank.
Required minima are validated before ranking and cannot be waived by END priority.

## Lifetime, eligibility and theorem boundaries

P/aaa permissive `[aaa][]` changes capture1 from `[0,3)` to `[3,3)` on real reentry.
Both literal profiles prefer it over the narrow `[a][a]+a` history. This conflicts
with the fixed narrow root target, not with a newly selected general root policy.
LOCAL-TAIL-HYPOTHESIS is tested separately and remains conditional. It is not a
proved neutral-cycle exclusion, and no comparison result authorizes it generically.

D/abab's final capture1 `[2,3)` does not contain retained capture2 `[1,2)`. The
descendant's *originating* first ancestor does. Entering only the new ancestor or
skipping the child does not erase it under TEMP. Actual child entry invalidates its
completion until close. The freeze documents this TEMP witness as a deliberate
departure from its explicit Issue8 D example, not a standards bug. No lifetime
change is proposed. Regular-language proof claims do not settle this backreference
model's pruning, cycles or completeness.

## Bounded evidence interpretation

Independent review input derivation validates 31 supplied plans in 17 AST/subject
cases, organized into eight groups: 26 reused plans and five new finite histories.
An additional independent derivation checks the freezer's 36 histories, including
every declared completion and reference origin. These are input-integrity checks,
not candidate execution counts, complete parse forests or native observations.

Candidate tests must check derived trees against exact raw AST paths, structural
parents/ordinals, enter/exit stacks, immutable branch-local snapshots and reference
origins. Rejecting a forged operand by ownership is narrower than validating an
arbitrary external event log. A new same-plan reconstruction may establish rank
equivalence; it does not validate an unsupported external activation-ID rewrite.

No actual worker is created. Logical meter checks cannot establish physical RSS,
async preemption, resource retirement or cleanup. Historical137 remains a future
actual-worker obligation. The initial c3 guard and all live/public code stay outside
this review's write and execution scope. Exact profile agreement, even if observed,
would leave the policy boundary provisional and would not authorize promotion.
