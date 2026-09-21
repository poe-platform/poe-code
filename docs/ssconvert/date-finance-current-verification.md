# Current date/finance verification

The existing shared TypeScript ESM engine registers all 127 released descriptors:
date 27, financial 57, derivatives 29, Christian calendar 5 and Hebrew calendar 9.
This continuation preserves that implementation and repairs concrete source-based
admissibility/rounding findings. It does not establish exact Gnumeric compatibility.
The original descriptor inventory, aliases, arities, flags and error observations
remain in function-coverage.json. No native executable is a product dependency.

The required source archive was freshly authenticated under out with SHA-256
2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12.
The existing dependency/plugin/compiler/locale capture remains unchanged.

## Repairs and independent verification

- YEARFRAC now rejects negative fractional bases before integer truncation.
  Independent failing examples used -0.5 and -Number.MIN_VALUE; positive 0.5
  and 4.999 remain admissible, matching value_get_basis in fn-date/functions.c.
- DATE2UNIX now uses the existing signed fake-round arithmetic. The independently
  minimized binary-exact expression DATE2UNIX(-1-1/256) exposed signed
  rounding. Fresh native measurement also exposed final value_new_int narrowing:
  captured GCC ARM64 saturates signed32 overflow. The 1900 result is -2147483648;
  the 1904 result -2082931538 independently exercises negative rounding without
  saturation masking it. Positive overflow at 2038-01-19 03:14:08 yields 2147483647.
  This qualifies the captured ABI; other compilers remain unverified.
- Shared coercion recognizes independent numeric date separators, C-locale
  month/day/year text and the fixed 29/30 two-digit-year cutoff. Clock suffixes
  support compact four/six-digit times, compact fractional minute/second layouts,
  fractional seconds and a decimal point without following fractional digits.
  Invalid Gregorian dates, nested dates, signed/elapsed date suffixes and
  fractional AM/PM hours/minutes remain errors.
- DATE2HDATE, DATE2HDATE_HEB and DATE2JULIAN now discard injected clock time
  by extracting calendar fields, matching the released GDate conversion. At
  fixed UTC noon the prior values were 20.5 Tebet 5784, malformed Hebrew text,
  and Julian 2460311.5; native returns 20 Tebet 5784, כ׳ בְּטֵבֵת התשפ״ד, and
  2460311. Independent fail-first tests cover all nine omitted-argument Hebrew
  functions at midnight/noon, both date systems and a New York prior-day
  boundary, plus explicit fractional serials and clock/budget/cancel controls.
- Derivatives now register their 29 module handlers directly instead of rebuilding
  a closure and calling a proxy for every function invocation. A TypeScript-symbol
  dependency analysis adds explicit host parameters only where needed and retains
  pure arithmetic helper signatures. All 65 derivative tests pass before and
  after, including work/allocation budgets, cancellation and invocation recovery.
  Independent symbol checks verify 287 host references and 36 propagated calls.

Original root date-text tests failed before parser changes. A different agent
independently reproduced both date-function bugs with failing regressions and
repaired them. That agent also caught an incorrect root expectation: got_date
calls format_match_time with allow_elapsed=FALSE, so signed suffixes and hours
at least 24 must be rejected. Those expectations and parsing were corrected.
Further compact-fractional and AM/PM findings received separate failing tests
before repairs. Final independent checks pass 27 tests: 25 date/calendar stress cases
and two parameterized date-text tests containing 20 expressions each.

All fixtures are original and in memory. Unit file-effect integration uses memfs;
tests do not launch native tools, query LLMs or create fixture files on disk.
The command/SDK cases preserve exact output bytes, empty diagnostics, numeric
serials, formulas, 1900/1904 metadata, original/checkpoint/replay behavior,
original fixture values and unrelated VFS namespace entries. Existing limits,
clock injection, cancellation, cleanup and error suites run in the workspace gate.
Manual final-runtime controls also verify rejection of foreign-realm workbook
prototypes (invalid-request, exit 1), successful calculation after structured
cloning, null-prototype owned results, unchanged original values after budget
failure and preservation of the caller's exact cancellation reason. Two initial
manual assertions assumed foreign prototypes would be admitted and owned results
would retain Object.prototype; inspection confirmed the existing deliberate
snapshot policy. Corrected policy-aware controls pass without changing that policy.
The measured product runtime is Node 22.22.2 on darwin ARM64 with ICU 78.2,
CLDR 48.0 and timezone data 2025c; alternate host/runtime cells remain unverified.

Final workspace checks pass 2,808 tests in 111 files without skips, maintained
syntax/type/runtime lint, and the uncached selected build. The safe-bash build
closure and 35 command/SDK tests pass. Gate receipts distinguish checks of the
earlier candidate from final checks after the last AM/PM repair. Final root build, repository lint and default serial npm test all exit zero.
Repository lint completes with zero errors, four warnings and no gaps. The broad
test output reports 881 skipped and seven TODO assertions across summaries;
these are non-passes and the summary totals are not unique-case counts. The
maintained runner also identifies 33 workspaces without declared unit tasks and
two manifestless directories, neither counted as passes. Full declared task
membership is retained in date-finance-current-gates.json; focused checks never
replace an incomplete or failed broad route.

A concurrent broad attempt produced five 5000ms timeouts in unchanged SafeJS
camera tests under multiple suites and lint. The maintained default serial run,
after builds/lint settled, passes all 18 camera tests unchanged; sampled cases
complete in about 1.1–1.2 seconds. This resolves verification scheduling without
raising timeouts or removing cases. These are bounded observations, not product
performance qualification. The entire final serial broad route completes with exit zero and is separately
recorded; passing this file never substitutes for completing that gate.

An actual virtual-command screenshot was rendered and inspected. Date, finance,
Hebrew-year, Easter and negative error results are readable. It uses injected
original byte codecs, not built-in spreadsheet XML/ZIP codecs. This check does
not requalify the earlier Hebrew glyph-rendering limitation.

## Remaining mismatches and unavailable cells

The authenticated GOffice 0.10.61 and Gnumeric 1.12.61 archives were freshly
built under owned out directories using the named colima context. The default
Docker endpoint was unavailable; no global setting was changed. Missing build
dependencies, a missing schema environment and an incomplete initial XML fixture
were investigated and resolved. Failed attempts remain distinct from passes.
The captured profile is date-finance-current-native-profile.json.

Fresh measurement covers 486 cases under both date systems: the prior 410 counted
cases and 76 added date-text, basis, rounding, signed32 and volatile-clock controls.
There are 430 exact matches and 56 exact numeric differences; zero differences
exceed relative tolerance 1e-12. All new controls match exactly. Every result is
retained in date-finance-current-differential.json; tolerance is not an exact pass.
The QA-only clock shim fixes time and g_get_real_time at 2024-01-01T12:00:00Z;
NOW, TODAY and all nine omitted-argument Hebrew calendar functions match
injected product clocks under both date systems, bringing
the measured descriptor count to 127. Both native exports exited zero with empty
diagnostics. The earlier cohort and profile remain historical evidence. Native
batch runtimes are bounded observations, not performance qualification.

Real Gnumeric/Excel/ODF byte roundtrips remain unsupported/unverified: providers
still require injected readers/writers, and grammar/fixture preservation does
not prove real spreadsheet-byte conversion. Non-C locale
date parsing, DST folds/gaps, sub-millisecond clock precision, extreme integer
casts, far-future Hebrew overflow,
complex odd-coupon cases, ill-conditioned roots, native assertion diagnostics
and native libm/compiler ULP parity remain unmeasured as described in the original
date-finance-verification.md. Named-month/yearless date matching and additional
ISO date-time input variants remain unimplemented in shared coercion.

The candidate receipt hashes 239 source/config/integration inputs, including
preserved shared inputs; it is not an authorship claim or a Git commit. No README
was edited, and no commit, push or publication was performed. Owned temporary
logs, sources, binaries, images and containers were removed after retaining
bounded receipts; earlier workers’ out evidence remains intact. The executed
procedure is docs/plans/ssconvert-date-finance-current-qa.md.
