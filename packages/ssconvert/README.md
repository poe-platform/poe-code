# Spreadsheet conversion

Convert spreadsheets through the `poe-code/ssconvert` SDK on Node.js 22 or newer.
The engine provides spreadsheet import and export, recalculation, workbook updates,
and chart and print rendering. It also opens XOR-obfuscated and RC4-encrypted Excel workbooks (standard and CryptoAPI)
using the native reader's built-in password. Format support has documented limits; see the
[usage guide](../../docs/ssconvert/usage-draft.md) for examples and capabilities.

```ts
import { createEngine } from "poe-code/ssconvert";

const engine = createEngine({
  codecs: [],
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: {
    inputBytes: 1_000_000, outputBytes: 1_000_000,
    cells: 10_000, sheets: 16, operations: 100
  }
});
try {
  console.log(engine.listServices("read"));
  console.log(engine.listServices("write"));
} finally {
  await engine.dispose();
}
```

Filesystem and network access require explicit host bindings. The engine never
uses a native spreadsheet converter as a fallback. Safe Bash provides a separate,
opt-in `ssconvertCommands` plugin using the same engine.

This workspace is private and is distributed through the `poe-code` SDK subpath.
