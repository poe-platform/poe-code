# CSVKit safe-bash session stress validation

Validated on 2026-09-18 after the integration owner rebuilt the selected csvkit
workspace closure. This records a narrow in-memory command review, not complete
csvkit 2.2.0 compatibility or real driver qualification.

| Check | Result |
| --- | --- |
| `node --import tsx --test --test-reporter=spec 'packages/safe-bash/tests/commands/csvkit*.test.ts'` | 372 cases: 371 passed, 0 failed, 0 cancelled, 0 skipped, 1 unresolved TODO; exit 0 |
| `npx vitest run packages/csvkit/src/sql2csv.test.ts --reporter=dot` | 165 passed |
| Scoped ESLint for modified domain command/test and shell stress tests | Passed |

The actual command suite runs all fourteen registered executable names against
the rebuilt compiled engine. It compares stdout, stderr, exit statuses, virtual
filesystem effects, and injected database/interpreter resource effects. Tests
use in-memory inputs and virtual filesystems; this review used no native csvkit,
product subprocess, network request, LLM, or real database.

An original sql2csv provider-boundary regression failed before the fix because
object spread recreated execution options with an ordinary prototype. The fix
preserves a null-prototype object, own `__proto__` data, ordered repeated-option
overrides, and default execution values. Two interpreter work-budget fixtures
now contain their named virtual input so the correct open-before-load behavior
does not mask the budget assertions.

Three additional actual-shell cases pass with a producer that repeatedly yields
the same Buffer view and overwrites its backing storage during finalization.
csvcut, csvjson, and in2csv JSON preserve multibyte bytes and finalize once without
acquiring stdin for named input.

The TODO is **duration long s** in
`packages/safe-bash/tests/commands/csvkit-temporal-user-edge.test.ts`. Native
Agate returns status 1 and `KeyError: 'ſec'`; the implementation returns explicit
status 78 with an unqualified-hypothesis diagnostic. It remains a blocker and
is excluded from the 371 passes despite the runner's exit 0.

QA procedure: `docs/plans/csvkit-safe-bash-session-stress-qa.md`.

## Source review of the unresolved hypothesis diagnostic

The frozen `agate.TypeTester.run` source in
`docs/csvkit/service-register-20260917.json` constructs a set of hypotheses for
each column, visits sampled rows before columns, tests every surviving type in
a copied set while more than one survives, and chooses a preferred survivor
after sampling. `DataType.test` catches only `CastError`. A native Date
`KeyError` therefore escapes even when TimeDelta would accept the same value.
The product currently samples candidates by preference and returns the first
accepting candidate, so it does not implement that error and effect ordering.

An in-memory call against the rebuilt implementation verified that Date and
DateTime casts of ordinary duration strings `1 h` and `1 week` currently return
explicit status-78 parsedatetime-expression blockers. Date casts of `1 ſec`
already return `KeyError: 'ſec'`; DateTime returns an explicit unqualified
parsedatetime-expression blocker. Switching inference to the complete native
hypothesis scan would expose those unqualified casts in otherwise measured
duration commands. Existing frozen evidence does not qualify the missing
natural-language temporal hypotheses or multiple-error iteration order of the
native Python set.

No algorithm change was made during this review. A Unicode-only diagnostic
scan would conceal the same general hypothesis lifecycle mismatch. Resolving
this blocker requires measured rejected and accepted Date/DateTime hypotheses,
row/column/error ordering, and direct TimeDelta casts separated from inference;
it cannot be established by removing the TODO marker.
