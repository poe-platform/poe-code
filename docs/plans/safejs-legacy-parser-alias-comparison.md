# Legacy checkpoint parser aliases

Full package run 19850 and focused repeat 58753 reproduced two historical
checkpoint comparison failures after the committed parser identity repair
`0b3e4d7c0`. The legacy format stored inline function names; the current format
stores intrinsic heap references. The comparator required the global parser
path even though the shared parser was first registered under Number.

Two new positive helper tests failed before the correction (14370), while six
negative controls passed. The comparator now accepts the canonical Number path
for only the two global parser functions and explicitly requires the Number
property and global binding to reference exactly the same heap node. Split
references, unrelated canonical paths and missing properties remain rejected.
All other intrinsic paths and legacy heap alias checks remain unchanged.

The main-tree historical and helper selection passed 52 tests with one existing
skip (59354). The final exact-reference comparison is also checked in the
isolated candidate, excluding pending weak-reference edits but including the
uncommitted prototype-origin repair. No runtime behavior or checkpoint format
is changed by this test-helper correction. The separate Atomics timeout and
full-package validation remain unresolved.

The final isolated selection passed 52 tests with one existing skip (59016),
including the unchanged historical fixtures. Scoped ESLint passed both helper
files (22052). This test-only correction needs no generated runtime rebuild or
CLI screenshot; no runtime or visual CLI source changed.

The initial staging review caught that the new cases had accidentally replaced
the existing helper test file. The commit process was interrupted before a
commit was created. All original tests were restored byte-for-byte against HEAD
in both trees; the new cases now live in `legacy-parser-aliases.test.ts`.
The corrected combined selection passed 69 tests with one existing skip across
four files (96061), including all 17 original helper tests. Earlier 52-test runs
did not cover those original tests and are superseded by this combined result.
Scoped lint passed with the final filenames (36163).
