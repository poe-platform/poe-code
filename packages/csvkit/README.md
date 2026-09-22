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

See the [usage guide](../../docs/csvkit/usage-draft.md) for command registration,
encoding, environment settings and limits. Safe Bash provides an opt-in
`csvkitCommands` plugin using the same SDK.

This workspace is private and is distributed through the `poe-code` SDK subpath.
