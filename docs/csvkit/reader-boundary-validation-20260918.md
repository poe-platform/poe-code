# Additional CSV reader boundary validation, 2026-09-18

Procedure: [reader QA](../plans/csvkit-reader-qa.md). Target remains csvkit 2.2.0
with the hash-pinned primary CPython 3.14.2 profile in reference-profile.json.

An independent agent reproduced two original in-memory regression failures:
escaped newline continuation ended prematurely on an empty iterator item, and
ordinary text after an escaped CR/LF discarded continuation before the next
iterator item. The reader now preserves that state until a delimiter, another
escape or an unescaped newline changes it. Three canonical memory-only tests
cover both failures and delimiter termination. They passed after the fix.

The independently authenticated CPython executable matched SHA-256
3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae.
A deterministic 12,000-case iterable differential cohort originally had 60
mismatches and had zero after the fix. A further 6,000 text-input cases compared
the public text reader against csv.reader over universally translated StringIO
and had zero mismatches. These finite cohorts exercise reader transitions;
they do not establish exhaustive compatibility or native csvkit command parity.
The available pinned interpreter provided the csv module but no importable
csvkit installation; a new native command comparison was unavailable.

Cohort generation used the LCG update
`seed = (seed * 1664525 + 1013904223) >>> 0`. Seed 41 generated iterable
cases with 1–3 items of length 0–8 over `a`, comma, quote, backslash, LF, CR
and space; escapechar was backslash, with varied doublequote/skipinitialspace
and quoting 0/1/3. Seed 123 generated text cases of length 0–15 with emoji
added to that alphabet. The authenticated interpreter was
`/Users/kjopek/.local/share/uv/python/cpython-3.14.2-macos-aarch64-none/bin/python3.14`.

The discovered differences affect custom public readCsvStream iterator inputs.
No mismatch was observed for the command engine's normalized physical-line
inputs. Actual Shell tests still cover named/stdin NUL handling, BOM boundaries,
tabs precedence, Unicode limits, multiline numbering and cooperative cleanup.

Uncached maintained checks passed: csvkit workspace unit tests (1,361 passes,
five encoding TODOs), workspace lint including source/test TypeScript, selected
csvkit workspace build closure, and the four maintained safe-bash CSV command
test files (94 passes, no skips or TODOs). Full repository checks were not run
for this isolated domain reader change.

An actual Shell screenshot was rendered and inspected: csvcut -l numbered one
multiline logical row as 1, while --maxfieldsize 2 reported physical line 3,
preserved the prior header and exited 1. Owned temporary evidence was removed.

Command input quoting modes 2/4/5, secondary-runtime qualification and all
remaining blockers in implementation-status.md remain explicit. No README,
staging, commit, push or publication changes were made.
