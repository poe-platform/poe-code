# CSV reader validation, 2026-09-18

Target: csvkit 2.2.0, source archive SHA-256
147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b,
primary CPython 3.14.2 / Agate 1.14.2 profile from reference-profile.json.
Procedure: ../plans/csvkit-reader-qa.md.

Original failing in-memory tests reproduced string-only numeric quoting, missing
quoting admission, unsupported None quote/escape characters, lost physical
iterator boundaries/empty rows, and escaped boundary/CRLF differences. The
state machine now processes explicit item boundaries and escaped-newline
continuation without collecting upstream input. Field sizes count Unicode code
points; diagnostics use physical iterable line numbers. Stream early return
closes upstream before another item is requested.

QUOTE_NONNUMERIC converts nonempty unquoted fields with Python-compatible decimal
float grammar, Unicode decimal digits and digit separators. QUOTE_STRINGS also
returns null for unquoted empty fields; QUOTE_NOTNULL retains nonempty strings
and returns null only for unquoted empty fields. Quoted empty strings stay empty
strings. Public reader overloads retain string cells for modes 0/1/3 and expose
CsvCell for numeric/null modes; readCsvStream is now publicly exported. The shared
writer dialect also defaults to QUOTE_NONE when quotechar is null, with an
original regression preventing silently unescaped delimiters.

Independent agent: authenticated CPython 3.14.2 differential checks confirmed
the original numeric/None/NUL expectations and 392 two-item/doublequote cases
with zero mismatches. This finite cohort is not exhaustive compatibility. The
seven independent stress tests include exact physical-line errors, Unicode
character limits, multiline typed streams and upstream ownership/backpressure.
Canonical tests use memory only; native observations are development evidence.

Independent actual-Shell stress compared 62 immutable raw/additional/I/O fixture
cases across csvcut/csvformat/csvgrep/csvclean/csvstack: 61 exact
stdout/stderr/status matches, one explicit csvcut -u2 blocker, no unexpected
mismatches and unchanged named input files. Additional in-memory Shell assertions
covered tabs precedence, emoji/é character limits, multiline logical numbering,
csvgrep/csvclean physical reports, named/stdin NUL differences and untouched raw
semicolon/001/true input. These novel assertions are source-reviewed product
observations, not newly measured native csvkit differentials.

Uncached checks passed: csvkit workspace test (1,358 passes, five TODOs), workspace
lint (source and test TypeScript included), selected maintained workspace build
closure, and all four maintained safe-bash csvkit command test files (94 passes,
no skips/TODOs) through Node/tsx with concurrency 1. Full repository tests/lint
and secondary runtime qualification were not performed for this reader change.

The actual Shell screenshot showed logical output row number 1 for a multiline
record and FieldSizeLimitError on physical line 3, with status 1 and preserved
prior header output. The terminal renderer lacked an emoji glyph; output-byte
assertions, rather than its glyph rendering, establish Unicode preservation.
The owned temporary screenshot was deleted after inspection.

Command-level input modes 2/4/5 remain explicit status-78 blockers: downstream
operations still require string cells and are not qualified for typed reader
values. Existing named-file NUL removal, stdin NUL preservation, BOM handling,
tabs precedence and raw-reader no-sniff behavior remain covered by existing
domain/Shell tests. CPython 3.9.6 does not define modes 4/5; this new numeric
cohort qualifies only the primary 3.14.2 profile. No new secondary-runtime
selection or full-suite parity claim is made. The five encoding TODOs remain
unmeasured, and all suite blockers in implementation-status.md still apply.

No README, index, commit, push or publication changes were made.
