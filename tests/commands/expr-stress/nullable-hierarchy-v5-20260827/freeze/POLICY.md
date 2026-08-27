# Fully stated finite hierarchy proposals and the unresolved boundary

## 1. Domain, static mapping and capture aliases

These are proposed **terminal-only** orders on the finite supplied histories in
`INPUTS.json`, not an accepted POSIX comparator or an engine. Grammar is exactly
`byte`, ordered n-ary `cat`, `repeat(min,max,body)`, `group(number,body)`, `ref`.
`null` max denotes unbounded syntax, not permission for unbounded enumeration.
No alternation, unsupported syntax, normalization or implicit synthetic concat.
The full AST for each pattern is fixed in data. A singleton group body is not
wrapped in a new concat; explicit concats are not reassociated or flattened.

Raw node identity is its ordered child path: root `r`, first child `r.0`, etc.
For repeat/group, the body is child 0; for cat the listed children are 0..N-1.
Opcode parameters (min/max/group number/byte) are not child positions. Capture
wrappers remain explicit raw nodes for open/close events. For ranking only, a
pure group aliases its immediate body's semantic node, recursively through any
group chain. It contributes no duplicate priority slot; all wrapper annotations
and their ordered lifetime events survive. `captureAliases` gives every alias
for every frozen AST. No alias merges an outer repeat with its body.

In particular, P is `cat(repeat(group1(repeat(a))), ref1)`. These are distinct:

1. outer repeat aggregate node `r.0`, one extent per activation;
2. its chronological body list, occurrences of semantic `r.0.0.0`;
3. capture wrapper `r.0.0`, aliasing the inner repeat for rank, not aliasing
   the outer repeat and not replacing its history with a final capture.

This explicit alias choice is permitted by the old prose, not independently
proved parser equivalence. No change to the live parser is made. Source-syntax
mapping, byte-profile coverage and public projection still need real validation.

## 2. Finite construction and full environment expectations

Each history starts at byte 0 in its ASCII subject. A byte consumes exactly one
matching byte; cat evaluates children left to right; group opens, evaluates body,
then closes; repeat evaluates its listed body plans in chronological order.
An integer plan is allowed only for a repeat with a byte body and abbreviates
that many `null` byte plans. Other repeats use arrays of body plans. A group plan
is its body plan; byte/ref use null. This construction determines every node's
half-open byte span; no hidden offset choices are available. The result may be
a valid anchored prefix shorter than the subject. Whole-longest comes first.

Every occurrence has its raw static path, parent occurrence, child slot and local
repeat ordinal. Structural occurrence addresses use paths and enclosing ordinal
vectors, not allocation IDs. Repeated child contexts restart ordinals at zero.
Concats and repeats have aggregate `[entry,exit)` spans even when empty. A repeat
with zero bodies has a participating empty aggregate and an **Absent body slot**;
it does not create an empty completed body. After one or more bodies, termination
is **END**, not Absent. Skips propagate structural absence without creating opens.

`captureCompletions[group]` lists every successful completion span in chronological
order, including repeated equal empties. An empty list means initial/final Absent;
otherwise final semantic env is Completed-empty/nonempty at the last listed span,
with origin that group's corresponding completion index. Every actual group entry
replaces only that group with Open(start, occurrence) before child work. No old
completion is readable while open. Closing supplies its listed span and origin.
Other registers persist across ancestor entry and skipped child slots. Initial
env includes every numbered group in the AST as Absent. This rule plus the plan
and complete completion lists specifies all intermediate environments, not just
final output. No retained span need fit inside a later ancestor occurrence; it
must fit its actual originating parent and the subject.

`refs` gives every successful reference in encounter order: group, zero-based
completion index read, and consumed span. The referenced origin bytes must equal
the consumed bytes. Absent/Open references refuse; they never fabricate empty.
Backreference content checks, all origin/span bounds and minimum/maximum counts
precede ranking. Failed construction cannot alter a sibling. All supplied
histories are structurally valid under the finite permissive alternative;
separately listed negative controls are not accepting histories.

## 3. Separate eligibility alternatives

**FINITE-PERMISSIVE** admits exactly the finite, structurally valid supplied
histories, including their optional empty occurrences. It is a comparison domain,
not a claim that all real regex paths can be enumerated or that every optional
empty complies with a standard. It does not truncate a search and publish a
partial winner. An actual engine cannot infer completeness from this list.

**LOCAL-TAIL-HYPOTHESIS** additionally processes each repeat activation locally:
an iteration is required while its zero-based ordinal is less than that frame's
minimum. Required empties are admitted, even after progress, and discharge only
that activation's count. An optional empty is admitted only if that activation
has not consumed bytes and has not previously admitted an optional empty. Once
an optional empty is admitted, no later iteration of that activation is admitted.
Required empty occurrences do not themselves set the optional-empty marker.
All listed witnesses pass except the explicitly named optional tails and the
second optional empty in G06. Fresh child activations start fresh counters.

This is the unchanged named v4 hypothesis, NOT a universal root/POSIX rule and
NOT a proved cycle quotient. P/aaa `[aaa][]` changes capture1 from `[0,3)` to
`[3,3)`; removing the tail changes the continuation environment. Even identical
pc/position/env would not prove rank-neutral continuation. No cycle or prefix
pruning is authorized. Root's narrow `a` is fixed independently of this hypothesis.

## 4. Shared comparison atoms

Compare only complete, validated histories for the same fixed AST and subject.
First prefer smaller whole start, then greater whole end. For a participating
semantic occurrence, compare smaller start, then greater end. All examples are
ASCII byte spans; no locale/collation inference. Open is not a terminal operand.

For a repeat body's contextual list, first distinguish zero from participation:
any participating first occurrence, including empty, precedes initial Absent.
Then compare corresponding occurrences in order under the policy below. If an
identical nonempty list prefix is exhausted on one side, prefer END to any further
occurrence, including empty. This terminal preference applies **only after at
least one participating occurrence**, never between [] and [empty]. The same
rule ranks admissible histories only; it cannot waive required counts.

Two equivalent histories have the same normalized occurrence structure, spans,
capture annotation events and reference origins modulo allocation-ID renaming.
They are a tie, not encounter-order selection. Different allocation IDs, object
identity or DFS rank are not semantic tie-breakers. No choices exist in this
frozen grammar. If rank equality ever hides different semantic env/ref/output,
refuse the unresolved tie rather than add a post-hoc fallback. Consequently the
proposals are finite total preorders on the declared validated/projection-neutral
domain, not an arbitrary external-log validation theorem.

## 5. HNODE-AGG-v5: literal static hierarchy

Traverse semantic AST nodes in parent-before-child, left-before-right preorder,
skipping only aliased group wrappers. Each node contributes its entire contextual
occurrence table before the next static node. Contexts are paired by enclosing
structural occurrence addresses; contexts themselves are visited in structural
chronological order. Within each context compare completed occurrences by the
shared atoms and repeat-list initial-Absent/END rule. A skipped parent propagates
Absent descendants, not its retained register. Prior parent tables settle any
different parent cardinality/bounds before descendant contexts need pairing.

At a repeat aggregate node compare the **complete activation extent first**.
At its body semantic node compare the entire chronological body occurrence list
before any lower-priority descendant node. Descendants of different iterations
are therefore not interleaved ahead of later body extents. Equal tables advance
to the next static column; all equal columns form the validated tie above.

This instantiates the all-semantic-node HNODE reading of `44eed610`; it is not
claimed equivalent to either paper's indexed/tagged order. W4 prefers A. It does
not make C1's body more important than its enclosing repeat aggregate.

## 6. HTREE-AGG-v5: literal dynamic hierarchy

Recursively compare each current semantic occurrence's participation and full
span before children. Cat compares ordered child subtrees. Group aliases its
body for ranking. Repeat compares its aggregate span, then its body list using
the shared initial-Absent/END rule; each corresponding body comparison recursively
finishes the **entire earlier iteration subtree** before moving to the next.
Byte/ref have no children. Structurally equal operands form the validated tie.

This instantiates the HTREE reading, not old AGGREGATE-v1's unconditional
shorter-list rule. W4 prefers B. Both hierarchy variants preserve uncaptured
repeat aggregates before later capture subtrees. Neither is a first-DFS policy.

## 7. Minimal contradiction, not a relabelled successful comparator

G01 supplies P/aaaa A=`[aa]+aa`, B=`[a][a][a]+a`. Whole `[0,4)` ties.
Outer repeat spans `[0,2)` versus `[0,3)` do not tie. Both literal hierarchy
definitions stop there and prefer B. C1's expected A requires body length2>1
to outrank this earlier aggregate. These two requirements are incompatible for
this exact AST; changing whether a pure capture wrapper aliases its body cannot
remove the outer repeat. This corrects a **design derivation**, not old data.

Dropping every repeat aggregate is not a reconciliation. In G03, byte-body lists
for prefix lengths3 and2 have two identical occurrences, then END versus a third
productive byte. Old END priority prefers length2. Initial Absent corrected to
lose would still not recover length3. Length0 winning in old ITERATION-v1 also
involved its unconditional END preference; fixing only zero/empty is insufficient.
Thus three independent choices must be stated: aggregate versus body priority,
static versus dynamic descent, and initial-Absent versus postparticipation END.

A corrected body-first DESIGN could change END/aggregate placement, or distinguish
operator classes under an explicit syntax-wide rule with a preservation proof.
None is adopted or smuggled into this freeze. Input-specific P/prefix exceptions
are prohibited. The exact unresolved decision is whether to revise C1's priority
requirement or authorize a different comparator/AST priority mapping, followed by
new pre-code predictions. Do not tell a prototype author that these two variants
resolve all six old discrepancies. They intentionally retain one contradiction.

P/aaa adds a separate blocker: both variants prefer the capture-changing tail
under FINITE-PERMISSIVE, contrary to fixed root `a`; under LOCAL-TAIL-HYPOTHESIS
the tail is ineligible and the supplied narrow history wins. This is not proof
that the hypothesis is a generally accepted or sufficient engine policy.

## 8. Mandatory resource obligations, no implementation here

`LIMITS.json` binds unchanged v4 caps and product protocol inputs. Admission must
precede initial states, AST traversal/representations, forks, repeat frames,
events, retained histories, environment maps, context tables, comparison keys,
reference-byte comparisons and output projection. Charge cumulative allocation
and work as well as live states/depth; shared prefixes do not make new edges free.
Bound comparisons, recursive depth and event counts before allocation/descent.
No pc/position/final-env merge, no uncharged materialization to compute charges.

Required controls reuse G01/G02/G08 operands: zero initial work/allocation/state
allowance; just-insufficient AST/depth/event/state/comparison admission; and
exhaustion/cancellation after one accepted incumbent while constructing or ranking
remaining operands. Every such run must refuse/error, never publish best-so-far.
Test all encounter permutations and reflexivity/sign symmetry/transitivity only
as future bounded checks; no counts are claimed here. Reconstructed or renamed
activation IDs must not change ranks. Malformed spans, wrong parent/ordinal,
missing required empties and unreadable references must refuse before comparison.

An eventual separately authorized worker must synchronously register cleanup
before acquisition/admission, close admission, propagate cancellation reasons,
share idempotent cleanup, await tracked cooperative work and retirement/dispose.
Do not transfer synchronous model checks to async latency, RSS or opaque-host
preemption. Historical137 is binding context for that future worker, not a run.
Keep the live guard and existing caps; insufficient evidence means safe refusal.
