# Complete history ordering: bounded design, not promotion

2026-08-27. Delegated primary-source leaf; documentation/evidence only.
Read `8897ece39c730812b74164377180b90d6cd02444` independent REPORT and
`b6eaa23a8a864c456fecef844de330bb5f10d011` minimal-counterexample REPORT first.
The initial expr integration identified by the assignment is
`c3e40f8bd721da5e496f3b3abfd51aee45db5a84`; this is not a newly frozen candidate.
No engine, native oracle, corpus, quota suite, build or old verifier was executed.
No live source, old evidence, canonical test, initial safe-refusal guard or
package configuration was edited. No runtime/private dependency was introduced.

## Decision and authority boundaries

The supported next step is **complete, branch-local histories plus terminal-only
selection over all admitted valid histories**, not first DFS and not final-capture
sorting. Preserve uncaptured structure. A named ranking and a named admissibility
profile are separate requirements; recording more information does not itself
resolve ordering. This report supplies two concrete terminal ranking candidates,
but does not adopt either for the public product.

**Important explicit conflict:** Issue 8 XBD 9.3.6 includes the example
`\(a\(b\)*\)*\2` failing on `abab`. Root's TEMP retained-descendant policy admits
`[ab][a]` followed by retained `b`. This is a project-profile departure from that
explicit example, not merely a gap in historical tie-breaking. Do not silently
replace TEMP with ancestor-entry clearing, and do not claim universal POSIX
semantics for TEMP. A descendant's old span can remain within an earlier ancestor
occurrence while lying outside the final ancestor occurrence. [N8; prior D row]

Keep root's narrow P/`aaa` completed capture `a`; its existing derivation is not
repeated here. Preserve GNU's empty discrepancy without calling it an
upstream-confirmed bug. General repeated-history ordering remains unaccepted.

The five-source evidence ledger is `REFERENCES.md`; exact URL, access timestamp,
response-body SHA256 and source class are in `SOURCES.json`.

| Authority class | What it supports here | What it does not establish |
| --- | --- | --- |
| Modern normative N8 | Whole/subpattern priorities, empty versus absent, repeated-reference and empty-repetition constraints | A fully specified executable comparator for every project extension |
| Historical H43/H135 | Real competing interpretations and acknowledged 1993 wording problems | Permission to override an explicit 2024 requirement; adoption of a requester's proposed algorithm |
| Paper-defined T17/BT19 | Regular-language tagged/parse-tree models, structural priority and conditional pruning arguments | Backreference validity, TEMP descendant lifetime, or this project's cycle quotient |
| Root TEMP | Required local empties, retained completion until actual reentry, bounded safe execution | A standards-body interpretation or GNU-wide compatibility |
| Prior native observations | Exact recorded GNU9.7/Darwin and Apple/libc outcomes | Universal GNU/Linux behavior, invented capture offsets or new candidate acceptance |

## 1. Lossless representation before optimization

This section is a proposed project design, not a transcription of either paper.

### Static structure

Keep an ordered semantic AST with stable node identities for **every** literal,
bracket/character atom, assertion, backreference, concatenation, choice if already
supported, and quantifier. Capture numbers are annotations pointing to semantic
nodes, not the priority list. Record every uncaptured prefix and every containing
concatenation/repetition node. Do not add an unsupported alternation syntax just
to implement this representation.

Fix the parse shape before ranking: preserve source grouping and the parser's
declared associativity; do not silently flatten, reassociate, factor alternatives,
duplicate capture identities when expanding counts, or insert priority-bearing
groups. Pure capture wrappers may alias the same semantic node, with all capture
annotations preserved. Any changed shape needs an order-preservation proof.
Use parent-before-child, left-before-right static numbering as the proposed
baseline. This is richer than parentheses numbering; T17 and BT19 motivate the
distinction, but do not authenticate this project's parser mapping.

### Dynamic structure

A branch carries the tuple:

```text
control location, input position, match start,
immutable history tail, activation stack, repeat frames,
live capture environment, branch-local cycle evidence
```

A history event identifies its static node, dynamic activation, parent
activation, child slot, enclosing repeat activation and iteration ordinal.
Record `enter(position)`, `complete(start,end)`, `skip(context)`, repeat
entry/iteration/exit, and choice identity. A backreference event also identifies
the particular completed capture occurrence it read and its consumed span.
Record semantic positions and byte boundaries separately where necessary.

Dynamic identities are branch-local labels, never ranking keys. Normalize them
to structural addresses: ordered child slots and repeat ordinals along ancestry.
Preserve event order even when every offset is equal. Separate lists of offsets
without parent/iteration boundaries cannot reconstruct the same information.
Skipped subtrees can be represented by one immutable structural absence marker
with a lossless lazy expansion, not a fabricated completed-empty event.

Every node occurrence has one of these states:

| State | Meaning | Readable by a backreference? |
| --- | --- | --- |
| Absent | No participating occurrence in this structural slot | No |
| Open(start, activation) | Entered but not completed | No |
| Completed(start=end) | Participating empty occurrence | Yes, as empty |
| Completed(start<end) | Participating nonempty occurrence | Yes |

`END-OF-LIST` is a structural marker, **not** any of these states. In particular,
ending an iteration sequence differs from skipping a child in an existing
iteration. Open states may exist in the frontier but never as published captures
or completed-history ranking operands. A failed branch's opens do not mutate
its sibling. Fork mutable frames/maps or use persistent structures; share only
immutable prefixes. Retained byte fragments must obey the repository ownership
contract; a bounded immutable subject permits validated offset references.

### TEMP capture lifetime, independently of structural absence

On actual entry to capture group G, invalidate its previous completion and set
G to Open. On successful close, install the new completed occurrence. A skipped
G does not reenter it, so TEMP preserves its older completed register. Entering
an ancestor is not entering G. The history still records G's absence in that
ancestor iteration. Never overwrite an absence marker with the old span simply
because the live register survives; never infer live-register clearing from
an absence marker. If entry fails, that branch fails; a sibling retains its own
state. Replaying the event log must reconstruct the live environment exactly.

Validate a retained span against its **originating** completed occurrence and
subject, not by inventing containment in the final ancestor. This preserves
TEMP honestly while exposing the N8 conflict already identified.

## 2. Admissibility precedes ranking

An accepted history must satisfy syntax, actual input comparisons, assertions,
backreference reads, all count bounds and the chosen nullable policy. A ranking
cannot rehabilitate a history containing an invalid reference or gratuitous
iteration forbidden by that policy.

Each repeat frame needs static repeat identity, dynamic activation, parent
iteration, iteration start, ordinal, remaining minimum, remaining finite maximum
if any, and local progress/nullable state. A required zero-width occurrence
advances a finite required count even without consuming input. Productive work
in a parent or sibling must not suppress a required or empty-only match of a
fresh child activation. Optional empty-tail suppression is a named TEMP
admissibility decision, not a side effect of whichever traversal happens first.

**Cycle equivalence needs both behavior and ranking neutrality.** A
zero-progress route may change Open/Completed/Absent state, a backreference
binding, minimum/maximum counters or a history priority. Therefore `(pc,pos)`
alone is insufficient. Fresh numeric activation IDs also cannot be the only
cycle key: unbounded fresh IDs would conceal equivalent cycles.

Required-count changes are not equivalent cycles. A repeat-body route that
changes the live environment must be explored or explicitly refused on budget,
not discarded as an empty loop. After alpha-normalizing activation names, a
candidate cycle key must preserve every continuation-relevant frame and binding;
removing the cycle must additionally preserve or improve the final ranking for
every accepted continuation. Identical control/environment is necessary, not
sufficient, when histories remain observably different. Initially suppress only
structurally proved redundant cycles and explicitly disallowed optional tails.
If the remaining search cannot be completed within budget, return the existing
resource error. No silent success or guessed cycle equivalence is licensed.

## 3. Two explicit complete-history ranking possibilities

Both proposals below first compare whole matches: earliest start, then greatest
matched length. Expr's anchor fixes the start. All theoretical examples here are
ASCII, so byte length equals character length. A byte-only ranking must not be
advertised as general locale/collation semantics without the required mapping.

### HNODE: static-node-major, activation-delimited histories

This is the recommended **design candidate to specify and independently check**,
not an accepted POSIX implementation. For a fixed AST and complete valid history:

1. Visit semantic nodes in the fixed static priority order. For each node,
   obtain its occurrence histories, partitioned by enclosing dynamic parent
   contexts in structural order. Preserve absent slots and boundaries.
2. In corresponding contexts, compare occurrences from first to last. A
   participating occurrence outranks Absent. For two completed occurrences,
   prefer earlier start, then later end. Equal ancestor boundaries normally fix
   the relevant start; the explicit tie rule makes the proposal unambiguous.
3. Zero iterations have an Absent body slot, not an empty completed body.
   Hence one legal completed-empty body beats zero iterations when reached by
   comparison. After at least one identical participating occurrence, if one
   list ends and the other continues, prefer the ended list. An extra required
   occurrence cannot be removed from the admissible set; this rule ranks only
   histories already satisfying counts. Never substitute Absent for END here.
4. Finish all occurrences/contexts of this static node before moving to its
   descendant or right sibling. Earlier parent histories determine alignment:
   if their span/participation/list lengths differ, comparison already stopped.
   If equal, parent structural addresses pair the child contexts. A skipped
   parent propagates structural absence, not the live register's value.
5. If all semantic occurrence tables agree, compare normalized choice/event
   encodings in a declared fixed lexical order for reproducibility only. Remove
   allocation IDs and administrative events. Prove that this last tie cannot
   change any published capture/backreference observation; otherwise it is a
   new semantic choice requiring explicit approval, not an incidental fallback.

This puts the complete iteration sequence of a repeat body ahead of lower
static-priority descendants. It is deliberately more specific than “longest
capture history.” Alignment and rank-preserving AST translation are obligations,
not assumed consequences of using tags. T17's exact subhistory comparator and
BT19's exact indexed-tree comparison are alternative formal targets for a
backreference-free subset; HNODE is **not asserted equivalent** to either.

For finite complete tables, the rule is a lexical order over fixed-priority
columns and ordered contextual tries. Each comparison either finds a differing
atom or consumes a finite list. The END rule is a fixed terminal preference at
a trie depth, so it does not depend on encounter order. This explains
termination and how to obtain a total tie-break, but does not prove preservation
under future extension, correct context alignment in an implementation, or
agreement with POSIX. Required-count admissibility stays outside this argument.

### HTREE: dynamic-occurrence-major recursive ordering

Use the same history and admissibility. Compare the current node's participation
and complete span, then its children left to right. For a repeat, compare the
**entire first iteration subtree**, then the second, and so on, using the same
zero-iteration/END rule. Use the same normalized tie handling.

This is another complete terminal order, not DFS scheduling: every candidate
is compared after matching. It differs from HNODE because a descendant of an
earlier iteration can outrank the root span of a later iteration. Calling both
“left-to-right history order” hides this decision. W4 distinguishes them.
Do not select one based on which happens to fit already observed GNU rows.

## 4. Small theoretical witnesses; no new native expectations

These are hand-derived candidate histories and proof obligations, not execution
results or a new corpus. Literal patterns below use BRE notation. No GNU/Apple
outcome is inferred for any new example.

### W1: uncaptured quantified prefix is a priority-bearing node

Pattern `a*\(a*\)`, subject `aa`, whole `[0,2)`:

| Candidate | Uncaptured prefix | Capture 1 |
| --- | --- | --- |
| U | `[0,2)` | completed empty `[2,2)` |
| V | `[0,0)` | `[0,2)` |

Under either proposed structural order, U wins at the left uncaptured repeat.
Sorting only the final capture length instead chooses V. Thus this single
structural witness already defeats capture-only ranking without invoking a
repeated captured group, native behavior or the old P/`aaa` case. [Design
application of N8's subpattern wording; not a conformance ruling.]

### W2: same control position, different feasible backreference suffix

Pattern `\(a*\)a*\1`, subject `aaa`. Just before `\1` at position 2:

- A captured `[0,2)` as `aa`; the uncaptured repeat consumed empty.
- B captured `[0,1)` as `a`; the uncaptured repeat consumed `[1,2)`.

Both can reach that same control location and position. The remaining input
is `a`: A's reference cannot consume its two-byte value, while B's can consume
one byte and finish at 3. Discarding B because A has the longer current capture
loses this accepting continuation. This is a local pruning counterexample;
other accepting branches need not be absent for the loss to be real.

Similarly, `\(a*\)\(a*\)a*\2` with first capture fixed empty has such competing
states for group 2. Equality of the **reported first capture** is not equality
of the reference environment. Even equality of the entire live capture map
would not establish equality of repeat obligations or history ranking.

### W3: identical final capture, different full histories

Pattern `\(a*\)*`, subject `aaaa`, consider productive partitions
`[aaa][a]` and `[aa][a][a]`. Both end with capture `[3,4)` and whole `[0,4)`.
The first body occurrence spans 3 versus 2 characters. Both proposed orders
prefer the first of these two histories; a final-register vector ties them.
This is a pairwise information-loss witness, **not** a claim that either is
the globally selected history: `[aaaa]` is another admissible competitor.

### W4: static-node priority versus dynamic-tree priority

Pattern `\(\(a*\)a*\)*`, subject `aaaa`, compare these two histories:

- A outer iterations `[aa][aa]`; first inner capture empty and first uncaptured
  suffix `aa`; second inner capture `aa` and suffix empty.
- B outer iterations `[aa][a][a]`; inner capture consumes each entire iteration,
  each uncaptured suffix empty.

The first outer iteration spans 2 in both. HNODE compares the remaining outer
body occurrences first: A's second spans 2, B's spans 1, so A wins. HTREE compares
the first iteration's inner capture before the next outer iteration: B wins
with 2 versus 0. These are legal local empty atom repetitions, not gratuitous
empty outer iterations. Other whole-length-four competitors exist; this
distinguishes pair ordering, not the ultimate expr output.

### W5: mandatory empties, structural context and register lifecycle

Pattern `\(a*\)\{2\}` on empty requires two completed `[0,0)` occurrences.
They are different iteration ordinals even with identical offsets. A global
position-visited rule would erase the required second occurrence. Nested form
`\(\(a*\)\{2\}\)\{2\}` requires two distinct inner repeat activations with
two required body occurrences each. Flattening equal offsets loses this proof.

Lifecycle trace, not an additional native claim: after G completes `b`, a
skipped G retains that register under TEMP; entering G instead makes it Open
and unreadable; completing at equal endpoints installs empty rather than `b`.
A sibling branch continues with its own original completion. These transitions
distinguish retained, absent-in-context, open and newly completed empty states.

## 5. Prefix extension and dominance: what must actually be proved

The papers' relevant restrictions are recorded in REFERENCES. Do not convert
their common-path-suffix statements into an unconditional assertion about this
matcher. With backreferences, a control edge can be enabled in one environment
and disabled in another, as W2 demonstrates.

For a proposed pruning relation A dominates B, require:

1. **Continuation coverage:** every accepted continuation from B has an accepted
   counterpart from A with at least as good a whole match. Prove equality or a
   suitable inclusion of continuation languages using all live bindings,
   open state, assertions and repetition obligations. Equal pc/position does
   not prove this. Equal capture bytes alone also lose origin/history information.
2. **Order preservation:** for every such continuation, A's resulting complete
   history is no worse. An ordering of prefixes is not itself this proof.
3. **Effect preservation:** the counterpart yields the required published
   completed capture and validated backreference reads, with no stale reentry.
4. **Cycle and resource compatibility:** the quotient removes no required
   iteration or semantically distinct empty path; all proof/comparison work
   stays charged. A hash hit requires collision-safe structural confirmation.

Ordinary lexical list order is not automatically right-extension-stable. As an
algebra-only witness, maximize entries and prefer the shorter strict prefix:
`[2]` beats `[2,3]`, but appending `[1]` gives `[2,1]` losing to `[2,3,1]`.
These are arbitrary length lists, **not claimed realizable competing paths**
at the same parser state. Exactly that realizability/alignment restriction is
what a valid pruning proof must supply. Neither HNODE nor HTREE receives such
a theorem in this report.

**Minimal safe baseline:** no dominance pruning between distinct histories.
Enumerate admitted paths fairly within existing budgets; reject invalid paths;
compare complete acceptances only. An incumbent can be stored internally, but
publish it only after exhaustive frontier completion or a separately proved
global bound. This proves selection among the fully enumerated admissible
histories by induction over comparisons, not completeness of an unproved cycle
quotient or termination of unbounded nullable enumeration. If a quotient is
unproved or enumeration is too costly, preserve safe refusal rather than promote
a partial answer. Identical full configurations/histories may be shared without
asserting dominance between distinct histories.

## 6. Resource/lifecycle requirements remain mandatory

Admission precedes initial states, forks, frames, history events, persistent-map
nodes, cached comparison keys and output/projection allocations. Charge
cumulative allocation as well as live storage; sharing does not make new edges
free. Charge AST traversal, event replay, comparing spans, reference byte
comparison, cycle-key work and history comparisons. Logical units are not RSS.

Check cancellation during enumeration and every potentially long replay or
comparison, not only between input bytes. Preserve worker retirement, awaited
close/dispose and cooperative cleanup. No opaque-host preemption claim follows.
Exhaustion or cancellation is an error even after a provisional successful
candidate; never publish best-so-far bytes. Publish only ordered in-range
completed spans, distinguish no match from successful empty, and retain the
initial safe-refusal guard until a separately authorized verified implementation
replaces its scope.

## 7. Unresolved decisions and required acceptance evidence

- Select HNODE, HTREE, or an exact paper-defined comparator with an explicit
  AST mapping; W4 prevents disguising this as an implementation detail.
- Authenticate parser associativity, capture-wrapper transparency and treatment
  of uncaptured prefixes; no capture-elision optimization before proof.
- Specify the exact activation-local empty admissibility/cycle quotient. Prove
  its interaction with retained descendants and required counts; do not merge
  this with the final ordering question.
- Retain TEMP as a named non-universal profile or explicitly authorize a
  separate standards-oriented lifetime profile. The N8 D example is a known
  boundary; this leaf does not change root's choice.
- Prove table-context alignment, comparator antisymmetry/transitivity,
  deterministic tie handling, and projection agreement with replayed registers.
  Prove any future prefix pruning separately, including W2's differing suffixes.
- Freeze new inputs and candidate sources through their assigned owners, then
  independently verify accepted spans, full history decisions and failure
  controls. This document supplies neither a runtime gate nor new native data.

Prior valid controls remain requirements: whole-longest before submatches;
anchoring and first-capture command projection; absent versus completed-empty;
required/local empty iterations; actual reentry invalidation and TEMP skipped
descendant retention; branch isolation; valid byte spans and empty/no-match
distinction; exact GNU discrepancy preservation; cumulative allocation/work
refusal including comparison work; cancellation, worker retirement and awaited
close/dispose; and all previously accepted public integration/encounter-order
controls. Historical pass counts are not current acceptance counts.

The old b6eaa23a table remains read-only: it reports GNU9.7-on-Darwin and Apple
tuples separately and does not expose native expr offsets. Its D/`abaab` GNU
`a` versus Apple empty observation cannot identify Apple's internal algorithm.
The earlier independent libc helper is not a second proven independent Apple
engine. No old tuple or denominator is replaced, and no new GNU/Apple result is
guessed for W1-W5.

## Scope and verification receipt

`MANIFEST.json` binds the prior REPORT inputs, reference metadata, this report,
reference summaries and the exact early checkpoint contents. Only this new
`normative/` subtree is committed. The user-requested checkpoint at
`/tmp/expr-history-normative-v4-20260827-checkpoint.txt` is the sole authorized
out-of-repository write. Its committed copy is evidence, not a runtime input.

Validation is document-only: JSON parsing, bound-file SHA256/byte checks,
complete owned entry inventory (including new files/directories and symlinks),
prior REPORT Git-blob equality, and scoped whitespace checking. No TypeScript
was added under discovery. No engine/native child, worker or server was started;
source fetches settled and verification/commit commands were awaited. This
does not establish an append-proof audit of the whole concurrent repository.
