# Diagnostic mapping fixtures after admitting eval

Full candidate run 8302 reports 12 failures in loader/multiple-blocks.test.ts.
Independent focused reproduction 57408 confirms all 12: the expected rejected
eval now succeeds, rather than producing a diagnostic to map to Markdown lines.
This is an obsolete diagnostic trigger, not evidence of broken line mapping.

Replace the two eval source lines with strict-module with syntax, which remains
disallowed. Keep every filename/line assertion, SDK/CLI/example entry point,
hashbang, Markdown fence and LF/CRLF/CR variant. No assertion, case or budget is
removed or relaxed. Run all loader tests and scoped lint before incorporating
the fixture change into the dynamic-source candidate after its active run ends.

The isolated candidate remains frozen during 8302; this fixture update is
currently main-only. No passing full-candidate gate or delivery is claimed.

Main session 21198 passes all 162 loader tests across six files after the two
fixture-line substitutions. Its chained scoped ESLint also passed (exit 0).

Full run 8302 completed with only these 12 failures (22,740 passed, 37 skipped).
Its package hash remained unchanged. The two-line fixture correction was then
applied to the candidate, where all 162 loader tests pass (68927, exit 0).
