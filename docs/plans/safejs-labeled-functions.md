# Non-strict labeled functions

Native compilation/execution validated rejected legacy labeled ordinary
function declarations at function-body and block statement-list positions.
Six valid regression cases failed before the change; seven invalid-context
controls passed.

The parser now admits ordinary non-strict labeled functions while retaining
strict, async and generator restrictions. Unbraced if/loop/with bodies reject
labeled functions. The declaration node itself retains source and strictness
metadata, rather than cloning it into a node without its weak-map metadata.
Existing function/block hoisting paths handle the labeled declaration.

Tests cover chained labels, block and conditional-block behavior, hoisting,
native function toString and invalid contexts. All 13 focused tests passed.
All eight generator/block snapshot-recovery tests passed, including both new
labeled-function restore cases. Package TypeScript passed; the broader
parser/runtime suite passed 1,421 tests (one skipped). Latest focused lint
remains required.
This change remains outside the frozen isolated suite. Releases and pushes
remain paused.
