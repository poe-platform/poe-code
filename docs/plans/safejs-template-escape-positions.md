# Template escape diagnostic source positions

## Validated failure

Read-only main probe 5d9376 parses malformed hex, Unicode and decimal escapes
after `bc` on the second line. LF and CR report line 2, column 3. CRLF reports
column 2, although the backslash is still the third character on that line.
The cooked decoder validates normalized text, then passes its shorter index to
the source-position calculation over the original CRLF text.

The isolated regression has 21 cases: three line-ending forms, three escape
kinds, first/subsequent template segments, plus multiple CRLF lines. Before
the diagnostic change, 12 pass and nine fail (ce1c14). This is an independently
reproduced diagnostic defect, not a claim that ECMAScript mandates diagnostic
wording. It is separate from raw-template value normalization.

## Candidate and checks

In `/tmp/safejs-template-lines.6ZVZiS`, validate escapes against original text
before normalizing it for cooked-value decoding. Invalid indexes now remain
source indexes. Normalization and escape decoding for valid strings stay intact.
This candidate coexists with the separately validated raw-value repair.

- Combined template/interpreter/replay selection: 181 passes in 11 files
  (29081b).
- All 30 pinned top-level Test262 String/raw fixtures pass with fresh native
  controls, no exclusions and no native-unqualified cases (f0aa46).
- The full parser selection first exposed one obsolete raw-CRLF expectation
  in tokenizer.test.ts (5f51ec). Updating that single expected raw value to LF,
  as required by the native control and specification, yields 1,495 passes and
  one skipped test across 60 files (233f75).
- Scoped parser/new-position-test lint passed (ca70d8); package TypeScript
  no-emit passed (7618a0).

The original main suite, session 82564, remains active and main runtime/test
files remain unchanged. Neither isolated candidate is integrated or delivered.
Transfer the two fixes with separate commits after the original suite becomes
terminal, then verify them in main. No CLI visual change requires screenshots.

## Main integration

After full-suite session 82564 terminated, raw-value normalization was committed
separately as `3e3338622`. The diagnostic regression then reproduced nine
failures and twelve passes in main (3d3d2b), before its runtime change.
Validating original text before cooked normalization fixes the diagnostic index.
Main parser checks now pass 1,495 tests with one skip across 60 files (b2013d).
Scoped ESLint passes (0b1b48), as does package TypeScript no-emit (e2903f).
README and current gap inventory are updated. The latest completed full-package
result remains 28,077 passed, 14 failed and 47 skipped and predates both parser
repairs; these focused checks do not turn that result into a full-package pass.
All 30 pinned String/raw fixtures also pass in main, with no exclusions or
native-unqualified cases (1e0aa6), under the same bounded probe protocol.
