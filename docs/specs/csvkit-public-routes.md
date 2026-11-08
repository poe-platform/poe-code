# Compiled csvkit SDK routes

The public domain workspace is `@poe-code/csvkit`; the distributed root route is
`poe-code/csvkit`. Both resolve to the same compiled TypeScript ESM engine and
strict NodeNext declarations. `execute` accepts the original executable name
and owned argv context. `run` accepts a discriminated `CsvkitRequest` with
command-specific destination settings; `CsvkitSettings` exposes their types.
The original fourteen names remain separate safe-bash commands registered by
`createCsvkitCommands` from `poe-code/safe-bash/commands/csvkit`.

All command operations, including cleaning/report output, cut/filter/sort/join/
stack, JSON/GeoJSON/table/statistics rendering, eight input formats, schema/DB
operations and Python preload/session orchestration are reachable through
`run`. The CLI and SDK invoke the actual same descriptor implementation.
Ordered repeated values remain readonly arrays; DB options remain ordered
readonly key/value tuples, allowing already-typed values as well as original
Python-literal strings. Grammar-only help/version is available through
`execute` and command metadata, rather than an invented SDK operation.
Compile-time admission never certifies runtime compatibility of an unqualified
setting/profile. Existing explicit resource/locale/diagnostic/codec/driver/guest
blockers remain observable.

## Codec-only browser routes

Both packages expose `codecs/utf8` and `codecs/python` under their csvkit route:
`@poe-code/csvkit/codecs/utf8`, `@poe-code/csvkit/codecs/python`,
`poe-code/csvkit/codecs/utf8`, `poe-code/csvkit/codecs/python`.
These import the portable codec/exception/byte-framing graph, without workbook,
database, interpreter, Node builtins or ambient process state. They require
standard TextEncoder/TextDecoder and AbortSignal facilities. The Python route
provides the finite shipped encoding profile, not every Python codec.
Browser-safe codec routes do not establish browser qualification of the full
SQLite or interactive engine.

## Actual workbook SDK and ssconvert boundary

The root SDK exports `WorkbookInput`, `Runtime` and domain-owned
`CsvkitWorkbook`, `CsvkitWorksheet`, `CsvkitWorkbookCell` declaration types.
Public declarations do not import the reader library's types. `WorkbookInput.open` and
`WorkbookInput.table` are the actual cached-value XLS/XLSX reader used by
`in2csv`. High-level callers normally use `run({ command: 'in2csv', settings })`
with `filetype`, `sheet`, `names_only`, `write_sheets`, `use_sheet_names`,
`reset_dimensions` and `encoding_xls` as applicable. The low-level reader takes
an explicitly injected invocation Runtime, shares its budgets, and requires
the owner to await `runtime.close()` in finally. It is not an independent
ambient-file reader or a workbook writer. Direct Runtime callers supply complete
effective settings/descriptor defaults; `run` provides defaults and validation.

These actual exports are the available integration seam for the separate
[ssconvert plan](../plans/ssconvert-javascript-safe-bash.md). That plan's tasks
have not been executed or modified by this integration. The reader supplies
cached/raw values; it does not provide Gnumeric recalculation, formatted display,
workbook export or the proposed ssconvert workbook model. Unqualified BIFF/XML/
style/calendar cases remain explicit blockers.

## Optional host capabilities

File access, codecs, compression, database providers and interpreter sessions
are explicitly injected through CsvkitContext. SQLite initialization receives
the trusted engine binding; no database or interpreter gets loaded implicitly.
Network SQL adapters require authorized host drivers/connections/credentials;
real driver/service interoperability is still unmeasured. `createCsvpyInterpreter`
requires an explicitly supplied compatible session factory and terminal; full
arbitrary Python/Agate/IPython compatibility remains unfinished. The package
provides no product subprocess or Python csvkit fallback.

The frozen reference is csvkit 2.2.0 archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`,
with dependency/locale/driver profiles in
[reference-profile.json](../csvkit/reference-profile.json). Current measured
scope and remaining blockers belong to
[implementation-status.md](../csvkit/implementation-status.md).
