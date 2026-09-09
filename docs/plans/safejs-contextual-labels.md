# Contextual labels

Native compilation/execution validated rejected labels named async, of, as,
await, yield and let in non-strict ordinary functions. The initial regression
run failed six valid groups and passed seven invalid-label controls.

Initial labels, chained labels and break/continue targets now use contextual
identifier eligibility. Tests compare ordinary and escaped spellings, labeled
breaks, labeled continues and chained labels with native execution. Invalid
strict/async/generator names, duplicate labels, unknown targets and continue
targets that are not loops remain rejection controls.

The first change passed 13 focused tests, package TypeScript and 1,327 broader
parser/runtime tests (one skipped). Further native checks reproduced seven
strict reserved labels being accepted and a labeled let-variable assignment
being rejected: eight new failures, with sixteen controls passing. Label
eligibility now rejects strict future-reserved names while preserving valid
eval/arguments labels, and labeled let declarations are distinguished from
assignments. All 24 expanded focused tests and package TypeScript passed;
the broader parser/runtime suite passed 1,338 tests (one skipped). Focused lint
passed. This followup is outside the
currently running isolated SafeJS suite; do not treat that suite as covering
this change. Pushes and releases remain paused.
