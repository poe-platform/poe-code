# XLSX spreadsheets

Add XLSX reading and writing to a spreadsheet engine without installing
other file-format implementations. The module uses the shared spreadsheet AST
and explicit resource, cancellation and host-capability contracts.

```ts
import { createEngine } from "poe-code/ssconvert/core";
import { xlsxFormat } from "poe-code/ssconvert/formats/xlsx";

const engine = createEngine({ formats: [xlsxFormat] });
try {
  console.log(engine.listServices("read"));
  console.log(engine.listServices("write"));
} finally {
  await engine.dispose();
}
```

With engine `workingFiles`, both XLSX exporters stage archive members and central
records through the caller’s safe-fs. XML encoding, member compression and archive
output use bounded chunks and backpressure. Worksheet rows use caller-backed
staging, and row, worksheet and shared-string XML containers stream. Shared-string
counts, IDs, XML and ordered cell-coordinate indexes use caller-backed storage.
Style-region blanks are generated during traversal. Workbook cells, individual
strings, style indexes and metadata still reside in memory; an external safe-fs backend is required for staging outside the isolate.

Compose additional format modules explicitly to convert between file types.
Existing ssconvert service IDs, supported profiles and documented fidelity limits
remain unchanged. This private workspace is shipped through the containing
products, not as a separate npm publication.
