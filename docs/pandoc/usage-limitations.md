# TypeScript converter usage and limits

Original bounded TypeScript implementation, not a native Pandoc wrapper. Public
SDK: `poe-code/pandoc`; explicit plugin: `poe-code/safe-bash/commands/pandoc`.
No native fallback, filters, downloads, ambient fonts or environment variables.
Private workspace package is not an independently published install target.

```ts
import {convert} from "poe-code/pandoc";
const result = await convert([{bytes: new TextEncoder().encode("# Heading\n")}],
  {from: "commonmark", to: "plain"}, {});
```

Public plugin registration and SDK configuration:

```ts
import {Shell, MemoryFileSystem} from "poe-code/safe-bash";
import {pandocCommands} from "poe-code/safe-bash/commands/pandoc";
const shell = new Shell({fs: new MemoryFileSystem()}).use(pandocCommands());
try { await shell.exec("printf '# Heading\\n' | pandoc -f commonmark -t plain"); }
finally { await shell.dispose(); }
```

The root CLI exposes the converter through `poe-code bash --pandoc -c '…'`.
It has no root pandoc command. Verified CLI examples (from repository root):

```sh
npm run dev -- bash --pandoc -c 'pandoc --help'
npm run dev -- bash --pandoc -c 'pandoc --list-output-formats'
npm run dev -- bash --pandoc -c 'printf "# Heading\n" | pandoc -f commonmark -t plain'
```

The corresponding built `node dist/bin.cjs bash --pandoc …` commands are verified.
The real filesystem CLI provider does not expose conditional atomic publication:
`-o file` rejects E_CAPABILITY before acquisition. This is a supported error, not
successful file delivery. With the public MemoryFileSystem plugin, `pandoc -f
commonmark -t html5 input.md -o output.html` succeeds (shell-cases.json).
Shell redirection is available but lacks the command's atomic publication guarantee.
 Root SDK `runBash` accepts `pandoc: {limits}`;
absence keeps conversion disabled. CLI accepts `--pandoc` with bounded defaults;
SDK hosts can lower limits. CLI verification status is in the QA results.

## Format and extension matrix

Availability below is from the built public registry for an empty context.
Explicit trusted `context.reader`/`writer` capabilities can supply a gated direction.
Extensions are independently admitted; unsupported switches fail `E_EXTENSION`.

| Format | Read | Write | Suffixes | Extensions (default) | Direction options |
| --- | --- | --- | --- | --- | --- |
| commonmark | enabled | enabled | md, commonmark | none | read: none; write: wrap |
| csv | enabled | forbidden | csv | none | read: none; write: none |
| docx | gated | gated | docx | none | read: none; write: standalone |
| epub | enabled | enabled | epub | none | read: none; write: standalone, epub |
| gfm | enabled | enabled | gfm | pipe_tables (+), raw_html (+), strikeout (+), task_lists (+), autolink_bare_uris (+) | read: none; write: wrap |
| html | enabled | enabled | html, htm | none | read: none; write: none |
| html5 | forbidden | enabled | html, htm | none | read: none; write: standalone, metadata, rawContent |
| json | enabled | enabled | json | none | read: none; write: rawContent |
| latex | enabled | enabled | tex, latex | none | read: none; write: wrap, standalone, metadata, rawContent |
| pdf | forbidden | enabled | pdf | none | read: none; write: standalone, pdfPage, pdfFonts, pdf |
| plain | forbidden | enabled | txt | none | read: none; write: wrap, rawContent |
| pptx | enabled | enabled | pptx | none | read: none; write: standalone |
| rst | enabled | enabled | rst | none | read: none; write: wrap, columns |
| rtf | enabled | enabled | rtf | none | read: none; write: standalone |
| tsv | enabled | forbidden | tsv | none | read: none; write: none |
| xlsx | gated | forbidden | xlsx | none | read: none; write: none |

Writer aliases: `html` selects `html5`; `epub3` selects `epub`. Format names are
case sensitive. Both directions are required unless `--yes` authorizes defaults
or suffix inference; stdin defaults to commonmark and stdout to html5 under yes.

## All conversion options

- `from`/`to`: CLI `-f`/`--from`, `-t`/`--to`. File operands or one `-` stdin;
  absent operands uses stdin. `--` ends option parsing.
- `-o`/`--output PATH`: VFS publication; `-` means stdout. SDK context output is
  an explicit publication capability. CLI `-o` needs provider conditional atomic
  mutation; shell `>` can truncate before conversion and has no rollback.
- `yes` (`--yes`), `standalone` (`-s`/`--standalone`), `wrap: "none"`
  (`--wrap=none`), `lossy` (`--lossy`), `failIfWarnings` (`--fail-if-warnings`).
- `metadata`: typed AST metadata; `metadataJson`: ordered JSON maps;
  `metadataFiles`: explicit JSON byte inputs. CLI `-M`/`--metadata KEY=VALUE`
  or KEY:VALUE and repeated `--metadata-file FILE.json`; YAML unsupported.
  Later values win; null deletes; conflicts produce diagnostics.
- `rawContent`: reject, escape or retain (`--raw-content`). Retained active raw
  HTML/TeX is not safe to execute; this QA uses only inert content.
- `resourcePath`: ordered VFS directories (`--resource-path DIR[:DIR]`);
  `extractMedia`: VFS directory (`--extract-media`). No implicit network fetch.
  Extraction is nontransactional; completed writes may survive later failure.
- `pdf`: pageSize a4/letter, orientation portrait/landscape, margin 0..144 pt,
  font mono/serif/sans, fontSize 6..72 pt, lineHeight 1..3. CLI uses
  `--pdf-page-size`, `--pdf-orientation`, `--pdf-margin`, `--pdf-font`,
  `--pdf-font-size`, `--pdf-line-height`. Only bundled mono is available;
  serif/sans fail `E_CAPABILITY`. Unicode glyph availability is font-dependent;
  no shaping/full multilingual-layout guarantee.
- `pdfPage`: explicit finite width/height/margin in points; width and height
  exceed twice nonnegative margin (`--pdf-page WIDTH,HEIGHT,MARGIN`).
- `pdfFonts`: ordered explicit sfnt input sources, replacing bundled font;
  CLI repeated `--pdf-font PATH` uses only VFS. External `--pdf-engine` forbidden.
- `epub`: title, language, identifier, chapterLevel integer 1..6. CLI
  `--epub-title`, `--epub-language`, `--epub-identifier`, `--epub-chapter-level`.
  Metadata defaults require `yes`; strict operation requires explicit metadata.
- Information modes: `--help`/`-h`, `--version`, `--list-input-formats`,
  `--list-output-formats`, `--list-extensions FORMAT`. No acquisition in these
  modes. SDK counterparts are inspectCommand/inspectFormats/createFormatRegistry.

SDK context also accepts explicit `resources.resolve`, `resourceFiles`,
`resourceCwd`, `reader`, `writer`, `output`, borrowed `signal`, `limits` and trusted
`yield`. Resources are owned declared bytes, not arbitrary URLs. Inputs accept
bytes or chunks, diagnostic source and explicit resource base. readDocument and
writeDocument expose the same engine boundaries. Diagnostics are separate from
serialized output; errors carry stable codes. Plugin options are limits and
replace (false by default); runBash does not expose replacement.

## All hard ceilings

`context.limits` or plugin limits may only lower these nonnegative integer values.
Unknown keys and raised limits fail. Units are bytes for byte budgets, depth for
nesting, work units for work and layoutWork, and counts otherwise. text and
field text count decoded UTF-16 units. These limits are not a process sandbox.

| Limit | Ceiling |
| --- | --- |
| inputBytes | 33,554,432 |
| outputBytes | 67,108,864 |
| resourceBytes | 67,108,864 |
| retainedBytes | 134,217,728 |
| text | 33,554,432 |
| nodes | 100,000 |
| depth | 128 |
| attributes | 100,000 |
| tableCells | 100,000 |
| tableFieldText | 1,048,576 |
| tableRows | 10,000 |
| tableColumns | 1,024 |
| resources | 1,024 |
| diagnostics | 1,024 |
| references | 100,000 |
| entities | 100,000 |
| entityBytes | 8,388,608 |
| work | 1,000,000 |
| compressedBytes | 33,554,432 |
| expandedBytes | 67,108,864 |
| parts | 4,096 |
| xmlDepth | 128 |
| xmlNodes | 100,000 |
| binaryBytes | 16,777,216 |
| macros | 10,000 |
| includes | 256 |
| directives | 10,000 |
| fonts | 64 |
| glyphs | 1,000,000 |
| pages | 1,000 |
| objects | 100,000 |
| images | 1,024 |
| layoutWork | 1,000,000 |

## Loss and Office gates

CommonMark/GFM, HTML, JSON, plain, delimited, RTF, LaTeX and RST are bounded
subsets. Strict unsupported structure rejects; diagnosed lossy projections require
explicit lossy. Plain/Markdown table projection can discard geometry; RST cannot
preserve merged cells. RTF does not preserve identifiers/classes or all media.
Raw content, layout, source positions and presentation features do not round-trip
universally. PDF is output-only; there is no PDF reader or PDF editing API.
EPUB is publication conversion, not preservation of arbitrary existing books.

DOCX has no built-in adapter: verified sibling byte APIs do not satisfy the
structured inline-note construction gate. XLSX reading is gated; writing is
forbidden. PPTX conversion is enabled for the bounded authored-content profile;
unsupported internal links, charts/animation or presentation semantics reject or
produce W_PRESENTATION_LOSS when explicitly lossy. W_LAYOUT_UNMEASURED is not
proof of text fit. PDF also rejects internal fragment links and merged cells; dimensions for images
must be supplied explicitly in points. RST merged rows reject even with lossy.
PPTX CodeBlock and merged rows reject even with lossy.
PPTX-specific metadata includes pptx-slide-level (1..6),
pptx-reference and pptx-layout-title-body/title-only/blank, with explicit resource
resolution for references. See pptx-verification.md and pptx conversion source
for the profile. Conversion produces a new document; it is not an Office editing
operation. Sibling Office editing evidence must be assessed separately.

## Source and oracle identity

Product source is packages/pandoc plus the thin safe-bash adapter. Original QA
source is qa-typescript/original.html and original.jpg; manifest records profile
reductions and rejections. No native oracle runs in product or unit runtime.
Existing conformance references: CommonMark 0.31.2, GFM 0.29, Pandoc 3.8.3
(versioned differential evidence only), PDF 1.7 sixth-edition reference,
EPUB 3.3 and Docutils 0.21.2. These references do not imply full Pandoc parity.
Current independent applications, exact pins, findings and not-run lanes belong
in qa-typescript/results.md. README application is still permission-gated.

Current follow-up results are in [qa-current/results.md](qa-current/results.md).
The public SDK and actual CLI examples were rerun after the screenshot build
completed; the format/extension matrix and ceilings were checked against public
formatCapabilities/defaultLimits. Office conversion, Office editing and text
conversion remain separate acceptance lanes.

For an explicitly resolved PDF image, the verified SDK path is:

```ts
import {readDocument, writeDocument} from "poe-code/pandoc";
const document = await readDocument({bytes: htmlBytes}, {from: "html"}, {});
const pdf = await writeDocument({...document,
  resources: [{id: "original.jpg", bytes: jpegBytes}]},
  {to: "pdf", standalone: true}, {});
```

Here htmlBytes/jpegBytes are owned input bytes; the HTML image target must match
the resource id, with explicit positive width/height in points. A resolver alone
does not populate Document.resources. Rich PDF profiles with merged cells or
unsupported scripts remain rejected; the rendered five-page sample uses the
documented supported profile. External renderers are QA tools only.
