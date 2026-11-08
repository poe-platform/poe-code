# DATA extractor correction before second execution

The first frozen checker at7aeab85a authenticated packet/seal inputs, then failed
while extracting ErrnoCode as a quoted string union: observed0, expected28, exit1.
Raw check.stdout.data/check.stderr.data remain unchanged. Actual pinned source
defines `ErrnoCode = keyof typeof descriptions`, not a literal union. This was a
reviewer DATA-recipe assumption, not a candidate design/contract failure.

The corrected recipe first asserts that exact type declaration, extracts only
the own source-table identifier keys from the bounded descriptions block, then
compares all28 without importing or evaluating the TypeScript. It also checks
the eight explicit WRQ/L pairs and the zero-executed qualification count. No
policy or expected code inventory changes. The corrected whole recipe is sealed
before its second execution. This remains within the three-process DATA cap.
