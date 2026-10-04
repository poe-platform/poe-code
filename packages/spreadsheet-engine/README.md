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
- Keep live named-expression references when copying formulas with explicit relative or absolute reference modes. Formula parsing, recalculation and dependency discovery share the same name identity and displacement. Reordering and renaming tabs preserve copied names’ sheet targets, including later definition edits and invalid targets. Names qualified by a missing sheet stay unresolved until that sheet exists; native export still requires a format that can preserve those semantics.
- Pass an independently created or edited AST to `await engine.adoptWorkbook(book, { signal })` before writing it. Adoption validates resource limits and owns an immutable snapshot.
- Supply explicit streams or virtual resource bindings. Incremental codecs expose `writeStream`; file bindings consume it through `FileOutput.writeStream` before atomic publication. Older bindings can use a codec’s optional buffered `write` convenience. CSV/text import supports range-backed input and export streams encoded output. Ordered CSV/text export traverses cells directly; unordered export uses caller-backed indexes when working storage is supplied. Compatible sequential conversions use replayable cells through `readWorkbookSource` and `writeWorkbookSource`; the source carries cell-free metadata and a fresh row-major iterator per sheet. Admission validates metadata once and shares cell validation work limits across sheets; replay starts from an independent ownership-budget checkpoint and rechecks owned cells without copying the sheet metadata again. Sources can also supply insertion-order row and column iterators through `axes`; their metadata contains empty axis arrays. Admission validates these records with aggregate ownership limits and caller-backed duplicate indexes. Exporters declare `sourceAxes` to consume this representation; other exporters explicitly materialize axes. Other metadata remains resident. CSV/text and scalar XLSX use these hooks when no global evaluation or transformations are required. A source importer may return a completed workbook when evaluation is needed; the engine runs normal load preparation without importing again. Array-based SDK reads and other conversions still retain the complete workbook.
- Custom codecs can implement `probeSource` and `readSource` to read owned ranges of at most 16 KiB. Supply `{ kind: "range", source }` or a resource binding with `openInput` for retained input without scratch writes. Stream input for range readers uses `workingFiles: { fs, directory, cacheBytes }`: the caller’s safe-fs and a fixed page cache (1 MiB by default, configurable in 16 KiB multiples). Use an external safe-fs backend for large staging; an in-memory backend still stores its contents in RAM. CSV/text, XLSX and ODF readers support ranges; other built-in readers and legacy probes still buffer, and array workbook models remain fully retained. Codec contexts provide `createWorkingStorage()` when working files are configured: isolated scratch addresses, at most 16 KiB per transfer, a shared page budget, and operation-owned cleanup. Close each store after use. XLSX and ODF use this storage for directory and member indexes, without copying compressed payloads. Gnumeric export uses bounded merge runs in this storage to order cells without retaining a full sorting copy.
- Control resource budgets, cancellation and cleanup through the shared SDK. Resource IO transports accept `redirects: Infinity` for unlimited redirects or a nonnegative safe integer for a finite budget; every destination still requires authorization.

The compatibility `poe-code/ssconvert` entrypoint retains the existing complete
format set and rendering/clipboard defaults. This composable entrypoint requires
explicit rendering and clipboard capabilities for those optional operations.
The private workspace is bundled into containing products.

Chart geometry, graph image encoding and print layout are available through the
existing `poe-code/ssconvert` SDK. The same engine owns their bounded rendering
implementations and verified font-shaping assets; no additional package installation
is needed.
