# Independent cell-update stress QA

## Procedure

Use original in-memory workbook objects to exercise the implemented update and
recalculation functions. Never spawn native utilities, query an LLM, or write
fixture files in unit tests. The root owner separately measures Gnumeric 1.12.61
and owns command/export integration.

1. Submit a flat additive formula large enough to expose recursive AST exhaustion.
   Require a typed resource-limit error before relocation/dependency traversal.
2. Pass an already-cancelled signal with an object reason; require exact reason
   identity and unchanged original cell values.
3. Edit a precedent repeatedly in manual mode, checking retained caches and dirty
   flags; force calculation and check the dependent chain's final cache.
4. Fill a two-dimensional range with mixed absolute/relative references and check
   every relocated formula, including unchanged absolute coordinates.
5. Run maintained package unit and lint checks, and the selected uncached workspace
   build. Record actual failures; do not count unsupported/unmeasured cases as passes.

## Verified results

- Source-backed active-sheet clipping stress: normalized range 0..128 on each
  axis targets a 128-by-128 sheet with capacity 16,384. The regression initially
  failed area admission at 129 squared. End coordinates now clip to actual sheet
  dimensions before range/aggregate capacity admission and entry loops, accepting
  exactly 16,384 entries with last coordinate (127,127). Source `sheet.c`
  lines 4455–4476 clips sheet iteration; original top-left parsing/inference
  position is preserved. Root also measured corrected native clipping profile:
  active Small128 receives exactly 16,384 TRUE cells through DX128, first Large
  sheet retains two cells, exit 0 and empty diagnostics. The earlier native
  capture used an incorrect XML namespace prefix and is retained as failed
  fixture evidence, not a product result. Wholly outside ranges remain unmeasured.
- Final checks after clipping/text-format/parser-effect repairs: all 591 package
  tests in 40 files pass (4.43 s), all 24 independent cases pass (200 ms including
  the full 16,384-cell clipping fixture), clean scoped lint exits 0, and the
  selected uncached build exits 0. Root separately owns final integration and
  native differential reduction.
- Later native differential exposed failed-parse namespace effects:
  `=Unknown+` remains a string yet adds Unknown=#NAME?. A failing regression
  proved the missing name. The parser now observes identifiers as it reaches
  them, retaining effects before a later syntax failure. Syntax preceding an
  identifier (`=*Unreached`) creates no guessed name; repeated-name lookup uses
  a Set. Product parsing still executes no host code.
- Independent observer stress reproduced swallowed external SyntaxError reasons:
  the broad syntax catch treated a thrown observer reason as malformed input.
  A failing regression now passes after restricting fallback to the parser's own
  per-call syntax-error sentinel, retaining external/cancellation reason identity.
- Native style observations measured top-left `@` text format forcing numeric,
  formula, boolean and ISO-date input to strings; leading apostrophe is removed.
  Four new cases failed before repair. All five entries now apply top-left text
  inference throughout a range while preserving each destination cell's format,
  with no formula/undefined-name effects in text mode. Other style formats and
  empty text-format input remain outside these measured assertions.
- Final capacity stress reproduced deferred aggregate rejection: a 100-cell
  range within the 100-cell area limit, plus three stored cells on another sheet,
  iterated all 100 rows before snapshot rejection (101 cancellation checks).
  Projected aggregate admission now rejects before allocating update entries or
  iterating the range (one initial cancellation check), retains the existing
  workbook-storage diagnostic, counts detached-sheet storage and subtracts
  overwritten cells. A positive full-capacity overwrite case passes.
- Fresh checks after final capacity/sign repairs: all 582 tests in 40 files pass
  (3.06 s), all 16 independent cases pass (17 ms), clean package lint exits 0,
  and the selected uncached workspace build exits 0.
- Repeated-sign regressions ++A1 and --A1 originally entered formulas. Released
  `src/parse-util.c` lines 773–806 requires `c0 != c[1]` for signed expression
  introducers; both now remain literal strings. This is source-backed behavior,
  not a separately measured native differential entry.
- Followup native entries from `out/ssconvert-updates/observations.json` exposed
  eight further failing regressions before repair: whitespace-surrounded boolean
  stays text; comma-grouped 1,234 becomes 1234; $12 becomes 12 with native currency
  format `$#,##0\_);[Red]($#,##0)`; 1/2/2024 becomes 45293 with `m/d/yyyy`format;
+A1, -A1 and @A1 enter formulas; and an undefined formula name adds a workbook
namespace placeholder with expression`#NAME?`. Currency/date formats were
checked in captured XLSX `xl/styles.xml`and the Unknown namespace entry in`xl/workbook.xml`, rather than inferred from display values.
- All twelve independent cases pass after these repairs. Error constants are
  parsed as spreadsheet errors so the namespace placeholder evaluates to #NAME?
  while preserving its namespace effect and original workbook ownership.
- Final followup checks: all 578 package tests in 40 files pass (fresh maintained
  package run, 3.11 s), package lint exits 0 without warnings, and the selected
  workspace build with `--no-cache` exits 0.
- Regression reproduced: a formula with 100,000 additive terms reached
  `RangeError: Maximum call stack size exceeded` during recursive AST traversal.
  The failing assertion expected `SsconvertError` with `resource-limit` and the
  existing formula-depth diagnostic. AST-height admission now bounds flat binary,
  postfix/unary and function-call trees at the existing depth limit of 128.
- All four independent cases pass; the repaired stress file completes in about
  12 ms. Original source workbook values remain unchanged.
- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache` passes.
- Initial `npm run lint --workspace=@poe-code/ssconvert` exited 0 with seven
  unused-variable warnings in merge-clearing/cache-clearing destructures. Renamed
  discarded fields to the maintained `ignored` convention; no rules were disabled.
- Initial maintained package unit run: 568 pass, one fails in the concurrent
  root-owned merge regression because its fixture contains reference records
  rejected by the existing merge capability. Root notified; final verification
  required rerunning after that repair. Root corrected the fixture to a plain
  workbook, preserving the existing unsupported merge-reference boundary. The
  fresh package rerun passes all 569 tests in 40 files, including all four
  independent cases.
- Root unit selector `npm test -- --workspace=@poe-code/ssconvert --no-cache`
  rejects `--workspace`; this was an invocation failure, not test evidence.
  The maintained scoped route is `npm test --workspace=@poe-code/ssconvert`.

## Remaining limits

The eight followup entries above have native evidence; the initial resource/cache
stress cases independently exercise implementation invariants. This is not broad
native parity evidence. Whole-row/column formula
relocation, reversed formula-range endpoints, 3D formula relocation, cross-sheet
named-expression relocation and malformed-formula grammar beyond the captured cases were not measured
against native here. Existing calculation intentionally rejects functions other
than SUM, text coercion and circular calculation rather than inventing results.
Fractional/signed/trailing currency patterns, locale alternatives, other date
grammars, malformed grouping and formula-introducer edge cases beyond the captured
entries are unmeasured. Mid-execution cancellation, calculation across a very
large dependency graph and every resource-budget boundary remain outside these
independently verified
cases. Those unmeasured/unsupported cases are not passes.
