# Animation inventory implementation receipt

Scope: read slide timing trees through `readAnimations` and shared CLI read routes.
No playback or authoring is implemented. Preserve unsupported timelines and motion
paths. Existing XML/package budgets bound input; iterative document traversal and
reference DFS avoid recursive graph execution. Expanded reference destinations per
slide may not exceed xmlLimits.maxNodes, bounding serialized duplicate-ID references. Namespace identity controls meaning.
Shape selection retains the complete containing graph only when that shape is targeted.

TDD: the first SDK run failed because animations.ts was absent. Original in-memory
package cases then exposed the mutation loader rejecting invalid timing graphs; the
read route now admits packages through the existing package reader and selection
index, so timing defects can be inventoried. A shape-token regression exposed an
incorrect default slide kind, which was removed for emitted tokens.

SDK regressions cover nested sequence/parallel graphs; effect/trigger metadata;
opaque motion paths; missing shape targets; duplicate timing IDs; missing references;
reference cycles; no/one/two video nodes; missing child list; deterministic ordering;
archive member order independent of slide/node ordering; XML budgets; cancellation; accessor rejection; empty timelines; shape-name and emitted
token selection; namespace collision and opaque text; and duplicate shape IDs rejected
by shared object identity admission. An unrelated transition edit independently
checks the original timing XML slice is retained in the resulting archive.

Maintained checks: focused Vitest animations suite and package lint (ESLint plus
production/test TypeScript checks). Parent integration adds CLI read regressions and
runs maintained package checks after all owned edits land. No downloads, native
runtime, network, or disk fixtures are needed by unit tests.

Disposable QA procedure: use only manifest-listed downloaded artifacts outside
tracked product files; inspect representative empty and nested timing graphs;
compare byte-preserved timing content before/after unrelated supported mutation.
Record concrete findings as original minimal fixtures. Playback remains unverified.

Final ordering regression independently authors two differently ordered timelines,
reverses actual ZIP local/central member order using the test fixture codec, and
checks explicit expected slide/part/node/timing-ID tuples in both archives. Focused
SDK suite: 14 tests pass.
