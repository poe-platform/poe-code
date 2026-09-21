# Independent Roman numeral review

Reviewed the live `functions/roman.ts` implementation on 2026-09-19 separately
from its author. Procedure: `docs/plans/ssconvert-functions-math-engineering-complex-qa.md`.
Reference source: Gnumeric 1.12.61, official archive SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Read upstream `plugins/fn-math/functions.c` ARABIC and ROMAN implementations;
ARABIC switches explicitly on seven ASCII symbols and accumulates a C int.

Native QA used the separate `ssconvert-math-qa-20260919` container and
`/out/prefix/bin/ssconvert`, with `LD_LIBRARY_PATH=/out/prefix/lib`, `LC_ALL=C`,
`TZ=UTC`, memory GSettings, and `/out/prefix/share/glib-2.0/schemas`.
Original XML workbook inputs and raw CSV captures stayed in `out`. Native
`--recalc` conversions exited zero with empty stderr. Product execution used
the actual injected-context TypeScript workbook evaluator.

An isolated exhaustive cohort tested every integer 0 through 3999 in every
ROMAN mode 0 through 4: all 20,000 exact output strings matched before and
after repairs. Fourteen additional original cases covered Unicode/ASCII invalid
symbols, indirect subtraction, ignored sign characters, fractional arguments
and modes, negative/out-of-range errors, and numeric/boolean argument coercion.
Two of those fourteen initially failed:

| Case | Before | Native and repaired |
| --- | --- | --- |
| ARABIC("ıx") | 9 | 10 |
| ARABIC("ﬃV") | 4 | 5 |

JavaScript Unicode uppercasing introduced Roman ASCII symbols from characters
that native ignores. ASCII-only folding preserves native recognition.
Fourteen original fast canonical cases demonstrated the two failures before
repair, then passed alongside the six original author fixtures (20/20).
The complete isolated cohort after repair matches 20,014/20,014 results.

A separate original input containing 2,147,484 M characters demonstrated a
signed-int overflow mismatch: native returned -2147483296, while JavaScript
returned 2147484000. Accumulation now wraps at signed 32-bit boundaries; the
same isolated evaluator case returned -2147483296 after repair. This large
fixture stays outside canonical unit discovery. Work remains charged through
the existing per-character host tick and explicitly supplied QA budgets.

The first overflow capture parser rejected its large CSV field at Python's
default 131072-character limit. That was a QA harness failure, not a product
result. A subsequent script edit also produced a syntax error. The corrected
isolated harness explicitly admitted a 3,000,000-character CSV field and
obtained the native result reported above; neither failed attempt counts as a
pass. No canonical test spawns a native process or writes a file.

Focused ESLint passed. Root owns maintained workspace build/test/lint and
command integration checks. No measured mismatch remains in these cohorts.
Embedded NUL admission, every malformed Unicode input, all integer-overflow
patterns and every resource-limit boundary remain unmeasured here.
