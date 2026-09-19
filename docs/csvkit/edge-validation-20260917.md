# Edge validation, September 17, 2026

The requested suite remains unfinished. This report qualifies bounded reader
and writer observations plus implemented-command and lifecycle regressions;
it does not qualify all original tests, formats, Agate types or real services.
Procedure: docs/plans/csvkit-edge-qa.md.

## Reference

The native research used CPython 3.14.2 with executable SHA-256
`3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`,
matching the existing frozen profile. The hash-locked install contained csvkit
2.2.0, Agate 1.14.2, SQLAlchemy 2.0.54 and Babel 2.18.0. The 3,820,365-byte
released source archive was independently streamed and authenticated as
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
An initial bounded 2 MiB read truncated the archive and failed authentication;
that attempt is rejected evidence. The complete bounded streaming hash passed.
Released-command captures used C locale, UTC, UTF-8, 80 columns and 24 lines.
No native program appears in canonical unit tests or product execution.

## Measured cohorts

Reader inputs enumerate the empty string and every string through length five
over seven characters: `a`, comma, double quote, backslash, LF, CR and space.
Each of 19,608 inputs is checked under nine dialects: defaults; backslash escape;
backslash escape without doublequote; backslash escape with skipinitialspace;
backslash escape with QUOTE_NONE; quote equal to comma; escape equal to comma;
escape equal to quote; and space delimiter with skipinitialspace. Native input
uses StringIO with universal newline normalization. Compare complete record
cells and physical line numbers, or exact exception diagnostics.

The first smaller 14,005-case probe found 1,070 mismatches. EOF physical line
numbering and escape precedence after closing quotes accounted for those bugs.
After their fixes, the expanded probe additionally exposed 5,538 space-delimiter
mismatches. Invalid character combinations were initially rejected by the native
probe; admission was subsequently measured as explicit diagnostic observations.
The final 176,472-case probe has zero mismatches. This includes 58,824 rejected
dialect observations; these are matching reference errors, not successful reads.
This bounded enumeration excludes typed input quoting and larger/other alphabets.

Writer inputs use empty rows, a single null and three row shapes for every string
through length three over the same alphabet: one cell, trailing empty cell and
leading empty cell. Nine dialects cover defaults, QUOTE_ALL, QUOTE_NONE, backslash
escape, escaped QUOTE_NONE, disabled doublequote, escaped disabled doublequote,
`END` terminator and space delimiter with skipinitialspace. Before the native
writer, CR is replaced by LF to match the existing Agate-facing writer contract;
the native default terminator is explicitly LF. The 10,818 observations include
repeated empty row shapes. The initial probe found 800 mismatches in space-delimiter
empty-field quoting; the final probe has zero mismatches. Typed/new quoting modes
are not qualified by this cohort.

## Fixes and original regressions

- General work exhaustion now retains refusal status 78 when diagnostic emission
  cannot spend another work unit. Zero/one/two-unit in-memory regressions initially
  threw instead of returning. No diagnostic bypasses the exhausted budget.
- The independent agent reproduced cancellation hanging behind pending stdin
  `next()`. The accounting adapter now forwards cooperative `return()` directly,
  preserving the falsey cancellation reason and byte accounting. Its regression
  failed before the change and passes afterward.
- Unfinished quoted/escaped records ending in LF, CR or CRLF now report the last
  actual physical line rather than an invented following line.
- The first nonseparator after a closing quote remains literal, even when it is
  the escape character. Subsequent escapes still use the ordinary unquoted state.
- Frozen dialect admission rejects CR/LF, colliding delimiter/quote/escape values
  and quote/escape spaces when skipinitialspace is enabled, for readers and writers.
  Invalid delimiter lengths retain the native diagnostic without incorrectly
  advertising None as an accepted delimiter.
- Space-delimited readers skip repeated leading and interfield spaces. Writers
  quote empty cells when skipinitialspace would otherwise erase them; forbidden
  unquoted empties retain the native error.

Each code fix followed a failing canonical regression. Two captures against the
actual released commands additionally confirm exact stdout/stderr/status:
`csvcut -p BACKSLASH` on a closing-quote/escape row emits `x` plus a literal
backslash before the separator; `csvgrep -c a -m x -l` on an unfinished multiline
row reports data line 1. These cases are maintained in the domain stress suite.

## Checks and limits

The domain unit suite passes 224/224. The focused Shell/plugin files pass 52/52;
these are supplemental checks, not the full safe-bash unit gate. Selected domain
and safe-bash build closures passed. Safe-bash source/test and public-consumer
typechecks passed, including maintained negative controls and 26 consumer groups.
Final domain lint passed. Guarded root ESLint completed with zero errors and two
warnings in docx tests outside this change. These are style/type checks, not
runtime acceptance.
The normal repository build, including root suffix stages, also passed with
the final edge fixes.

Compiled public plugin pipelines were executed against MemoryFileSystem. The
escaped-field look table, space-delimited CSV and invalid-dialect diagnostic were
rendered and visually inspected: alignment and text were readable without clipping.
Temporary native installs, captures, logs and screenshots are purged after reduction.

The existing full repository unit route remains blocked by two committed-HEAD
archive authority checks against an uncommitted guarded build script. This run
does not change that script, weaken those checks or authorize a commit. All
unimplemented/unqualified paths and README publication remain blockers described
in implementation-status.md. No staging, commits, pushes or releases occurred.
