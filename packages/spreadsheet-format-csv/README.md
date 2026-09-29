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
