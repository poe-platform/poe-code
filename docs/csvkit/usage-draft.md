# csvkit for safe-bash

Concrete candidate for a future packages/csvkit/README.md. README incorporation
requires separate user approval under root AGENTS.md. This draft describes
inspected source APIs. Fresh compiled public descriptor, registration and
help/version checks are recorded in current-user-edge-validation.md; complete
operation/profile qualification remains pending. The workspace is private and
no registry installation is recommended.
Node.js 22 or newer is required. Product TypeScript ESM uses explicit injected
capabilities and has no native-process or Python csvkit fallback.

## Usage

```ts
import { Shell } from "@poe-platform/safe-bash";
import { csvkitCommands } from "@poe-platform/safe-bash/commands/csvkit";
import { utf8Codec } from "poe-code/csvkit";

// Bind fs, locale, clock and terminal through your authorized application.
const shell = new Shell({ fs }).use(csvkitCommands({
  codecs: [utf8Codec], locale, clock, terminal
}));
try {
  const result = await shell.exec(
    "csvcut -c name input.csv | csvgrep -c name -m Alice | csvformat -T"
  );
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

The fourteen executable names are csvclean, csvcut, csvformat, csvgrep, csvjoin,
csvjson, csvlook, csvpy, csvsort, csvsql, csvstack, csvstat, in2csv and sql2csv.
Use their original argv syntax. The family is opt-in; registration preflights
all-name collisions. `replace: true` permits explicit replacement.
`createCsvkitCommands(options)` returns definitions for hosts that register
commands themselves. Descriptor presence establishes a registered name, not
complete operational compatibility or availability of optional capabilities.

Current source contains raw CSV operations, typed table inference, Python regex
support, join/sort/Markdown rendering, JSON/GeoJSON output, thirteen csvstat
metrics plus count, SQL DDL/execution orchestration and converters for CSV,
DBF, fixed, GeoJSON, JSON, NDJSON, XLS and XLSX. Workbook readers, portable
codecs, SQLite and an injected csvpy guest bridge are actual APIs. These source
features supersede earlier raw-only implementation descriptions; they do not
establish full csvkit 2.2.0 parity.

Unsupported operations or resource/profile refusals normally return status 78.
They are divergences, never native passes. Parsing errors normally use status 2,
application diagnostics status 1, and help/version status 0 according to their
qualified paths. Cancellation and host failures reject with their original
reasons. If a refusal diagnostic cannot fit the shared output budget, existing
bytes and the refusal status survive without that diagnostic. Arbitrary sink
failure remains observable.

## SDK

`poe-code/csvkit` and the private `@poe-code/csvkit` workspace expose:

- `execute(command, context): Promise<number>` for original owned byte argv.
- `run(request: CsvkitRequest, invocation: InvocationContext): Promise<number>`
  for generated command-specific settings using parser destination names.
  InvocationContext omits argv. Settings are runtime-validated before capability
  acquisition; defaults/applicability and operations are shared with the CLI.
- Generated settings cover 387 operational action instances. Help/version use
  `execute` with original argv; all 28 informational action instances remain
  available through that SDK entry point.
- `OwnedArguments`, `commands`, `parseArguments`, `defaultLimits`, `Runtime`,
  CSV readers/writers, typed table/selector/Decimal APIs and diagnostic classes.
- `utf8Codec`, `pythonCodecs`, `normalizeEncoding`; codec subpaths
  `poe-code/csvkit/codecs/utf8` and `poe-code/csvkit/codecs/python`.
- `WorkbookInput` and actual workbook/worksheet/cell types.
- `databaseDialects`, provider/transport factories and transport descriptors;
  metadata alone is not a configured database driver.
- `createSqliteDatabaseProvider`, `createMemorySqliteFileSystem` and explicit
  SQLite runtime/VFS types; initializing the runtime is a host responsibility.
- `createCsvpyInterpreter` and injected guest-session types. Reader/dictionary
  behavior has historical measurements; full Agate/IPython/arbitrary Python
  compatibility remains blocked.
- `createGzipCompressionProvider`, which requires an injected GzipCodec.

```ts
import { run } from "poe-code/csvkit";
import type { InvocationContext } from "poe-code/csvkit";

async function selectNames(invocation: InvocationContext): Promise<number> {
  return run({ command: "csvcut", settings: { columns: "name" } }, invocation);
}
```

OwnedArguments receives readonly Uint8Array argv excluding argv[0] and argument
limits. It copies retained bytes and exposes immutable length/byteLength plus
fresh `bytes(index)` copies. Its initial ownership bound does not bound repeated
host calls to bytes(). The engine and plugin preflight limits before payload
copies.

`parseArguments(command, bytes, options)` requires limits and accepts signal,
env, openMatchFile and registerCleanup. It returns parsed settings with
idempotent dispose(), or an exit containing stdout/stderr/status. Match-file
opening is eager; line reading is deferred. Parser callers must await dispose().
The engine supplies the explicitly configured match-file bridge; missing
capabilities do not authorize host file opening.

## Configuration and environment

CsvkitCommandsOptions requires `codecs`, `locale`, `clock` and `terminal`.
Optional `compression`, `databases` and `sqlDialects` default to empty provider
lists; interpreter, openMatchFile, sniffing, columnWarnings and probeInputOpen
are absent unless supplied. The plugin derives a named-input open probe from
the bound filesystem when its open capability exists. `limits` accepts partial
defaultLimits overrides; `replace` defaults to false. These are host settings,
not additional csvkit argv flags.

The SDK context requires cwd, fs, stdin, stdinIsDefault, stdout, stderr, exported
env, terminal, codecs, compression, locale, clock, databases, limits, signal and
registerCleanup. Direct/custom JavaScript hosts may omit the hook; finally
cleanup remains necessary, but typed SDK callers provide it. It also accepts the optional
capabilities above. Limits/env/terminal/provider arrays are snapshotted per
invocation; trusted host providers remain responsible for their own behavior.

| Binding | Behavior |
| --- | --- |
| fs | Authorized virtual readFile/writeFile; optional exists, listDirectory, readStream and truncating openWriteFile. Honor supplied signal and maxBytes before allocation. DBF companion files and workbook side outputs use the same explicit authority. |
| stdin/stdinIsDefault | Async byte source and provenance; provenance does not imply TTY. Copy retained producer chunks before advancing. |
| stdout/stderr | Awaited byte sinks preserving backpressure. The current output profile is UTF-8. |
| terminal | Explicit stdin/stdout/stderr IsTTY booleans and columns/lines; frozen help uses the recorded 80-column profile. |
| env | Exported snapshot only. PYTHONIOENCODING controls common input encoding defaults; explicit -e overrides it. sql2csv query input defaults separately to UTF-8. No credentials are discovered from ambient env. |
| codecs | Named decode/encode providers with optional incremental decode. utf8Codec supports UTF-8 aliases and UTF-8-sig; pythonCodecs supplies additional portable profiles whose full Python-codec coverage is unqualified. |
| compression | Explicit extension/decoder bindings. No decoder is automatically enabled. Injected gzip support does not establish bzip2/xz/zstd parity. |
| locale | Explicit profile, timezone and formatNumber contract; do not substitute ambient locale behavior for the frozen Babel/CLDR profile. |
| clock | Explicit now() for time-sensitive inference; UTC alone does not freeze current time. |
| databases | Explicit scheme/profile/connect providers. No engine, endpoint, credentials or network capability is inferred. |
| sqlDialects | Additional declarative schema compiler profiles; a dialect is separate from a driver/transport. |
| interpreter | Injected guest load/interact/close or converted-input bridge; declare reader/dict/agate modes truthfully. |
| openMatchFile | Eager argparse FileType opening with cwd/signal and owned cooperative close. |
| probeInputOpen | Named-file open/error timing probe; stat-only behavior is not an equivalent open. |
| sniffing | Stream/sample profile, maxSampleCharacters, warning identity and suppression. |
| columnWarnings | Optional frozen Agate utilsPath and suppressWarnings. |
| signal/registerCleanup | Borrowed caller cancellation and synchronous enrollment of idempotent cooperative cleanup before acquisition. |

LC_ALL, LANG, TZ, COLUMNS and LINES describe the native reference environment;
they do not authorize product reads of process.env. Output error-handler and
alternate environment profiles remain unqualified. No additional product env
variables or credential discovery are introduced by this draft.

## Resource limits

All SDK limits are required finite nonnegative safe integers. Plugin overrides
merge with these defaults. Host bounds are distinct from source csvkit flags and
produce explicit bounded-profile divergences.

| Limit | Default | Scope |
| --- | ---: | --- |
| maxArguments | 4096 | Argv count and SDK scalar-setting admission |
| maxArgumentBytes | 1048576 | Owned argv and SDK string/bigint admission |
| maxInputBytes | 16777216 | Invocation input including compressed source |
| maxOutputBytes | 33554432 | Combined stdout/stderr admission |
| maxRetainedBytes | 134217728 | Accounted retained storage; not total JS heap or arbitrary provider allocation |
| maxCodepoints | 16777216 | Decoded text admission |
| maxRows | 100000 | Cumulative record admission |
| maxColumns | 10000 | Column admission |
| maxFieldCharacters | 1048576 | Host field bound, distinct from --maxfieldsize |
| maxWork | 100000000 | Accounted engine work |
| maxRegexWork | 1000000 | Accounted regex work |
| maxDecimalDigits | 10000 | Decimal digit admission |
| maxDecimalExponent | 10000 | Decimal exponent admission |
| maxArchiveMembers | 10000 | Accounted archive-member admission |
| maxInflatedBytes | 33554432 | Decoder output admission |
| maxDatabaseResultRows | 100000 | Query result-row admission |
| maxInterpreterWork | 1000000 | Cooperatively accounted guest work |
| maxNestingDepth | 100 | SDK graph/JSON nesting admission; container root depth zero |

Increasing a host limit does not qualify formerly refused semantics. Qualified
SDK/JSON depth restrictions, third-party workbook allocations, broader resource
bounds and opaque host execution remain explicit limitations. Interpreter guests
must consume their supplied work budget; it cannot forcibly preempt host code.

DatabaseSession exposes transaction/query/close and optional reflection/batch
contracts; DatabaseResult owns columns, async rows and close(). Cleanup drains
owned results before connection close and rolls back where required. sql2csv
never explicitly commits; actual persistence/autocommit depends on the qualified
binding. SQLite WASM 3.50.4 and memory/file VFS APIs are explicit bindings; wider
build flags, locking/durability and server database parity remain unqualified.

Registered cooperative cleanup closes new acquisition admission and awaits owned
work. Host failure or caller cancellation remains primary. Cleanup does not undo
published files or database effects and does not promise preemption/drain of
borrowed opaque stdin. CsvkitCleanupError makes owned cleanup failure observable.

## Compatibility and approval status

The source target is released csvkit 2.2.0, SHA-256
147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b.
The primary reference records CPython 3.14.2, Agate 1.14.2, SQLAlchemy 2.0.54,
Babel 2.18.0, CLDR 47, C/UTC/UTF-8 and 80 columns. CPython 3.9.6 is a separate
historical reference and is not selectable in the product.

Full support remains false. The coverage ledger has zero qualified attributed
passes and all 415 effective options, 323 branches and 159 parser declarations
unresolved. Source presence and historical scoped exact cases do not resolve
that ledger. Known historical bzip2/xz/Agate interaction mismatches, optional
profile installation drift, driver/service/IPython/TTY/SIGPIPE qualification,
source declaration census reconciliation and complete current broad acceptance
remain blockers. No unsupported source-shipped feature can be excluded to claim
full parity.

Current scoped compiled consumer and visual checks are recorded in
`docs/csvkit/current-user-edge-validation.md`. Comprehensive operation/effect
coverage and complete optional profiles remain pending. Release delivery was
separately authorized on September 19, 2026; current repository checks are being
run for that delivery. Detailed completion procedures are in
`docs/plans/csvkit-parity-completion.md`; reference/status records are in
`docs/csvkit`. Build-time descriptor discovery generates static inventories;
there is no runtime product filesystem discovery.

README approval is required for incorporating this concrete draft into a package
README. The implementation has local commits; remote delivery and publication
are pending. Local commit, verified remote-main delivery and successful release
are separate outcomes.
