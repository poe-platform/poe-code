# Source-to-feature audit

The authenticated csvkit 2.2.0 source is the authority. The machine-readable
feature-register.json records the actual CPython 3.14.2 parser configuration
for all fourteen utilities: 415 action applications, 159 source declarations,
323 source conditions, 45 documentation/manpage/changelog inputs and 26
license/author inputs across the inspected source families. Action applications
include shared flags repeatedly applied to different commands; they are not 415
distinct product features. Python AST parsing reported no syntax errors.

The register retains positional/optional operands, per-command overrides,
groups, nargs, action classes, choices, types, defaults, consts, help and usage.
Declarations retain exact source locations, including parser defaults and groups;
conditions retain their original order/locations. Installed parser introspection
is research, not a product parser implementation.

## Test census and disposition

| Authenticated source family | Test-function declarations |
| --- | ---: |
| csvkit | 317 |
| Agate | 475 |
| agate-excel | 29 |
| agate-dbf | 1 |
| agate-sql | 18 |
| dbfread | 18 |
| Babel | 592 |
| parsedatetime | 80 |
| pytimeparse | 49 |
| SQLAlchemy | 12,298 |

All 13,877 declarations have source path, line, name, file hash, decorators and
an explicit blocker mapping, grouped by source file: no original JavaScript regression or operation QA
implemented. This is a deliberately broad source census, including SQLAlchemy
cases beyond csvkit's reachable API. Parameterization, dynamic factories and
fixture matrices are not expanded into execution counts. It is not a test run.
The inspected openpyxl and xlrd source archives do not expose test declarations
to this census; full reader dependency qualification remains a blocker rather
than a zero-case pass. Documentation inventories identify inputs; their hashes
do not by themselves prove every prose claim has been reconciled.

## Required behavioral register

| Utility | Observed source behavior requiring regressions |
| --- | --- |
| csvclean | No checks/fixes is parser error 2. Join/fill are mutually exclusive in main, not argparse. Output cleaned CSV before error CSV on stderr, then status 1. Row errors use physical line_num minus one. Joining may retract errors after already emitted rows; preserve this timing. |
| csvcut | Names mode precedes regular validation. Raw selection preserves duplicates, pads short rows, truncates surplus fields and optionally deletes empty selected rows. |
| csvformat | Raw pass-through except output quoting 2 uses typed tables. ASV overrides tabs/delimiter/terminator. No-header mode generates letter names; skip-header consumes an actual row. |
| csvgrep | Names mode precedes required column/pattern checks. Nonempty regex wins over match-file then string. Falsey string patterns can produce an empty pattern dictionary. Missing row cells become empty strings. Match-file rstrip removes trailing whitespace. No-match is successful header output. |
| csvjoin | Typed tables; one join key replicates across files. Left/right conflict is a main error. Left then right then full outer then inner then sequential precedence. Right folds files in reverse order; sequential joins request full outer behavior. |
| csvjson | True streaming requires --stream, --no-inference, snifflimit=0 and no skip-lines. Streaming takes its first row as headers even with common no-header settings; short rows pad null. Typed and raw Decimal/JSON paths differ. GeoJSON suppresses falsey properties and falsey zero coordinates; null geometry can fail bbox calculation. |
| csvlook | max-rows limits loading/inference as well as rendering. Agate default display precision is 3; explicit None has a different SDK meaning. Number ellipsis setting mutates reference global config. |
| csvpy | Rejects stdin. --dict precedes --agate. Lazy filename access forces opening. Standard code.interact and the legacy IPython import path are distinct modes, with session-owned actual reader/table objects. |
| csvsort | Typed stable ordering; ignore-case uses upper(), not Unicode casefold. NullOrder is distinct from empty text. Names mode is an early exit. |
| csvsql | Query without DB creates memory SQLite and enables insert. Main validates option dependencies before CSV reading, then establishes database validity before reading CSV. Table writes and final queries share one transaction. --query values naming existing files are read as query files. Only last nonblank query result is emitted. Before/after hooks occur per table even when help says insert is required. |
| csvstack | Raw DictReader header union, distinct multi-pass stdin handling, filenames override groups, group name defaults to group. No-header path examines only the first file and replays the first stdin row through a separate path. |
| csvstat | Thirteen ordered operations plus raw count. At most one operation; operation flags conflict with csv/json/count. count subtracts a header even for empty input. CSV wins over JSON when both are selected. Aggregation failures are swallowed per metric; report IDs remain one-based. Decimal text uses locale percent formatting followed by trailing-zero stripping. |
| in2csv | Explicit format precedes schema=fixed, key=json, then outer extension inference. Names is Excel-only. CSV raw fast path has four guards. Fixed/GeoJSON serializers bypass normal typed writer options. Sheet side outputs require reopening and filename-derived paths. DBF needs a filename; memo access is a separate filesystem operation. |
| sql2csv | SQL query flag overrides query file/stdin. -H controls output headers; -e defaults to UTF-8 query encoding. Engine/execution options use Python literal_eval semantics; repeated options overwrite by key. Only result-returning statements emit CSV. |

Shared selector quirks: integer-looking column names are positional identifiers;
range endpoints are integers, not names. Inclusion and exclusion open ranges
have different end defaults. Unknown exclusion columns are ignored. Invalid
range diagnostics contain a literal unexpanded `%s`. Letter headers use Agate
letter_name; typed deduplication does not apply indiscriminately to raw paths.

## Formats, operations and services

The shipped in2csv choices are exactly csv, dbf, fixed, geojson, json, ndjson,
xls and xlsx. Extension guessing additionally treats .js as JSON and a name
without any period as fixed; it does not infer ndjson or geojson by extension.
Fixed uses ordered column/start/length schema fields and Python Unicode slicing;
first start=1 makes every start one-based. GeoJSON requires FeatureCollection,
unions property fields in encounter order and serializes geometry separately.
DBF and cached-value Excel semantics require the actual reader dependency
profiles; generic workbook APIs do not qualify them.

csvstat operation order is type, nulls, nonnulls, unique, min, max, sum, mean,
median, stdev, len, maxprecision, freq. count is a separate early raw-row path.
Metric-specific null treatment, sample stdev, Decimal precision, Counter tie
ordering, locale formatting and JSON numeric conversion remain implementation
and differential gates.

SQLAlchemy shipped choices are mssql, mysql, oracle, postgresql and sqlite;
default generic DDL is a separate path. Both reference installs have no external
dialect entry points or optional network drivers. The source error advertises
psycopg2, mysql-connector-python and mysqlclient; absent drivers, installed
dialects and available transports must not be conflated. Other installed plugins
require named profiles. Standard csvpy uses code.interact in these profiles;
IPython is absent, and arbitrary Python/Agate library parity is unqualified.

Command grammar, descriptions and help have now been derived into the JavaScript
parser descriptors. packages/csvkit/LICENSE retains the authenticated MIT
notice. No Python operation source has been ported. The register is preparation;
all CSV operations, formats and services remain unimplemented/unmeasured in
JavaScript. The separately tested parser is not operation parity.
