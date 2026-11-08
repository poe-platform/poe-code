# Completed histories: pre-implementation design freeze

This is a hand-authored-history model proposal, not a regex engine, native oracle,
new acceptance corpus, production patch, or general POSIX rule. Ten inputs are
selected from independent32, authenticated at c0aec9fc. The accompanying data
fixes exact ASTs, finite choice plans, derived expected byte spans, policy labels
and controls **before model implementation**. AST identity includes every ordered
concat and repeat node. No final-register sort or first-DFS selection is proposed.

Representation: immutable AST; branch-local immutable activation tree and enter,
exit, skip events; parent activation identity, chronological repeat ordinal, byte
boundaries. Separate live env states are absent/open/completed-empty/completed-
nonempty. Opening only that group clears its completion; skipping a descendant
does not. Completed history cannot be inferred from the final env. A skip names
the unentered child slot and does not manufacture a descendant activation.

Compare complete valid accepted histories: whole start ascending/end descending,
then structural preorder with earlier children before later children. AGGREGATE-v1
compares each node's total extent before its children. ITERATION-v1 omits repeat
aggregate extent and compares its chronological body activations instead. Equal
iteration prefixes prefer termination; this is an explicit provisional decision,
not the assertion that an absent subexpression outranks an empty participating
one. Unentered slots and completed-empty activations stay distinguishable.
Both policies preserve uncaptured prefixes; P/aaaa is their minimal already-frozen
positive-final-capture disagreement. Neither is selected as the general winner.
Structurally identical histories are an equivalence class; enumeration order is
not a semantic tie-breaker. No partial-state dominance or merge is licensed.

Eligibility is a separate unresolved obligation. The historical activation-local
optional-tail suppression is stronger than equivalent-cycle elimination. In
P/aaa, `[aaa][]` changes the live capture, so cannot be dropped as an identical
environment cycle. Both proposed length-led policies prefer that tail if admitted,
contradicting the root's narrow completed `a`. The model must show this under an
explicit permissive switch as well as test the historical LOCAL-TAIL-HYPOTHESIS;
it must not hide the conflict or turn the hypothesis into a universal rule.
Required empties and child-local progress cannot be removed by that hypothesis.

Issue8's explicit D/abab failure conflicts with the retained-descendant project
profile. The supplied retained-b history is therefore a **deliberate project
departure**, not a POSIX success. Primary leaf's final report will supply precise
source qualifications. Regular/backreference-free path-order theorems do not
prove this comparator, lifetime, cycle quotient or continuation equivalence.

Every model allocation and work operation must use deterministic admission units,
including AST compilation, validation, events, env snapshots and comparison.
Exhaustion throws/refuses, never returns a current incumbent. Fixed input,
candidate, node, depth and event limits supplement cumulative work/allocation.
Abstract allocation units are not RSS. Cancellation reasons retain identity.
No worker/RegExp/native matcher is needed; actual worker admission/cleanup and
protocol137 remain future obligations, not newly passed controls.

Stop condition: policy disagreements and eligibility conflict remain documented.
Do not tailor a comparator to native votes or claim that finite histories exhaust
the parse forest. Smallest eventual implementation experiment is a separately
authorized copy of bre-worker only, after policy and termination decisions.
