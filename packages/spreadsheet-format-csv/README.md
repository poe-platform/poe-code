# CSV spreadsheets

Add CSV reading and writing to a spreadsheet engine without installing
other file-format implementations. The module uses the shared spreadsheet AST
and explicit resource, cancellation and host-capability contracts.

```ts
import { createEngine } from "poe-code/ssconvert/core";
import { csvFormat } from "poe-code/ssconvert/formats/csv";

const engine = createEngine({ formats: [csvFormat] });
try {
  console.log(engine.listServices("read"));
  console.log(engine.listServices("write"));
} finally {
  await engine.dispose();
}
```

Compose additional format modules explicitly to convert between file types.
Existing ssconvert service IDs, supported profiles and documented fidelity limits
remain unchanged. This private workspace is shipped through the containing
products, not as a separate npm publication.

CSV and configurable text exports stream encoded chunks with backpressure, including a single BOM for UTF-16/UTF-32. The byte-array writer remains available as a buffering convenience. Range-backed input decodes and parses text incrementally, replaying bounded reads for encoding, line-ending, and delimiter inference. With `workingFiles` configured, sequential input uses the engine’s caller-backed storage. Other registered format probes may still buffer during automatic detection; selecting the text importer explicitly avoids that fallback. Ordered-cell export uses a cursor without a lookup map; unordered cells use a bounded caller-backed index when `workingFiles` is configured. Plain conversions between text formats replay cells from retained input instead of building a full cell array. Column inference keeps fixed state per column. Formula-bearing inputs, clock-dependent partial dates, explicit transformations, custom evaluators/formatters, and the workbook-reading SDK still use the array model. Individual large fields remain buffered; this is not complete bounded-memory conversion.
