# CSV tools

`createCsvkitCommands(options?)` creates the csvkit command family; `csvkitCommands(options?)` registers it as a shell plugin. `createCsvkitCommand({ name?, ...options }?)` selects one command, defaulting to `csvclean`. `CsvkitCommandsOptions` exposes portable defaults and optional host bindings. All factories accept no arguments.

Select, filter, sort, join, format and inspect CSV data through the
`poe-code/csvkit` SDK on Node.js 22 or newer. The SDK also provides JSON,
spreadsheet and SQL conversion APIs with documented capability limits.

```ts
import { run, type InvocationContext } from "poe-code/csvkit";

// Your application supplies authorized streams, filesystem and configuration.
declare const invocation: InvocationContext;
const status = await run(
  { command: "csvcut", settings: { columns: "name" } },
  invocation
);
```

The engine host explicitly supplies input and output, codecs, locale, clock and terminal
configuration. The `csvkitCommands()` plugin and `createCsvkitCommands()` factory also
work without options: they use portable UTF-8/Python codecs, gzip compression, a C/UTC
locale, a clock, a noninteractive 80×24 terminal and the built-in SQL dialects.
The C locale formats decimals with `%.Nf`; bind a locale service for other formats.
The portable sniffing profile suppresses deployment-specific Python warnings; supply
`sniffing` with warning metadata when exact native warning text is needed.
Database providers default to an empty list; SQLite needs an explicitly initialized
WASM runtime. Database connections and Python interpretation require host bindings; ambient host credentials are never loaded implicitly.
The engine does not fall back to native csvkit processes.
`csvcut` and `csvformat` accept numeric and null cells from input quoting modes
2, 4 and 5, preserving Python float serialization and empty null output cells.

The configured SQLite provider accepts `--engine-option echo False` and
`--engine-option future True` for `csvsql` and `sql2csv`, including both together.
SDK callers can supply the same values through `engine_option` pairs. Other
SQLite engine options remain unsupported.

See the [usage guide](../../docs/csvkit/usage-draft.md) for command registration,
encoding, environment settings and limits. Safe Bash provides an opt-in
`csvkitCommands(options = {})` plugin using the same SDK. Its portable defaults are UTF-8 codecs, C/UTC locale, a deterministic epoch clock, and a non-interactive 80-column, 24-line terminal. Inject bindings for additional encodings, locale number formatting, or a live clock. Its `csvcut` and `csvgrep` registrations yield to the dedicated plugins in either installation order; standalone registration still supplies all fourteen commands. Explicit `replace: true` overrides existing definitions.

This workspace is private and is distributed through the `poe-code` SDK subpath.

Resource budgets are opt-in: every `defaultLimits` value is `Infinity`. Supply finite
nonnegative integer limits to enforce budgets; explicit `Infinity` disables a budget.
CSV field lengths, decimal inference and sniff samples have no additional implicit
ceiling. Use `field_size_limit` (CLI `-z`) for a field ceiling; both accept `Infinity`.

The workspace entrypoint exports `csvkitCommands()` for plugin registration,
`createCsvkitCommands()` for the command collection, and
`createCsvkitCommand()` for a single command. Each accepts an optional
`CsvkitCommandsOptions` object; existing factory names remain available.
`createCsvkitCommand()` selects `csvclean`; pass a command name as its second
argument to select another tool, for example `createCsvkitCommand({}, "csvcut")`.
