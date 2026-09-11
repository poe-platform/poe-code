# Strict eval and arguments targets

Native compilation validated accepted invalid strict binding/write targets
named eval or arguments. The initial regression run failed both rejection
groups and passed both valid-use groups.

Strict target checks now cover ordinary assignment, updates, shorthand
binding/assignment patterns and converted object rest/shorthand targets.
Member writes and reads remain valid, as do non-strict targets. Tests cover
32 invalid source variants and 14 valid controls, including loop targets,
rest patterns, defaults and compound/logical assignment.

All four focused groups and package TypeScript passed, covering all 46 source
variants. Seven additional native comparisons for catch/loop bindings, strict
parameter directives, explicit destructuring targets and computed keys matched.
The broader run passed 1,377 tests, skipped one and failed five newly added
async-arrow regressions before their repair; it is not a passing broad gate.
The subsequent combined parser/runtime run passed 1,382 tests (one skipped).
Focused lint passed. This change is outside the
frozen isolated SafeJS unit suite. Pushes and releases remain paused.
