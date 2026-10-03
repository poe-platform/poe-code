# ODS spreadsheets

Add ODS reading and writing to a spreadsheet engine without installing
other file-format implementations. The module uses the shared spreadsheet AST
and explicit resource, cancellation and host-capability contracts. Time values
import as numeric day fractions, including fractional seconds, negative durations,
durations longer than 24 hours and abbreviated forms such as `PT30M` or `P1DT2H`.
Days, hours, minutes and seconds have fixed meanings; calendar years and months
remain unsupported. Invalid duration text retains the cell's fallback text.
Styled time exports preserve fractional seconds. Values too large for finite
duration components remain numeric cells.
The time support includes valid forms that Gnumeric 1.12.61 imports as text
and preserves fractions that its ODS writer rounds. Named formulas
resolve base-sheet names without regard to case, including quoted names.

```ts
import { createEngine } from "poe-code/ssconvert/core";
import { odsFormat } from "poe-code/ssconvert/formats/ods";

const engine = createEngine({ formats: [odsFormat] });
try {
  console.log(engine.listServices("read"));
  console.log(engine.listServices("write"));
} finally {
  await engine.dispose();
}
```

Retained range input avoids a complete compressed-archive copy. With engine
`workingFiles`, directory and member indexes spill through the caller's safe-fs
using a shared bounded page cache. Decoded XML, decrypted members and the workbook
model are still retained; this is not yet a fully bounded conversion pipeline.
Both exporters use working storage for compressed ZIP members and central records,
with incremental UTF-8 encoding, compression and archive output for unencrypted
XML members. XML byte-limit checks count bytes without encoding full containers. Buffered `createOdfWriter` calls
remain available. XML strings, embedded resources and encryption buffers, including wrapped
inner archives, still reside in memory; use an external safe-fs backend to keep
staged archive data outside the isolate.

Compose additional format modules explicitly to convert between file types.
Existing ssconvert service IDs, supported profiles and documented fidelity limits
remain unchanged. This private workspace is shipped through the containing
products, not as a separate npm publication.
