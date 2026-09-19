# Python regex set difference user validation

Independent stress review found an observable warning suppression bug:
`[a-b--c]` was accepted silently even though the frozen CPython interpreter
emits `FutureWarning: Possible set difference at position 4`. The same issue
affects `[a-b--]` and `[^a-b--c]` (position 5 for the negated class).

Manual stdlib probing authenticated CPython 3.14.2 at executable SHA-256
`3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`, matching
the stored Python re reference profile. This is stdlib warning evidence only,
not a full csvkit command capture or full dependency-profile requalification.

A new in-memory regression failed before the fix (warning-producing pattern
did not throw), then passed after refusing a repeated hyphen following an
already collected class item. Leading `[--a]` remains accepted: CPython reports
no warning and matches `-`/`a`, excluding `b`/astral emoji.

The correction preserves the existing policy: warning-producing syntax is an
explicit unsupported case until command warning provenance is qualified.
It does not implement native FutureWarning output or count these cases as
csvkit parity passes. Focused regex, lookaround, reference and csvgrep checks
passed 117 tests. Maintained `npm test --workspace=@poe-code/csvkit` completed
with 99 files, 4,397 passes and five explicit TODO cases. Workspace lint and the
selected maintained csvkit build closure passed.

The first direct actual-shell invocation stopped before product execution:
root export artifact `poe-code/packages/safe-js/dist/safe-fs-core.js` was absent.
It was an integration/build prerequisite, not a command parity pass. After
root rebuilt the root-facing artifacts, actual safe-bash execution passed exact
stdout/stderr/status checks: `[a-b--c]` returns empty stdout, the explicit
unsupported diagnostic and status 78; `[--a]` and `[a-b-c]` remain successful
with their expected raw CSV output. Redirecting the blocker to `/warning.txt`
preserves exact stderr bytes in the memory filesystem and leaves shell stdout
and stderr empty. Root owns terminal screenshot review.
