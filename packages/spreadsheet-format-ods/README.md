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
remain available. Rows, tables and the main document body stream through caller-backed staging
before style declarations are serialized. Engine-owned cell coordinates and row
boundaries use ordered storage indexes. Plain CSV/text conversions without global
evaluation replay cells into either ODF profile without a full cell array; style
names are reserved before rows are emitted. Low-level mutable workbook inputs
retain captured cell references and snapshots of streamed document metadata; engine-owned metadata avoids those extra snapshots. Generated cell-style keys, reserved names and XML also use working storage.
Generated row, column and region metadata XML, validations and database-range fragments also stage through bounded buffers. Retained definition identities, shape/name indexes and generated rich-text definitions also use working storage, with monotonic name allocation. The automatic-styles, style-definition, validation, named-expression and label-range containers stream. Individual cell strings, retained
style payloads and individual comparison strings, cell metadata and embedded binary resources remain resident. Retained validation/database XML, document metadata and embedded XML documents serialize incrementally, including long text and attributes. Encryption buffers, including wrapped
inner archives, still reside in memory; use an external safe-fs backend to keep
staged archive data outside the isolate.

Compose additional format modules explicitly to convert between file types.
Existing ssconvert service IDs, supported profiles and documented fidelity limits
remain unchanged. This private workspace is shipped through the containing
products, not as a separate npm publication.

ODF XML input decodes directly from ZIP member chunks (at most 16 KiB), including UTF-8 and UTF-16. Probes retain only a short prefix and drain the member to validate its size and CRC. Input XML trees and individual tokens remain resident; encrypted members still use buffered decryption.
