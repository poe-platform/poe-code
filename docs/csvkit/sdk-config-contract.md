# Public SDK and configuration contract

`@poe-code/csvkit` in `packages/csvkit` is TypeScript ESM with strict NodeNext
declarations and `.js` import specifiers. It remains private in this checkout.
The root package exposes the same compiled SDK through `poe-code/csvkit`.
Availability does not establish full compatibility; see
[implementation-status.md](implementation-status.md) for explicit blockers.

## Entry points and shared operations

The SDK exports `execute(name, context)` and `run(request, invocation)`, both
returning `Promise<number>` with the exit status. `execute` takes CsvkitContext
including owned argv; `run` takes InvocationContext without argv. Both invoke
the same command operation. SDK settings do not get reconstructed into argv.
`CsvkitRequest` discriminates command-specific settings through `CsvkitSettings`,
generated from the frozen flag inventory. Runtime validation also protects
JavaScript callers. Neither method uses ambient process state.

`name` is exactly one of csvclean, csvcut, csvformat, csvgrep, csvjoin, csvjson,
csvlook, csvpy, csvsort, csvsql, csvstack, csvstat, in2csv, sql2csv. No aliases or
subcommands replace these names. `argv` is OwnedArguments, excluding argv[0].
Raw safe-bash argument carriers must be copied/admitted into it from bytes,
never from lossy display strings. Argument decoding follows the bound profile.

The returned number is the exit status; output and side effects go through
injected capabilities. Source-compatible help/version/errors resolve with their
source statuses and bytes. Many operation and resource refusals resolve with
status 78; exhausted diagnostic budgets can suppress their stderr. Cancellation
and opaque host execution failures escape through the existing safe-bash failure
boundary. The SDK does not return a universal typed outcome object. Do not catch
cancellation as a parser error. Successful no-match, empty
result and no-result SQL paths follow source behavior, not a blanket success
payload. Partial writes and committed database effects are not undone by abort.

The safe-bash family factory is `createCsvkitCommands(config)` in
`poe-code/safe-bash/commands/csvkit`. It adapts CommandContext to the domain invocation and supplies all
fourteen registry descriptors atomically under existing collision/replacement
policy. Registration is opt-in; it does not enter default agentCommands. It adds no grammar,
inference, provider-specific conditions, host process dispatch or Python fallback.

## Request and settings schema

The request shape is `{ command, settings }`, a discriminated union whose command
determines a command-specific settings type. The exact option names, defaults,
choices, cardinality and applicability originate in
[feature-register.json](feature-register.json), not a universal bag of options.
Use parser destination names as SDK setting keys, retain ordered arrays for
append/nargs actions and distinguish omitted from explicitly supplied values.
For example csvsql `queries` is ordered, `engine_option` retains repeated
key/value pairs, and `connection_string` maps to --db. SDK-only typed values
must preserve Decimal and Python-literal option values without JS Number loss.

Every registered action has a setting or a documented grammar-only action
(help/version). Shared actions suppressed or overridden by a command must not
become silently active through the SDK. Keep positional inputs (`input_paths`
versus single input), output encoding, dialect and no-header meanings specific
to each utility. Validation order and early exits are part of the operation
contract. Full action and ordered-flow registers remain the authoritative
crosswalk; this table describes the domains rather than substituting a flag list.

| Request command | Settings and operation boundary |
| --- | --- |
| csvclean | Check/fix selections, join/fill conflict, clean/error output order and physical-line diagnostics |
| csvcut | Names early exit, inclusion/exclusion selectors, duplicate positions, short/surplus rows, empty-row deletion |
| csvformat | Output dialect/quoting/terminator, ASV precedence, generated/removed headers, raw versus typed quoting path |
| csvgrep | Columns, string/regex/match-file precedence, inversion/any-match, source Python search semantics |
| csvjoin | Ordered files and join keys, left/right/full/sequential modes, typed null and row ordering |
| csvjson | Raw/typed/stream settings, inference guards, JSON formatting and GeoJSON geometry/property/bbox behavior |
| csvlook | Loading/render bounds, precision/truncation/locale and source Markdown bytes |
| csvpy | Filename, dict/agate precedence, reader/table guest object, standard versus optional IPython interaction |
| csvsort | Stable typed multi-column ordering, reverse/ignore-case, null ordering and names exit |
| csvsql | Dialect/URL, ordered queries/hooks, schema/table/constraint/create/insert/batch options, one transaction |
| csvstack | Ordered files, header union, groups/filenames precedence, stdin replay and generated-header paths |
| csvstat | Ordered thirteen metrics or raw count, metric/output validation, Decimal/locale/null/frequency settings |
| in2csv | Eight source formats, schema/key/format inference, workbook sheets/names/side outputs, raw fast-path guards |
| sql2csv | URL, query flag/file/stdin precedence, query encoding, literal engine/execution options and result headers |

Parser-only applicability is insufficient: source quirks such as falsey patterns,
raw count on empty input, query delimiter splitting and literal unexpanded error
text remain observable. Do not normalize them into more convenient SDK behavior.

## Invocation and configuration

`InvocationContext` is the execution part of CsvkitContext:
cwd, fs, stdin, stdinIsDefault, stdout, stderr, exported env, terminal, signal,
registerCleanup. argv is supplied separately. Context fs paths are virtual,
including query/schema/match files, DBF memo files and workbook side outputs.
Capability adapters must preserve open-versus-read timing, existence probes,
seek/reopen requirements and read/write errors. CsvkitFileSystem exposes optional
exists, listDirectory, readStream and openWriteFile bindings alongside required
readFile/writeFile. probeInputOpen and openMatchFile are explicit invocation
capabilities for source-compatible eager opening. Missing optional bindings do
not authorize host filesystem calls or treating every read failure as absence.

CsvkitContext binds the following configuration fields (there is no separate
createCsvkitEngine/CsvkitConfig API):

| Field | Contract |
| --- | --- |
| limits | Required finite validated CsvkitLimits; admitted into an owned invocation snapshot |
| codecs | Explicit named providers with incremental decode/encode state, error policy, BOM and newline behavior |
| compression | Explicit extension metadata, decoder lifetime and per-member/aggregate inflation bounds |
| locale | Bound Babel/CLDR behavior, locale data, timezone and Unicode revision, not ambient Intl defaults |
| clock | Injected time for relative-date inference, distinct from work/deadline supervision |
| sqlDialects | Optional additional declarative schema compiler profiles, separate from the shipped generic/core dialects and drivers |
| databases | Explicit database providers and concrete engine/driver profiles, including memory SQLite when queries need it |
| interpreter | Optional trusted JS guest/library bridge with declared reader/dict/agate and interaction profiles |
| sniffing | Optional sample bound, stream profile and frozen warning identity/suppression |
| columnWarnings | Optional frozen Agate warning deployment identity/suppression |
| probeInputOpen | Optional named-open probe with explicitly injected cwd/signal; stat-only is not equivalent |
| openMatchFile | Optional eager FileType opening with cooperative handle ownership |

Configuration is snapshotted per invocation; operation-local mutable
formatting/Decimal/codec/session state must not leak between invocations. Source
global settings effects belong inside an explicit compatibility session, never
host globals. Missing capabilities fail at the source-relevant operation stage;
help/version must not require a database connection or workbook decoder.
Descriptor collisions/ambiguous matching are configuration errors. Derive
provider dispatch from metadata; adding one provider file requires no provider-ID
if/case outside it. Do not fabricate availability for unimplemented providers.

`PYTHONIOENCODING` is consumed only from the injected exported env and interpreted
under the source profile. Locale/timezone/terminal values are supplied explicitly;
LC_ALL/LANG/TZ/COLUMNS/LINES in the oracle capture do not authorize reading host
environment. Database credentials and guest hash seeds are explicit capabilities,
never environment discovery. No new CLI config flags, prompts or spinners are
introduced into csvkit argv. No README content is authorized here.

## Data, resources and trusted services

Raw tables preserve string cells, empty strings, blank physical rows and original
line numbers. Typed tables retain ordered/deduplicated Agate names, nulls,
Boolean, Text, Number, Date, DateTime and TimeDelta semantics. Number is a
Decimal representation with sign, coefficient, exponent and special values;
conversion to binary64 occurs only on source paths that do so. Decimal context
is precision 28/half-even with profile traps and exponent limits. Sorting, joins,
statistics, locale output and SQL parameter adaptation consume these types.
JS Date and Number are not the authoritative storage formats.

ByteSource chunks are borrowed until producer advancement; copy anything retained
before advancing, including Buffer views. Await every sink write. Account input,
argv, codepoints, physical lines, row/column counts, retained memory, sort/join
work, regex work, Decimal digits/exponents, archive entries/inflation, SQL rows
and guest work before allocation. Host safety bounds are SDK policy, separate
from csvkit's field_size_limit and output/render limits. Resource refusals are
explicit bounded-profile divergences, never unavailable cases counted as passes.

`maxNestingDepth` (default 100) bounds nested SDK settings data graphs and decoded
JSON containers before child allocation. Container roots have depth zero.
The JSON reader additionally retains its qualified-depth-256 refusal; increasing
the host setting does not qualify deeper native-reference behavior. SDK cloning
also retains a qualified-depth-256 refusal before entering deeper graphs. This is a
host setting, not a new csvkit argv flag.

SDK supplied settings are admitted before cloning or match-file acquisition.
`maxArguments` counts scalar settings graph values, `maxArgumentBytes` counts
UTF-8 string and bigint decimal representation bytes, and retained admission
charges object/array storage, UTF-16 text and full cloned buffer backing stores.
Each independently cloned setting is charged independently, including aliases.
The retained charge carries into the operation's existing retained counter.
Plain data objects, arrays, maps, sets, dates and ArrayBuffer-backed views are
admitted; nested accessors, shared buffers and other object profiles return named
qualification divergences. These are resource-policy tests, not csvkit passes.

UTF-8 output is admitted before TextEncoder allocation, and bulk side-file output
before concatenation. Row admission occurs before an excess CSV record's fields
accumulate, cumulatively across readers; column admission occurs before parsing
an excess field. Decoded physical-line buffering remains subject to its separate
byte/codepoint/retained budgets. JSON field codepoints are checked while scanning
literal and escaped text, before JSON.parse allocates the decoded string. Raw
token and decoded string storage is retained-admitted before slicing/decoding.
These checks do not yet bound all CSV row serializer intermediates, third-party
workbook allocations, schema/SQL/session resources or arbitrary trusted host work.

Register idempotent cooperative cleanup before acquiring any resource, close new
admission during cleanup, await admitted acquisition/stream/result/driver work,
and use the same cleanup in finally. Borrow the caller signal; do not abort it.
Opaque host work is trusted and gains no promised forcible preemption. Cleanup
does not mask an escaping execution failure or root cancellation.

Database sessions must implement real statements, transactions, result metadata,
parameter types, ordered iteration, rollback and close. The selected product
binding is explicitly initialized SQLite WASM 3.50.4; its source ID matches the
reference, while build flags and wider engine behavior remain unqualified. See
[csvkit-sqlite.md](../specs/csvkit-sqlite.md). Persistent
URLs require an explicitly authorized, tested SQLite VFS binding; snapshot
import/export requires a separately named weaker profile. Never pass a virtual
filename to ambient DatabaseSync. Extension loading and ambient filesystem/network
SQL functions are disabled or explicitly governed by the trusted engine provider.
Network database drivers require authorized endpoint/credentials/transport and
actual server/driver profiles. Dialect compilation does not grant transport.

WorkbookInput and Runtime are actual public exports used by the CLI, backed by
the pinned JavaScript workbook reader and bounded XLSX ZIP/XML qualification.
They preserve cached cells and source sheet selection rather than recalculating
formulas or substituting formatted Gnumeric text. See
[csvkit-public-routes.md](../specs/csvkit-public-routes.md) for the separate
ssconvert plan integration seam. DBF adapters expose header/codepage/deleted-record/memo
semantics and use injected companion-file access. A format accepted by grammar
but lacking its decoder remains a named gap, not a fake conversion.

The interpreter bridge creates session-owned guest reader/DictReader/Table
objects and library modules, preserving iteration, attributes and exceptions.
It also owns code.interact-style behavior; optional legacy IPython requires a
separate profile. createCsvpyInterpreter exposes an injected PythonSession bridge
with measured reader/dictionary behavior; full Agate objects, arbitrary Python
and IPython remain blockers. Native Python, product subprocesses and csvkit
fallback are forbidden. No arbitrary Python library compatibility is claimed.

## Qualification boundary

The frozen baseline and unsupported CPython 3.9.6 diagnostic profile are separate.
Dependency locks, archive/file hashes, locale, drivers, absent optional modules,
stdio and engine revisions are in [reference-profile.json](reference-profile.json).
An injected provider identity is provenance metadata, not byte authentication or
host isolation. Exact-output tests, real engine/transaction/VFS tests, workbook
corpus tests, shell pipelines, guest sessions and public consumers must qualify
execution before availability/parity claims. Existing test censuses and parser
observations do not establish operation passes. QA procedures remain in docs/plans;
this contract defines behavior, not an executable QA script.
