# Independent conditional math review

Reviewed the live implementation on 2026-09-19 separately from its author.
Procedure: `docs/plans/ssconvert-functions-math-engineering-complex-qa.md`.
This review owns only `functions/conditional-math.ts`, the exported whole-match
criterion behavior in `functions/database.ts`, and its independent fixtures.

The native oracle was the separately built Gnumeric 1.12.61 in container
`ssconvert-math-qa-20260919`, with `/out/prefix/bin/ssconvert`,
`LD_LIBRARY_PATH=/out/prefix/lib`, `LC_ALL=C`, `TZ=UTC`, memory GSettings,
and `/out/prefix/share/glib-2.0/schemas`. The pinned official source archive has
SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Original small XML workbook inputs and raw CSV captures were isolated in `out`.
Native `--recalc` conversion exited zero with no stderr diagnostics.

Twenty-seven independent original formulas covered sparse absence, stored
zero, empty text, numbers stored as text, mixed-case strings, booleans, errors,
full wildcard matching, equality with a literal wildcard, old/new argument
forms, empty conditions, empty selections, array/range eligibility, and
mismatched range heights. Every measured result matches native exactly as a
typed numeric value or spreadsheet error after repairs (27/27).

The original eight fixtures passed before review. Independent TDD found three
failures in the first twenty cases, then four failures in an expanded cohort:

| Validated trigger | Before | Released behavior and repair |
| --- | --- | --- |
| COUNTIF(range, absent-cell) | matched all cells, eventually propagated an error | empty old-style criterion matches nothing |
| COUNTIFS(range, absent-cell) | matched all cells, eventually propagated an error | nonempty scalar evaluation coerces criterion to numeric zero |
| MINIFS/MAXIFS with no numeric matches | 0 | #DIV/0! |
| SUMIFS/AVERAGEIFS/MINIFS/MAXIFS with only the data range | #VALUE! | aggregate the range with zero criterion pairs |

Upstream `plugins/fn-math/functions.c` oldstyle/newstyle entrypoints and
`src/criteria.c` supply the distinction between empty old-style criteria and
new-style nonempty scalar evaluation. The database criterion's preexisting
default remains unchanged; conditional math requests whole matching explicitly.
Existing database fixtures verify that database sparse and prefix semantics
remain intact. Conditional fixtures also assert that reading a sparse blank
does not materialize its cell.

Final focused verification: 27 independent conditional cases, 8 original
conditional cases, 40 database cases, and 8 database precision cases passed
(83/83). Unit fixtures use the actual in-memory workbook evaluator and do not
spawn processes, query LLMs, or create files. Focused ESLint passed. Root owns
maintained workspace build/test/lint and command integration qualification.

No known mismatch remains in this measured cohort. This does not establish
exhaustive Unicode wildcard equivalence, locale-specific criterion parsing,
multi-sheet range semantics, all malformed argument combinations, every
two-dimensional competing-error order, or floating-point aggregate formatting.
Those cases remain unmeasured here, rather than counted as passes.
