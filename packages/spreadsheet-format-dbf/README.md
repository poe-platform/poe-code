# DBF spreadsheet import

Read xBase `.dbf` tables without including other spreadsheet formats:

```ts
import { createEngine } from "poe-code/ssconvert/core";
import { dbfFormat } from "poe-code/ssconvert/formats/dbf";

const engine = createEngine({ formats: [dbfFormat] });
```

The same entrypoints are available under `@poe-platform/safe-bash/ssconvert`.
The engine has no formats by default. Select CSV, XLSX or another writer to
convert imported tables to a different format.

- Import `.dbf` files with `Gnumeric_xbase:xbase`.
- Preserve supported text, numeric, date and logical fields, using the declared
  database code page and skipping deleted records.
- Receive diagnostics for unsupported field types and unavailable code pages.

This module supports import only. Existing field fidelity, memo placeholders
and resource-limit contracts apply; it does not supply a DBF writer.
