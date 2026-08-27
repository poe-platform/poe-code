# v5 implementation delta: two frozen hierarchy variants only

The freeze receipt and all nine Git blobs at `f561bd9f` were authenticated at
2026-08-27T22:47:45.775Z before copying or writing prototype code. See
`AUTHENTICATION.data`. `inherited-model.mjs` is byte-identical to the v4 model
SHA256 `f04c98a52967f904266660607b0ee2157518cf50d3da260a4aa2b47926c392a0`.
`model.mjs` is the entire additive implementation delta, not a worker copy.

## Representation

The inherited constructor derives all spans and retains complete immutable raw
trees, enter/exit/skip events and branch-local capture environments. A successful
v5 build additionally prepares a group-transparent semantic tree, a static-node
preorder and context-delimited occurrence tables. Explicit concats and every
repeat aggregate remain. Group aliases are ranking-only; raw lifetimes survive.
Each table row retains its semantic parent and ordered body occurrences. Missing
parents contribute no descendant activation; a zero-body repeat contributes an
empty body context. Structural traversal order aligns corresponding contexts;
allocation IDs never order contexts. Earlier parent columns must settle different
cardinalities before descendant comparison, otherwise comparison refuses.

HNODE-AGG-v5 finishes every contextual occurrence of one static column before
the next column. HTREE-AGG-v5 finishes an earlier dynamic subtree before a later
iteration. Both compare aggregate start ascending/end descending, distinguish
initial Absent from END, and retain the frozen C1 conflict. This is explicitly
not v4 AGGREGATE-v1 or ITERATION-v1 relabeled as unchanged semantics.

Ties require identical normalized complete raw traces, including all capture
environment states and reference origins. Activation names map to chronological
enter indices solely for alpha-neutral equality, never as ordering fallbacks.
An unresolved projection tie refuses. Arbitrary external histories are not
validated: only constructor-owned, fully prepared histories are operands.

## Eligibility and caps

`build(plan, eligibility)` requires the explicit string FINITE-PERMISSIVE or
LOCAL-TAIL-HYPOTHESIS. The latter delegates unchanged to the inherited local
rule; the former disables that hypothesis without adding pruning. No early
pc/position/environment merge or equivalent-cycle claim is introduced.

All model envelopes remain exactly v4: one million cumulative logical work and
allocation units, depth24/events2048/candidates32/input32 ASCII/nodes64/arity16/
capture-number16/repetition32. v5 explicitly rejects raised work/allocation caps,
which the old generic Meter did not reject. The separate harness retains its
old fifty-million ceiling; it cannot enlarge an individual model envelope.

Static/raw tables reserve at most64 slots. Dynamic arrays use `Meter.array`,
records use `Meter.record`; traversals admit frame/work units before descending.
Context collection uses a charged counting pass before exact allocation, then a
charged materialization pass. Complete trace normalization admits every origin
map, event and environment row. No collection is materialized to discover its
allocation charge. Prepared histories publish only after all representations;
preparation failure removes the new membership but retains cumulative charges.
Comparisons/tie projection and frozen completion/ref validation share the meter.
The inherited rank cannot return its incumbent after refusal or cancellation.

These are declared logical units, not V8/RSS accounting. A synchronous abort
checkpoint preserves the exact reason but proves no asynchronous worker cleanup.
No matcher/parser translation, complete search, worker, native run or promotion
is implemented. Historical137 and old failed predictions remain bound, not rerun.
