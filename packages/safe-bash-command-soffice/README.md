# soffice

Inspect Office command arguments and serialize supplied CSV text without starting
LibreOffice. Import from `@poe-platform/safe-bash/commands/soffice`; this private
workspace's implementation and declarations ship inside Safe Bash. **Office file
conversion is unavailable**: every conversion request fails before stdin/VFS reads.

```ts
import { Shell, createMemoryFileSystem } from '@poe-platform/safe-bash';
import { sofficeCommands } from '@poe-platform/safe-bash/commands/soffice';

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(sofficeCommands()); // explicit opt-in; absent from default commands
try {
  console.log((await shell.exec('soffice --help')).stdout);
  console.log((await shell.exec('soffice --version')).stdout);
  // Returns 1 without reading /input.docx or producing /output/input.pdf:
  await shell.exec('soffice --convert-to pdf --outdir /output /input.docx');
} finally { await shell.dispose(); }
```

`soffice(context, { args: ['--help'] })` is the equivalent SDK entry point.
Structured options support `files`, `conversion: { extension, filter, options }`,
`outdir`, `importFilters: [{ name, options }]`, `headless`, `help`, `version`,
`textCat` and `scriptCat`. Ordered `args` cannot be mixed with those fields; use
ordered arguments for interleaved modes. `limits` configures either entry point;
`replace` controls plugin registration collisions.

| Accepted CLI flags | Behavior |
| --- | --- |
| `--help`, `-h`, `-?` | Write help to stdout; status 0. |
| `--version` | Write adapter v1 and pinned source revision; status 0. |
| `--headless` | Record headless mode. |
| `--invisible`, `--nologo`, `--norestore`, `--nodefault`, `--nolockcheck` | Inert compatibility flags. |
| `-n`, `-o` | Set subsequent file events to new/open. No UI runs. |
| `--convert-to EXT[:FILTER[:OPTIONS]]` | Consume next operand; set conversion/headless. EXT is nonempty ASCII alphanumeric. |
| `--outdir PATH` | Consume next operand only in conversion mode; neutral flags may intervene. |
| `--infilter=NAME[:OPTIONS]` | Record ordered forced-import descriptors; retain everything after first colon. |
| `--cat` | Record `txt:Text` conversion/headless. No text extraction runs. |
| `--script-cat` | Record an inert inspection request/headless; never execute scripts. |
| `--` | Treat remaining operands literally; `-` denotes future stdin input. |

Long flags also accept deprecated single-dash spellings with stderr warnings.
Grouped short flags and attached `convert-to`/`outdir` operands are rejected.
Repeated conversion flags overwrite global conversion parameters; earlier open
files retain their event. Unknown options fail. Printing, listeners, display and
profile paths (`-env:`) are denied. Help/version still require valid bounded argv.

Outputs are byte streams: help/version use stdout; invalid/unsupported requests
use stderr and status 1. SDK results distinguish `help`, `version`,
`invalid-argument`, `unsupported` and `limit`. Exhaustion returns status 1/`limit`
without additional unbudgeted diagnostics; already written bytes remain.
Cancellation propagates rather than becoming a normal result. There are no
converted documents, progress messages or persistent user export settings.
Shell redirects open before command admission: `> existing.docx` can truncate
that VFS file even when conversion is refused. Avoid redirecting onto source files.

| Default invocation limit | Value |
| --- | ---: |
| Argument bytes | 65,536 |
| File operands | 1,024 |
| Input bytes | 16,777,216 |
| Retained bytes | 1,048,576 |
| Output bytes | 65,536 |
| Model nodes | 100,000 |
| Pages | 1,000 |
| Work units | 1,000,000 |

These are admission/accounting limits, not measured whole-process memory bounds
or evidence that pages can be rendered. The command owns its budget and registers
invocation cleanup before acquiring output operations; sinks are awaited and
cancellation is forwarded. Direct primitive callers supply a complete limits
object and an explicit signal, then close their budget after consumption:

```ts
import {
  createSofficeBudget, parseCsvExportOptions, exportCsvTextRows
} from '@poe-platform/safe-bash/commands/soffice';

const budget = createSofficeBudget({
  argumentBytes: 4096, files: 10, inputBytes: 4096, retainedBytes: 16384,
  outputBytes: 4096, nodes: 100, pages: 10, work: 10000
}, new AbortController().signal);
try {
  const options = parseCsvExportOptions(undefined, budget);
  for await (const bytes of exportCsvTextRows([['name', 'value'], ['a,b', '=1+1']], options, budget)) {
    // Consume owned Uint8Array chunks through your explicit byte sink/VFS staging.
    console.log(new TextDecoder().decode(bytes));
  }
} finally { budget.close(); }
```

`parseSofficeArguments` admits Unicode text without NUL/unpaired surrogates;
`parseSofficeByteArguments` uses fatal UTF-8 decoding and preserves a leading BOM
as a pathname character. Caller bytes must remain unchanged during admission.
Successful retained reservations last until close; failed admission rolls them back.
`resolveExportFilter` uses supplied declarative filters and document service,
explicit names or preferred extension matches; `admitConversion` denies every
currently unqualified conversion. Semantic document/font/VFS interfaces describe
an engine boundary, not a loss-preserving implementation.

CSV primitives operate only on supplied metadata/text:

- `parseCsvExportOptions` parses export options, not import options. Absent options
  mean UTF-8/comma/double quote, raw values; supplied options start with
  `SaveAsShown=true`. Fewer than three tokens are incomplete; exactly four use a
  numeric legacy boolean and enable quote-all. Modern booleans require lowercase
  `true`. Tokens 1–15 are separator, quote, encoding, three import placeholders,
  quote-all, number-as-number, shown values, formulas, remove-space, sheet selector,
  evaluate-formulas, BOM, endianness (`0` big/`1` little). No formulas are evaluated.
- `planCsvSheetExports` uses selector 0 for current sheet/base filename, -1 for
  all sheets, positive one-based selectors for `stem-sheetname.ext`. Invalid or
  out-of-range selectors, unsafe components and duplicate destinations fail.
  Supply a derived stem and canonical absolute VFS directory. VFS alias/case
  checks and transactional publication remain the caller's responsibility.
- `exportCsvTextRows` emits LF-ended escaped CSV with doubled embedded quotes.
  Encodings are exactly `UTF8`, `76` and product `UTF16`; UTF-8 BOM is optional,
  UTF-16 BOM mandatory with explicit endianness. Fixed width, remove-space,
  incomplete options, invalid/equal delimiters and other encodings fail. Leading
  `=` is inert. Displayed/raw numbers, cached formulas and workbook import are
  unavailable. A later row may fail after earlier chunks: stage before publication.

Runtime profile: TypeScript ESM, Node >=22, byte streams, explicit VFS/cancellation,
zero external runtime dependencies in this command's first-party closure. No host
executables/files/fonts, implicit network, native/WASM fallback or dependency
loads/downloads. Macros, links, OLE and remote assets have no execution path.
No fonts or conversion engine are bundled. Whole Safe Bash has separate dependency
contracts; this leaf does not establish a dependency-free aggregate artifact.
Browser/workerd condition checks are graph checks; actual engines remain unqualified.

Parser findings are pinned to LibreOffice/core
`d17755172ac96e54e3f10f35dd1b1680f0ef84bd`, separate from installed app manifest
26.8.0.3. Native attempts stopped in dyld before main with no conversion output;
source inspection is not native parity evidence. Status 1 is product admission
policy, not an inferred native exit mapping. DOCX/ODF/PPTX/XLSX conversion,
loss-preserving layout, pagination, shaping, formulas, slide masters, charts,
PDF/A, PDF/UA and notes rendering remain open. No PDF option/profile or standards
compliance is admitted. Generated files or text equality cannot qualify rendering.
