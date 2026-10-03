# Spreadsheet engine

Compose spreadsheet conversion, editing and recalculation with the file formats
your application supports. The engine registers no formats by default and never
acquires filesystem, network, database or password access implicitly.

```ts
import { createEngine } from "poe-code/ssconvert/core";
import { csvFormat } from "poe-code/ssconvert/formats/csv";
import { xlsxFormat } from "poe-code/ssconvert/formats/xlsx";

const engine = createEngine({ formats: [csvFormat, xlsxFormat] });
try {
  console.log(engine.listServices("read"));
} finally {
  await engine.dispose();
}
```

- Select format modules and custom codecs per engine instance.
- Read, edit, recalculate, merge and write owned workbook models. Clock-based formulas use pinned tzdb 2026c offsets for 485 named zones and aliases; other names retain host Intl behavior.
- Enable sample functions explicitly; `PERL_SED` supports numbered/named backreferences and capture conditions, branch-reset groups, bounded lookaround conditions and alphabetic lookaround/atomic spellings, preserving literal replacements and byte results.
- Keep live named-expression references when copying formulas with explicit relative or absolute reference modes. Formula parsing, recalculation and dependency discovery share the same name identity and displacement. Names qualified by a missing sheet stay unresolved until that sheet exists; native export still requires a format that can preserve those semantics.
- Pass an independently created or edited AST to `await engine.adoptWorkbook(book, { signal })` before writing it. Adoption validates resource limits and owns an immutable snapshot.
- Supply explicit streams or virtual resource bindings. Incremental codecs expose `writeStream`; file bindings consume it through `FileOutput.writeStream` before atomic publication. Older bindings can use a codec’s optional buffered `write` convenience. CSV/text export streams encoded output, while workbook ingestion and the current AST still retain the complete workbook.
- Control resource budgets, cancellation and cleanup through the shared SDK. Resource IO transports accept `redirects: Infinity` for unlimited redirects or a nonnegative safe integer for a finite budget; every destination still requires authorization.

The compatibility `poe-code/ssconvert` entrypoint retains the existing complete
format set and rendering/clipboard defaults. This composable entrypoint requires
explicit rendering and clipboard capabilities for those optional operations.
The private workspace is bundled into containing products.

Chart geometry, graph image encoding and print layout are available through the
existing `poe-code/ssconvert` SDK. The same engine owns their bounded rendering
implementations and verified font-shaping assets; no additional package installation
is needed.
