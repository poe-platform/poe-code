# Reduced csvkit findings, September 19, 2026

Full csvkit 2.2.0 compatibility, repository acceptance and delivery are incomplete.
This reduction performed read-only Git/file inventory, parsed the existing JSON
ledgers and recomputed the candidate digest. It did not rerun runtime tests,
builds, native comparisons or screenshots. Check results below are recorded
results, not newly executed checks. No product code or README changed.

The current 228 domain/binding TypeScript source/test files reproduce the latest
audit's sorted compact `{path,sha256}` digest:
`d3361297edd38b600266434c685b7bbc37801819b21bed071be8e62041fb694d`.
This authenticates that scoped candidate, not all repository inputs or a release.

## Exact scope and completed work

The [latest audit](current-user-edge-audit.json) and
[execution record](current-user-edge-validation.md) retain exact denominators,
inputs, profile identities and exclusions.

- Names: csvclean, csvcut, csvformat, csvgrep, csvjoin, csvjson, csvlook, csvpy,
  csvsort, csvsql, csvstack, csvstat, in2csv and sql2csv. Public descriptor and
  registered Shell inventories match all fourteen. All 28 help/version paths
  match frozen native channel bytes/status. The root bash CLI/SDK has no csvkit
  binding; operational Shell coverage requires explicit plugin capabilities.
- Parser/SDK inventory: 23 common and 135 local argument calls, one separate
  sql2csv defaults override, fourteen implicit help actions, 415 expanded
  actions, 387 operational SDK action instances, 28 informational actions via
  execute(argv). Zero omissions is established for these inventories only.
- Input formats: CSV, DBF, fixed, GeoJSON, JSON, NDJSON, XLS and XLSX. Inventory
  presence does not qualify all inputs. Per-format cases remain in the
  individual `in2csv*-validation.md` records and associated reference JSONs.
- csvstat metrics: type, nulls, non-nulls, unique, min, max, sum, mean, median,
  stdev, len, max-precision and freq; names and count are separate. Recorded
  cohorts cover six inferred types and report/scalar/CSV/JSON serializers;
  arbitrary Decimal/locale behavior remains unqualified.
- Reader differential: 9,331 inputs each through direct and physical-line
  readers. Empty input and lengths 1–5 over `a`, comma, quote, backslash, LF and
  CR; CPython 3.14.2 stdlib csv.reader, newline=None, backslash escape, isolated
  pipe profile, C/UTC/UTF-8. Cells and line numbers match. This does not measure
  arbitrary lengths, sniffing, encoding or numeric quoting.
- Registered workflows: argv pipelines, VFS scripts, quoting/expansion,
  PIPESTATUS, redirection, TSV/ASV, join/stack, raw JSON, typed stats, named/dash
  XLSX and side effects, injected SQLite and csvpy reader sessions. Exact cohort
  membership and 18 additional round trips are retained in
  [workflow/stress coverage](user-stress-validation-20260919.md).
- Optional interoperability: [43 heterogeneous records](optional-profile-interoperability-verified-20260919.json)
  contain 35 exact=true and three exact=false records. The five without exact
  are SQLite export/import observations, database byte effects, optional
  availability and candidate identity; they are not five automatic passes or
  five automatic unmeasured cases. Thirty XLS/XLSX/DBF conversion transcripts
  match, as do gzip, csvpy reader/dict and recorded SQLite persistence cases.
  Individual argv/input/effect hashes and three parameter replays remain in
  that file. These overlapping cohorts must not be summed as unique coverage.

## Recorded checks

| Maintained command/route | Latest recorded outcome | Limits |
| --- | --- | --- |
| `npm run build` | Pass | Workspace closure and root suffix stages |
| `npm run test --workspace=@poe-code/csvkit` | 104 files, 4,426 passes | Five TODO excluded |
| `npm run lint --workspace=@poe-code/csvkit` | Pass | ESLint and source/test types |
| `npm run lint` | Pass | Maintained ESLint/type/workflow routes; two warnings, no guard gaps |
| `node --test packages/safe-bash/scripts/integration-inputs.test.mjs` | 109 passes | Discovery assertions only |
| Maintained safe-bash runner/type routes | 536 runner passes; types pass | Types are not runtime qualification |
| Focused actual-Shell workflow/lifecycle cohort | 42 passes, one TODO | Exact membership in linked execution record |
| `npm test` | Exit 1 | Shared phase: 133,895 passes, two skips, five TODO; safe-bash: 41,705 passes, 24 failures, 823 skips, two TODO; subsequent stopped tasks unmeasured |
| Ad hoc screenshots | Three latest captures reviewed | Bounded tables/stats/errors/refusals and root bash help; not exhaustive visuals |

`SAFE_BASH_TEST_RG` is an optional executable profile, not a filename selector.
Historical command-family globs and focused node/tsx cohorts have their own
membership; they cannot replace the maintained repository gate.

## Failed, divergent and unmeasured cases

1. Repository gate: two archive-authority checks fail with `committed build input
   differs from reviewed authority: scripts/build.mjs`; 22 public-cleanup setups
   fail with `Unadmitted peer public route: @e965/xlsx`. Both were independently
   reproduced. Remaining workspace tasks stopped by this gate are unmeasured.
   No authority/dependency guard was weakened or preserved edit reverted.
2. Measured optional mismatches: bzip2 and xz compression and csvpy Agate Table
   interaction. Explicit capability refusals are not native-compatible passes.
3. Complete frozen optional installation is unqualified: Babel, csvkit,
   python-slugify and xlrd installed-file manifests drift; pip is missing.
   Primary recorded profile is CPython 3.14.2 / Agate 1.14.2 / SQLAlchemy 2.0.54 /
   Babel 2.18.0, CLDR 47, Unicode 16, C locale, UTC, UTF-8, 80 columns, Decimal
   precision 28/half-even. CPython 3.9.6 is a separate historical reference,
   not a selectable second product runtime. A stable optional probe does not
   resolve frozen identity drift.
4. Real mssql/mysql/oracle/postgresql driver/service and external dialect
   profiles remain unqualified. SQLite evidence is injected WASM/VFS evidence.
   zstandard, IPython, genuine TTY/SIGPIPE/buffering, deployed remote/real-root
   filesystem profiles and performance are unmeasured or unavailable.
5. Quoting 2/4/5 has bounded all-string support; numeric/null operation cells
   remain divergent. Native numeric-cell and unavailable `/dev/fd` cases remain
   TODO. Five alternative stdout-encoding TODOs remain unqualified. Wider codec,
   Python regex/warning, Decimal power/nonzero variance, surrogate SQL literal,
   temporal/locale, workbook allocation/preemption and verbose traceback
   provenance gaps retain their individual qualification records. Full Agate
   objects and arbitrary opaque host-work preemption are unqualified.
6. Visual coverage is bounded. Emoji renderer glyphs remain unavailable;
   cross-channel order is not proved by concatenated independent pipes. Sample
   injected locale formatters do not qualify arbitrary locale values. Complete
   fourteen-command/all-output-family visual coverage is not established.
7. Exhaustive attribution: [coverage.json](coverage.json) has zero qualified
   passes; 415 actions, 323 branches and 159 parser declarations unresolved;
   394 upstream files, 14,817 test declarations and 52 assignments retained.
   Exhaustive failed/divergent counts and whole-feature unknown omissions are
   unmeasured, not zero. The [qualification register](qualification.md),
   [implementation history](implementation-status.md), individual validation
   files and structured source/disposition registers preserve every recorded
   case; this reduction does not replace them or assign missing case credit.
8. Failed/incomplete attempts remain excluded: incorrect defaults repr/object
   comparison; bounded research/source-inventory admission failures; missing QA
   formatter/Python limits/cat bindings and wrong helper imports/flags; overlapping
   builds removing generated inputs; incomplete guard receipts; interrupted
   broad runs; concurrent SafeJS replay timeouts and prior consumer timeout.
   Isolated unchanged controls passed, but do not make those broad attempts pass.
   Details remain in the current, optional, terminal and
   [visual/integration records](visual-and-integration-validation-20260919.md).

## Scratch and delivery

This reduction created no scratch evidence and deleted none. Existing `out`
artifacts were present before this turn; ownership was not established, so they
were preserved. Earlier reports record their own reductions/purges separately.

No staging, local commit, push, remote-main delivery verification or release
publication occurred in this reduction. These remain separate outcomes requiring
separate authorization; historical test passes are not delivery evidence.
