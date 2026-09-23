# CSV tools

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

The host explicitly supplies input and output, codecs, locale, clock and terminal
configuration. Database connections, compression and Python interpretation require
appropriate host bindings; ambient host credentials are never loaded implicitly.
The engine does not fall back to native csvkit processes.
`csvcut` and `csvformat` accept numeric and null cells from input quoting modes
2, 4 and 5, preserving Python float serialization and empty null output cells.

The configured SQLite provider accepts `--engine-option echo False` and
`--engine-option future True` for `csvsql` and `sql2csv`, including both together.
SDK callers can supply the same values through `engine_option` pairs. Other
SQLite engine options remain unsupported.

See the [usage guide](../../docs/csvkit/usage-draft.md) for command registration,
encoding, environment settings and limits. Safe Bash provides an opt-in
`csvkitCommands` plugin using the same SDK.

This workspace is private and is distributed through the `poe-code` SDK subpath.
