# csvkit 2.2.0 behavioral audit

This is a research specification for the fourteen original executables, not a
JavaScript implementation or a compatibility pass. This pass changes only new
documentation. Existing parser/product files, reference captures, plans, README
content and staging remain outside this pass's ownership.

## Authority and evidence

The independently downloaded PyPI archive matches SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
All 209 existing source-manifest records match extracted bytes. Dependency
archives were independently downloaded from the URLs in
[reference-requalification-20260917.json](reference-requalification-20260917.json)
and required to match their recorded hashes before inspection.

The frozen reference remains
[reference-profile.json](reference-profile.json) and the two hash-locked
requirements files. Native parser observations in this pass use those closures,
CPython 3.14.2 and 3.9.6, locale C, timezone UTC, UTF-8 pipe stdio, 80 configured
columns and the explicitly enumerated environment. The 2.2.0 changelog drops
3.9 support: 3.9.6 is an unsupported diagnostic comparison, even though these
observations run. Neither profile measures TTY, SIGPIPE or live network drivers.
No assumption about current date follows from UTC.

Evidence is separated by role:

- [parser-contract-audit-20260917.json](parser-contract-audit-20260917.json): two
  actual parser captures, all aliases, actions, defaults, arities, types, choices,
  groups, required values, overrides and usage. All 415 action applications per
  profile were compared with the preliminary register for aliases/actions/arity,
  constants/requiredness/metavars/help. Encoding and quoting differences are
  retained explicitly.
- [source-flow-audit-20260917.json](source-flow-audit-20260917.json): 20 required
  source files, ordered statement trees for mains and helpers, control constructs,
  diagnostic/exit/raise expressions and source hashes. There are 158
  `add_argument` calls and one `set_defaults` call; no explicit argument-group or
  mutually-exclusive-group declarations. The observed positional/options groups
  are argparse's defaults. Semantic mutual exclusions occur in mains.
- [documentation-audit-20260917.json](documentation-audit-20260917.json): all
  fourteen command RST references, fourteen shipped manpages, common arguments and
  the complete changelog. Option mentions are lexical review leads, including
  examples for other commands and roff fragments, not parser declarations.
- [service-register-20260917.json](service-register-20260917.json): eight formats,
  thirteen statistics plus count, four JSON path families, Python modes, shipped
  SQL driver adapters and source excerpts for relevant Agate/reader/SQL behavior.
- [test-dispositions-20260917.json](test-dispositions-20260917.json): individual
  qualified source declarations, decorators, file hashes and named blockers.
- [operation-observations-20260917.json](operation-observations-20260917.json):
  36 isolated native observations with exact argv, input/output bytes, diagnostics
  and status. These examples do not replace upstream test dispositions.
- [material-notices-20260917.json](material-notices-20260917.json): complete
  license/notice/author material found in authenticated dependency sources,
  including notices required by the research excerpts.

Source locations below refer to paths inside the authenticated csvkit archive,
unless a dependency is named. Retained AST/source excerpts permit review after
owned scratch sources are removed. The manual procedure is
[csvkit-feature-audit-qa.md](../plans/csvkit-feature-audit-qa.md).

## Shared grammar and applicability

Every command preserves its own executable name; there is no `csvkit COMMAND`
grammar. All declared options are argparse-optional (`required=False`). Operand
requirements and option dependencies are often enforced later. Scalar store
options use the last occurrence; boolean actions set their constant rather than
toggling. Only append actions accumulate. Long-option abbreviation is enabled;
default argparse help/version exit immediately during parsing. Eager FileType
conversion can fail before a later names/help action; lazy input opening differs.

Common scalar defaults are `delimiter/quotechar/quoting/escapechar/maxfieldsize`
unset, doublequote true, skipinitialspace false, skip-lines 0, locale en_US,
date/datetime format unset. Other common booleans are false. Input encoding is
`PYTHONIOENCODING` when present, otherwise utf-8-sig (`cli.py:207`); this pass's
frozen environment measures utf-8, whereas the preliminary parser register
records utf-8-sig. These are two different environment conditions.

`--null-value` is store with `nargs='+'`, default empty list, **not append**
(`cli.py:220`). Repetition replaces the earlier list. `--blanks` clears Agate's
default null spellings before the surviving explicit values are added. Type
inference defaults to Boolean, Number, TimeDelta, Date, DateTime, Text; explicit
date/datetime formats reposition Number, and csvformat output quoting 2 restricts
the candidates to Number/Text (`cli.py:352`). No-inference still uses Agate Text
null conversion. Raw paths do not apply typed null conversion automatically.

| Command | Shared override tokens | Operand and command-specific applicability |
| --- | --- | --- |
| csvclean | L, I | Optional FILE; raw checks/fixes, no locale/inference options |
| csvcut | L, I | Optional FILE; raw selectors and names |
| csvformat | I | Optional FILE; locale retained for output quoting 2; --zero accepted without a selector |
| csvgrep | L, I | Optional FILE; match file eagerly opened; raw selectors/filter |
| csvjoin | f | FILE* defaults to `['-']`; typed inference and explicitly declared sniff/no-inference |
| csvjson | none | Optional FILE; raw streaming or typed table, geo dependencies in main |
| csvlook | none | Optional FILE; typed rendering with load-time row limit |
| csvpy | l, zero, add-bom | Optional FILE syntactically; stdin rejected in main; reader/dict/table |
| csvsort | none | Optional FILE; names or typed stable ordering |
| csvsql | f | FILE* defaults to `['-']`; DDL/database/query paths |
| csvstack | f, L, I | FILE* defaults to `['-']`; raw stack; -n means group-name |
| csvstat | none | Optional FILE; names/count/typed metrics/report paths |
| in2csv | f | Reintroduces optional FILE; -f selects format; per-format options below |
| sql2csv | f,b,d,e,H,I,K,L,p,q,S,t,u,z,zero,add-bom | Reintroduces optional SQL FILE, -e and output -H; only common verbose/linenumbers/version remain |

Exact syntax/defaults/choices for every command-specific option are in the parser
capture. csvsql `--engine-option` appends pairs, `--query` appends single values,
and `--prefix` appends expressions. sql2csv appends engine/execution pairs; its
execution defaults already include `no_parameters=True, stream_results=True`.
`parse_list` applies Python literal_eval, catches only ValueError, and overwrites
duplicate keys; malformed literals raising SyntaxError remain errors
(`cli.py:586`). A JavaScript implementation must specify this safe literal
language, not use eval or silently accept a different value grammar.

Tabs overrides input delimiter. csvformat ASV overrides output tabs, delimiter
and terminator; output tabs otherwise overrides output delimiter. CSV quoting
choices come from runtime `csv.QUOTE_*`: 0–5 on 3.14.2, 0–3 on 3.9.6. Help prose
continues to describe only 0–3. Input character/field-limit validation is partly
deferred to CPython's CSV implementation, rather than all happening in argparse.

`run` creates shared input before BOM emission, emits BOM before main validation,
suppresses the named no-header warning and closes common input in finally
(`cli.py:125`). LazyFile strips NUL only on iteration, not delegated bulk reads.
Compressed text openers select case-sensitive outer .gz/.bz2/.xz and optional
.zst; Excel opens binary separately. Stdin reconfiguration, lazy filename access,
current stream state and physical CSV line numbers are observable. Default Agate
Writer uses LF and normalizes embedded CR to LF; raw DictReader/DictWriter paths
retain their own stdlib behavior. Reader's synthetic header is `line_numbers`,
while Writer's is `line_number` (Agate `csv_py3.py`). These are not interchangeable.

Without verbose mode, the installed exception handler emits `TYPE: message` on
stderr, with a special decoding diagnostic; verbose delegates to CPython's
original traceback handler (`cli.py:328`). Parser errors use status 2; uncaught
exceptions and csvclean reported errors use status 1. Exact traceback paths,
warnings, closed-stream errors and platform signals remain profile-dependent.

## Ordered command contracts

**csvclean (`utilities/csvclean.py:49`).** TTY waiting notice precedes validation.
No enabled check/fix is an error; join-short and fill-short conflict next. Build
RowChecker, resolve label (`-` means stdin or filename), emit cleaned header/rows,
then emit error CSV and exit 1 if any errors remain. Label/omit/separator/fillvalue
alone do not enable a check/fix. RowChecker uses physical line_num minus one,
counts empties only across data rows and reports file-level empty columns at line
1. Omit tests row length, rather than every possible check. Joining can remove
previous errors after their rows were already emitted; earlier output is not
retracted (`cleanup.py`). Fill mutates the same row captured by a potential error.

**csvcut (`utilities/csvcut.py:39`).** Names is an early return; otherwise get raw
header and selected IDs, write selected header, pad short rows with None, ignore
surplus fields and drop empty selected rows only when -x. Selection preserves
duplicates/order. Empty input yields a blank output record. Integer-looking names
are positions; first duplicate name wins; no blanket whitespace trimming of
selectors. Inclusion/exclusion range end defaults differ, and unknown exclusion
names are ignored. Invalid range text contains an unexpanded `%s` (`cli.py`).

**csvformat (`utilities/csvformat.py:71`).** Construct output writer, then choose
typed loading only for output quoting 2. Typed loading can normalize headers and
infer numeric cells; -E suppresses its header. Other quoting modes use raw rows;
-H peeks a row and synthesizes letter headers, then -E consumes that generated
header. Empty/no-header and skip-header exhaustion can raise StopIteration.
Out-ASV uses US/RS; -M is an arbitrary string despite help saying character.

**csvgrep (`utilities/csvgrep.py:41`).** Names precedes missing column/pattern
checks. Require truthy columns; require at least one non-None regex/string/file.
Move linenumbers from writer to reader, resolve selectors, choose nonempty regex,
else matchfile, else string. Matchfile lines use full rstrip, not just newline
removal. Falsey dictionary patterns are removed in standardization (`grep.py`):
an empty string therefore matches every row in all-match mode and no row in
any-match mode. Regex uses search, not full match. Missing cells become empty
text; inversion operates on the complete all/any result. Always emit original
header; no matching rows is successful header-only output.

**csvjoin (`utilities/csvjoin.py:45`).** Reject implicit TTY stdin, create lazy
inputs, parse/strip join-key strings, replicate one key, validate key count,
require keys for outer modes, then reject left+right. Load and close all typed
tables before matching keys. Key matching calls the helper without --zero offset,
so --zero does not change these numeric join keys. Precedence is left, right,
outer, keyed inner, unkeyed sequential full outer. Right starts at the last file
and folds backwards. One-file output still goes through typed loading/writing;
the help's “copied” is not a byte-copy guarantee. Agate join null-key/cardinality/
column-renaming semantics are dependency gates.

**csvjson (`utilities/csvjson.py:57`).** Validate lat/lon pairing, then crs/type/
geometry dependencies, then key+stream restriction. True streaming requires
stream AND no-inference AND sniff=0 AND no skip-lines (`can_stream:103`). The
other --stream invocations load a whole typed table and only serialize newline
objects. Both streaming paths consume the first row as actual column names even
under -H. Raw NDJSON pads missing cells with null and ignores surplus cells;
duplicate keys overwrite in encounter order. Raw NDGeoJSON directly indexes
coordinate cells and can fail on short rows. Typed JSON uses Agate's array/key/
newline serializers; GeoJSON uses a different Decimal-as-string fallback.
Geo features omit None and falsey properties, use key as ID, and may decode a
geometry column. `--type` identifies an excluded column but does not determine
point geometry in geometry_for_row. Zero longitude/latitude produces null
geometry; collection bbox may then raise TypeError. Newline geo output contains
features only, without collection crs/bbox. Nonstream implicit TTY input errors;
true streaming prints the waiting notice instead.

**csvlook (`utilities/csvlook.py:37`).** Reject implicit TTY input. Preserve Agate
default precision 3 by omitting max_precision unless explicitly provided; None
has a different library meaning. No-number-ellipsis mutates global Agate config.
max-rows is both table loading row_limit and display limit, affecting inference.
Line numbers enter the table loader. Print width/truncation/type formatting is
Agate behavior, not generic Markdown rendering.

**csvpy (`utilities/csvpy.py:34`).** Reject actual stdin, set optional global
number ellipsis, force lazy file opening through `.name`, then choose --dict
before --agate before ordinary reader. Dict/raw skip physical lines; Agate gets
typed sniff/skip settings. Bind the actual object as reader or table. Attempt
the legacy IPython.frontend.terminal.embed import; on ImportError anywhere in
that try block use code.interact with the object namespace. IPython presence
alone does not guarantee this old import succeeds. Neither interactive mode was
executed; a JavaScript prompt or placeholder table would not qualify it.

**csvsort (`utilities/csvsort.py:45`).** Names first, then TTY input validation,
typed loading, selector resolution, optional ignore-case key, stable Agate
order_by, CSV writing. Ignore-case uses Python upper(), with NullOrder for None;
it does not use casefold, locale collation or JavaScript's default string sort.

**csvsql (`utilities/csvsql.py:100,171`).** TTY rejection first; initialize names
and constraints; query without connection supplies memory SQLite and insert.
Validate dialect versus db/query, insert versus connection, no-create/create-if/
overwrite/hooks/chunk dependencies, overwrite+no-create, then no-create+create-if.
Chunk dependency is truthiness-based: zero bypasses it. Create lazy files, create
engine/connect before CSV loading, and enter the failsafe finally only afterward.
Begin one transaction, load each table (StopIteration skips it), derive table name
from supplied list/filename/stdin, run before hooks, table DDL/insertion, after
hooks. Query values naming existing files are read as files; split on the literal
delimiter, not SQL parsing. Ignore blank final-query pieces and output only the
last result when it returns rows. All-blank queries leave rows=None and fail.
Commit follows result writing; close files/connection/dispose in finally. Initial
engine/connect failures precede that cleanup scope. DDL-only compilation does
not forward min-col-len/col-len-multiplier even though both are accepted options.

**csvstack (`utilities/csvstack.py:43`).** TTY notice, grouping validation (filenames
overrides groups), group-name fallback, raw reader choice. First pass unions
headers in encounter order; no-header instead sizes from first input only and
breaks. Retain consumed stdin header or first row, reopen ordinary files for
second pass, emit output header, prepend groups to ordinary rows. The replayed
first no-header stdin row is emitted before grouping, so it lacks the group
cell. Non-stdin no-header first rows are reread normally. DictWriter behavior for
extra/missing keys, duplicate headers and grouping-name collisions is a gate.

**csvstat (`utilities/csvstat.py:151`).** Names first, TTY rejection, reject multiple
metric flags, then metric+csv/json/count conflicts in that order. Count reads raw
rows and subtracts a header even on empty input, yielding -1. Otherwise typed
load/select, truthy frequency-limit override, then single metric or report.
CSV wins over JSON selection, but json_output still affects metric formatting.
Metric calculation suppresses null warnings and catches any Exception per metric;
failed metrics disappear from reports or appear as None in single output.
Report IDs and labels use column_id+1 even with --zero. CSV stats use their own
DictWriter without shared writer kwargs; JSON Decimal converts to float and
durations to seconds. Text Decimal uses locale percent formatting then strips
trailing zeroes and literal '.', including the quirks of user-supplied formats.

**in2csv (`utilities/in2csv.py:87`).** Select explicit format, else schema=fixed,
else key=json, else outer filename inference. Names validates Excel and returns
before schema/normal conversion. Select binary Excel or common text input; open
schema whenever supplied, even for other formats. Fixed without schema raises
ValueError. CSV raw fast path requires no-inference, actual header, no skip-lines,
sniff=0. Convert/write ordinary result before optional sheet side outputs; reopen
input, parse write-sheets digit strings as indices, derive output names from input
base plus sheet name or enumeration index. --sheet remains a string, so numeric
--sheet selects a name rather than an integer index. --write-sheets on non-Excel
is not validated as a parser error and can fail after stdout. Close resources
at the end, without a main-wide finally. XLS/XLSX stdin bytes are cached per
utility for reopening. Side outputs require injected VFS write authority.

**sql2csv (`utilities/sql2csv.py:54`).** Reject implicit TTY only without truthy
query. Create/connect engine before reading query. Truthy --query overrides FILE/
stdin and is stripped; empty --query falls back to input. Otherwise iterate query
lines (LazyFile's NUL removal applies), close input, apply execution options,
execute one driver SQL string, create writer and emit header unless -H only if
result returns rows. Close/dispose after writing; no encompassing finally or
explicit commit. Transaction behavior is therefore the frozen SQLAlchemy/driver
behavior, not an assumed autocommit contract. Default connection is sqlite://.

## Format and statistic services

| in2csv format | Settings actually forwarded and boundary |
| --- | --- |
| csv | reader kwargs, sniff, skip_lines and column_types; optional raw fast path |
| dbf | filename only to agatedbf; common encoding/inference/null/skip settings are not forwarded; DBF decodes fields/codepages and memo files through dbfread |
| fixed | schema, skip_lines; converter ignores column_types/shared writer kwargs, slices Unicode start:length and strips cells |
| geojson | converter loads full ordered FeatureCollection; no typed inference/header/skip/shared writer settings; property union, geometry/type/lon/lat columns |
| json | Agate from_json key plus column_types; no skip/header/dialect settings |
| ndjson | Agate from_json newline=True, key plus column_types; name does not imply streaming table construction |
| xls | header, skip_lines, column_types, sheet, encoding_override; xlrd cached cells, first sheet, OLE Workbook fallback |
| xlsx | header, skip_lines, column_types, sheet, tri-state reset_dimensions; openpyxl read_only/data_only cached values, active sheet |

Guessing recognizes csv/dbf/fixed/xls/xlsx and json/js; any name with no period
means fixed. ndjson/geojson and compressed outer extensions are not inferred
(`convert/__init__.py`). Fixed schema requires literal column/start/length labels,
first start=1 makes all starts one-based, and schema row errors include physical
schema line. GeoJSON requires root object/type=FeatureCollection/features; a null
properties value is not the same as missing properties. Nested OrderedDict
properties are JSON strings; Point altitude is dropped. No silent robustness
improvements are specified.

XLS reader maps cell types, normalizes mixed columns to Text, converts booleans/
dates, and lets supplied column_types override inferred Excel types. XLSX detects
A1:A1 dimensions automatically only when reset_dimensions is None; the CLI
default is None, not false. It applies its own datetime normalization and closes
the file. Reader details and source hashes are retained in the service register.

| csvstat operation, in output order | Source computation |
| --- | --- |
| type | Agate data type class name |
| nulls | HasNulls |
| nonnulls (--non-nulls) | Count(column), excludes None |
| unique | values_distinct length, includes distinct None |
| min / max | Agate numeric/date/datetime/duration extremum, excludes None |
| sum | Agate Number/TimeDelta sum, excludes None |
| mean | Agate sum/non-null length for Number/TimeDelta |
| median | Agate 50th percentile for Number |
| stdev | Agate sample variance sqrt; divisor n-1 |
| len | Agate MaxLength on Text |
| maxprecision (--max-precision) | Agate Decimal precision utility on Number |
| freq | Counter(values).most_common, default five, includes None and preserves encounter ties |

`--count` is the fourteenth selector but a separate raw path, not a fourteenth
OPERATIONS entry. Empty/all-null/singleton/nonfinite/type-inapplicable metrics
need separate regressions; catching an aggregation exception is not an arithmetic
pass. Decimal context, Python equality/hashing, temporal types, locale formatting
and JSON float conversion remain exact dependency contracts.

## SQL baseline, drivers and external plugins

The CLI's shipped DDL choices are exactly mssql/mysql/oracle/postgresql/sqlite,
plus generic DDL when no choice is given. SQLAlchemy also ships adapter modules
for DBAPI packages; their source inventory does not establish installed drivers.
The service register retains each import_dbapi hook and driver declaration,
including inherited connector hooks, asynchronous adapters, alternate SQLite
drivers and MariaDB adapters. Shipped default bindings resolve to pyodbc for
MSSQL, mysqldb for MySQL, cx_oracle for Oracle, psycopg2 for PostgreSQL and
pysqlite for SQLite; only the latter's stdlib driver is installed in these profiles.
Those adapters are shipped dependency material, whereas sqlalchemy.dialects entry
points are separately installed third-party plugins. The frozen profiles have no
external dialect entry points, no optional network DBAPI drivers and no IPython
or zstandard. An optional profile needs exact versions/artifacts/service behavior;
arbitrary plugins cannot be exhaustively promised by this baseline audit.

Agate-sql chooses SQLite FLOAT, MSSQL BIT/DATETIME, PostgreSQL/Oracle intervals,
generic DECIMAL/TIMESTAMP/BOOLEAN otherwise; constraints compute nullability,
MySQL lengths and selected numeric scale/precision. Its maps also reference
crate/ingres, which are not the shipped csvsql dialect choices. These names are
extension-aware source branches, not additional baseline services. Separate DDL
compilation, engine resolution, driver availability, SQL transaction semantics
and deployed database QA. The source's advertised driver installation advice
does not authorize installing product-native drivers or reading ambient secrets.

Future product capabilities must explicitly bind filesystem, network, database,
clock/locale/terminal and interactive interpreter resources. No subprocess,
native csvkit or Python fallback is allowed. Host capability refusal is a named
observable divergence, not a successful compatibility test.

## Documentation reconciliation and provenance limits

All fourteen RST references and fourteen manpages were inspected alongside their
source main/parser paths. Much common-flag prose is intentionally delegated to
common_arguments, so a long option absent from a per-command document is not
automatically stale. The following concrete discrepancies must be retained:

- Common/command usage blocks continue to show quoting 0–3. The 2.0.0 changelog
  explicitly records 4/5 support; observed 3.14.2 parsers accept both.
- common_arguments omits --add-bom and describes repeated --null-value without
  documenting replacement. Native parser observation confirms only the last list.
- csvclean synopsis omits its checks/fixes and shows an older description; its
  output prose overstates omit-error-rows as applying to every selected check.
  Its `[ csvclean ... ]` shell examples are test-command expressions, not actual
  execution of csvclean inside a conditional.
- csvcut truncation/exclusion documentation matches current source; the
  preliminary help does not mention unknown exclusions though the reference
  prose and 2.1.0 changelog do. Its source history/fork credits remain relevant.
- csvformat preserves ASV precedence; escape help refers to --quoting for output
  and the empty quotechar prose is paired with an emoji example. Follow actual
  argv/source rather than repairing these examples silently.
- csvgrep's “one pattern required” note has a names-mode exception. Matchfile
  prose says stripped line separators but implementation strips all trailing
  whitespace. Its no-match status remains successful, unlike Unix grep.
- csvjoin “copied” one-file description still entails type inference. Its --zero
  acceptance does not change numeric join-key matching in main.
- csvjson example retains null properties, duplicate crs and older ordering;
  current source omits None/falsey properties. --stream does not alone establish
  true input streaming. The example's --k works as argparse abbreviation of --key.
- csvlook's load-time max-rows behavior is established by source and the 1.4.0
  changelog, beyond its “display” option prose. Preserve precision/default rules.
- csvpy synopsis includes removed -l/--zero and examples bind Agate as reader;
  current source binds table and excludes those flags. “IPython if installed”
  depends on the legacy import path. The 1.4.0 changelog spells --sniff-limit,
  whereas current accepted spelling is --snifflimit.
- csvsort ignore-case uses upper; the 1.5.0 changelog's --i/--A spellings refer
  to actual short -i/-A, not new long options.
- csvsql --unique-constraint help says “column-separated”, implementation splits
  commas. Literal delimiter splitting does not respect SQL quoted semicolons.
  Its synopsis still lists firebird/sybase, while the option block additionally
  lists duckdb/crate/ingres; none is in this frozen profile's five choices.
  Hooks do require insert through current main validation. Length-multiplier
  options affect to_sql, but are not passed to DDL-only create compilation.
- csvstack help restricts group-name to -g, but source also uses it with filenames.
  Grouped no-header stdin first-row replay lacks grouping. The 2.2.0 empty-file
  fix is current; older all-tools-empty claims are not universal guarantees.
- csvstat help offers both csv/json without declaring argparse exclusion; main
  gives CSV output precedence while retaining json_output's formatting effect.
  Count on empty header-mode input remains -1. --zero does not change report IDs.
- in2csv documents cached XLS/XLSX differences and dimensions; format guessing
  still cannot infer ndjson/geojson/outer compression. --write-sheets applicability
  is not guarded by parser validation. --no-inference is applied beyond CSV via
  column_types even though option prose mentions CSV.
- sql2csv synopsis omits newer engine/execution options present in its option
  prose/source. Empty --query does not override input. 2.1.0 stream_results is
  accurately reflected in the explicit execution defaults; actual driver
  streaming still requires driver/service evidence.

CHANGELOG is historical context: removed csvclean file outputs/dry-run/default
repairs, older headers/sorting, Python-2 rounding, past dateutil dependencies and
old reader classes are not 2.2.0 requirements. Windows expansion applies source
glob/user/env behavior and needs a separate platform profile; Darwin observations
do not qualify it. Full operation warnings, source-path verbose traces, terminal
rendering/interpreter sessions and driver-dependent errors remain unknown.

## Test disposition and licensed material

The census reauthenticates all 13,877 preliminary declarations and expands to
14,817 declarations in 394 files across 22 source distributions (csvkit plus 21
dependency archives, including both slugify versions). Entries include the enclosing class/function, line,
decorators and named blocker; no original canonical or upstream-operation QA
mapping is credited by this research pass. SQLAlchemy's broad census includes
unreachable APIs and nested test-prefixed helpers. Static source declarations are
not unittest/pytest execution counts; inherited cases, factories, parametrization
and missing test archives remain explicit collection blockers. Native examples
are recorded independently, without declaring the corresponding source tests
passed or changing prior blocker history.

Full reader tests for openpyxl 3.1.5 and xlrd 2.0.2 are absent from their pinned
source distributions; obtain matching authenticated upstream test archives before
claiming complete dependency-case qualification. Other source families with no
test declarations likewise have no implied pass. Relevant Agate/Excel/DBF/SQL
cases are included, alongside a deliberately broad transitive census whose
reachability remains unqualified.

Complete notices for reused research excerpts are retained in the material
inventory. No product source was ported in this pass and no new product dependency
was selected. Future substantial source/test/doc reuse must preserve the relevant
copyright, permission and special notices; reference acquisition alone grants no
waiver. csvcut credits its original fork authors; Windows expansion credits Click,
whose upstream notice requires separate acquisition if that material is ported.
Existing packages/csvkit/LICENSE was left untouched. Reference runtime licenses
are not a blanket license for a future JavaScript engine/driver/workbook package.

The research audit is complete within its declared static-source and 36-example
scope. JavaScript operations, safe-bash registration, full original regressions,
reader corpus qualification, database services and interactive Python behavior
remain implementation/qualification work, not accomplished by these artifacts.
