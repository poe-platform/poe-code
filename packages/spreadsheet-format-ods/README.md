# ODS spreadsheets

Add ODS reading and writing to a spreadsheet engine without installing
other file-format implementations. The module uses the shared spreadsheet AST
and explicit resource, cancellation and host-capability contracts. Time values
with fractional seconds import as numeric day fractions, including durations
longer than 24 hours.

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

Compose additional format modules explicitly to convert between file types.
Existing ssconvert service IDs, supported profiles and documented fidelity limits
remain unchanged. This private workspace is shipped through the containing
products, not as a separate npm publication.
