# Eval intrinsic in historical checkpoint expectations

The whole-package run reported two historical graph failures. Both reproduce
unchanged in the current worktree: the actual restored global binding list adds
eval, while the explicitly enumerated additions list contains only globalThis.

Add eval explicitly to both lists. Keep the original fixture bytes, source
hashes, metadata, aliases, host-call assertions and graph comparator unchanged.
The comparator requires each addition to be absent from the historical binding
set and to resolve to its exact canonical intrinsic heap record; this is not a
wildcard allowance for extra globals or arbitrary graph changes.

Validation: both original cases fail before the expectation change. Afterwards,
the complete two regression files plus the graph comparator's own tests pass:
53 passed, one existing skipped case. The frozen full-suite failure count is not
rewritten by this focused pass; it requires a new integration run.
Focused repository-configured ESLint and whitespace checks also pass.

These expectation changes depend on the local eval implementation and must ship
with it, not independently onto a source revision that lacks eval. No push or
release while publication is paused.
