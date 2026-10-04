# safe-bash-command-pandoc

Convert documents in a virtual filesystem with Safe Bash, or pass bytes directly
to its document-conversion SDK. The implementation workspace stays private and
is bundled with Safe Bash.

```ts
import { convert } from "@poe-platform/safe-bash/commands/pandoc";

const result = await convert(
  [{ bytes: new TextEncoder().encode("# Hello\n") }],
  { from: "commonmark", to: "plain" },
  {}
);
```

The command exports `createPandocCommand`, `createPandocCommands`, and
`pandocCommands`, with `PandocCommandsOptions` and `PandocLimits`. Use
`shell.use(pandocCommands())` to register it. `createStandalonePandocCommand`
accepts explicit read/write callbacks for conversion without a Shell.

The SDK exposes `convert`, `readDocument`, `writeDocument`, `inspectFormats`,
`inspectCommand`, `formatCapabilities`, and `PandocError`. Inspect format
capabilities before conversion: support is format-specific and does not imply full native Pandoc
compatibility. DOCX output accepts raw `openxml` inlines and omits raw inlines for other formats.
Built-in DOCX conversion preserves headings, bold/italic text, inline code, hyperlinks, lists,
tables, blockquotes, horizontal rules, strikeout, superscript, subscript, quotes,
and embedded raster images (including inline images in table cells). PPTX renders blockquotes as indented
content, preserves code, strikeout, superscript, subscript and quotes, and accepts
Div containers. PPTX table paragraphs preserve rich text and hyperlinks. RST writes Divs as containers and strikeout as a declared role
with the `strikeout` CSS class. PDF uses standard Helvetica bold/oblique and Courier fonts for styled
text and inline code by default; supplied fonts retain their explicit styling.
ODT reads and writes headings, rich text, links, lists, simple tables, quotations,
code, rules, sections, and embedded raster images. The CLI infers `.odt` in both
directions; the SDK uses `from: "odt"` or `to: "odt"`. ODT preserves named text
style inheritance and repeated table cells; table spans and unsupported drawings
return diagnostics.
Other unsupported blocks and inlines return diagnostics. XLSX input becomes one named
table per sheet, retaining cached values and calculating missing formula results.
PDF input uses semantic text, tables and image extraction.
Plain output uses link labels, spaces for soft breaks, four-column decimal list
prefixes, 72-character rules, and a final newline even for empty documents.
Bullet lists use the compact spacing of Pandoc 3.11.
Both `html` and `html5` accept HTML input and produce HTML5 output.
The shell command infers omitted input and output formats from file extensions.
Stdin and extensionless inputs default to `markdown`; stdout and extensionless
outputs default to `html5`. Explicit `-f`/`-t` override inference; `--yes` is
not required.
`markdown`, `md`, `markdown_github`, `markdown_mmd`, `markdown_phpextra`, and
`commonmark_x` select the supported GFM reader and writer, including tables
and strikeout. The `.md` suffix also selects GFM, so pipe tables work without
an explicit input format. Use `-f commonmark` for strict CommonMark input. File suffix inference is case-insensitive. Task lists render as HTML
checkboxes or text checkbox symbols in LaTeX, reStructuredText, RTF and CommonMark.
`markdown_strict` selects the CommonMark reader and writer. These
compatibility names use the documented engine features; they do not enable
additional dialect-specific extensions. XLSX input uses the first row as table headers, preserves literal
cell whitespace, and calculates formulas whose results are missing.
Shell arguments accept `--read`/`-r` and `--write`/`-w` as format aliases,
attached short values such as `-fcommonmark -thtml -ooutput.html`, and bare
`-M draft` or `--metadata=draft` as boolean true. `-v` reports the same
TypeScript converter identity as `--version`.
`inspectCommand(args)` and the shell command also inspect bundled Pandoc 3.11
assets: `--list-highlight-languages`, `--list-highlight-styles`,
`--print-highlight-style STYLE` (all eight listed styles),
`-D html` / `--print-default-template=html5`, and
`--print-default-data-file=abbreviations` (also `templates/default.html5`).
These static assets do not enable template conversion or syntax highlighting.
Other templates/data files are unavailable; inspection never reads user files.
`--completion=bash` and `--bash-completion` emit Bash completion for the
TypeScript converter's supported options and configured format registry.

## Configuration

`ConversionOptions` requires `from` and `to`. Writer options are `yes` (explicit
metadata defaults), `standalone`, `metadata`, `metadataJson` (ordered maps; null
deletes keys), `metadataFiles` (explicit JSON inputs), `rawContent` (`reject`,
`escape`, or `retain`), `lossy`, and `failIfWarnings`. The CLI defaults to lossy
conversion, projecting unsupported container attributes with diagnostics; the SDK
remains strict unless `lossy: true` is selected. `--fail-if-warnings` rejects these
diagnostics, and `--lossy` remains accepted for compatibility. Plain, CommonMark, and GFM output accept
`wrap` (`none`, `auto`, or `preserve`) and positive `columns` (default 72 when
wrapping is requested). Markdown wrapping preserves inline code, links, and fenced
blocks. Markdown aliases include `markdown`, `md`, `markdown_strict`,
`commonmark_x`, and `markdown_github`; file inference also accepts `.markdown`,
`.mkd`, `.mdown`, and `.mdwn`. CommonMark, GFM, RST, and LaTeX accept
`columns`, `standalone`, `metadata`, `toc`, `ascii`, `eol`, and `rawContent`;
output effects depend on the writer. Other wrapping writers, including HTML
and JSON, accept `none`. HTML accepts
`numberSections`, `toc` (linked contents in standalone output, through level 3),
and `ascii` (numeric entities). `shiftHeadingLevelBy` (−6 through 6) adjusts
headings, `stripComments` removes raw HTML comments while preserving code, and
`eol` (`lf`, `crlf`, or portable `native` = LF) selects text line endings.
The command exposes the corresponding hyphenated flags and accepts
`--standalone=false`. These options extend the bounded writers; they do not
imply complete native writer equivalence.

Local HTML templates use `template` (an `InputSource`) and `variables` (a JSON
map), with `$body$`, `$name$`, `$$`, `$if(name)$…$else$…$endif$`, and
`$for(name)$…$endfor$`. Partials, map interpolation, loop separators and other
template expressions are rejected. `includeInHeader`, `includeBeforeBody`, and
`includeAfterBody` accept ordered `InputSource` arrays; includes imply standalone
HTML unless a custom template is supplied. The corresponding flags are
`--template`, `--variable`/`-V`, `--variable-json`, `--include-in-header`/`-H`,
`--include-before-body`/`-B`, and `--include-after-body`/`-A`.
Short include flags accept attached paths, such as `-Hheader.html`.

`--defaults`/`-d` reads an explicitly named VFS YAML map. Use `from`/`reader` and
`to`/`writer` to select formats; explicit flags override scalar defaults.
Supported defaults cover the writer flags above, template variables, metadata,
include arrays, `input-files`, and `output-file`. Repeated defaults combine
ordered file lists and maps. YAML anchors and acyclic aliases are supported; unsafe
execution keys and cyclic values are refused. `limits.yamlAliases` optionally bounds
alias expansion per defaults file; omission or `Infinity` disables that budget.
`-dsettings.yaml` is also accepted. Explicit CLI operands replace `input-files`
defaults; `-` in that list reads the supplied stdin once.
SDK callers can use `resolveConversionArgs(args, files, signal, context)` with
explicit read/write callbacks, then pass its options and operands to `convert`
with the returned `limits` in the conversion context. Those remaining limits
keep defaults, templates, includes and document inputs within one budget.
`fileScope`/`--file-scope` parses document operands separately.
`sandbox`/`--sandbox` retains explicit VFS authority and never provides a native
Pandoc sandbox or additional filesystem isolation.

Resources use `resourcePath` (ordered VFS directories) and `extractMedia` (VFS
output directory). RTF embeds local pictures from the configured VFS, using each
input document’s directory or `resourcePath`; `extractMedia` is optional. SDK callers
can also supply embedded resources or an explicit resolver. No media is downloaded
implicitly. PDF options are `pdf`
(`pageSize`: `a4` or `letter`; `orientation`: `portrait` or `landscape`; `margin`,
`font`, `fontSize`, `lineHeight`), `pdfPage` (`width`, `height`, `margin`, in points),
and `pdfFonts` (ordered supplied font inputs). The packaged named font is `mono`;
other named families are unsupported. PDF preserves bold, italic, underline,
strikeout, horizontal rules, and left/center/right table alignment. Bold and
italic use synthetic styling of the supplied font. EPUB options are `epub.title`,
`epub.language`, `epub.identifier`, and `epub.chapterLevel` (1–6).
EPUB conversion requires no `--yes`: missing metadata defaults to the first
heading (or `Untitled`), language `en-US`, and a deterministic content identifier.
Explicit publication metadata takes precedence.

`ConversionContext` accepts `resourceFiles`, `resourceCwd`, `resources`, `reader`,
`writer`, `output`, `signal`, `yield`, and `limits`. Output supports atomic
publication or an explicitly supplied streaming destination; streaming output
can remain partial after failure. Inputs contain `bytes` or `chunks`, with
optional `source` and `base`. File adapters prefer the caller’s `readStream`
capability for document operands, defaults, metadata, templates, includes, fonts,
and local image resources. `CommandInputs.readFile` remains a compatibility
fallback. File reads are lazy and close on cancellation or budget failure; the
`convert` convenience API retains document ASTs and output in memory.

`convertToOutput(inputs, options, {output, workingFiles})` returns an output summary
instead of a complete payload. Its CSV/TSV → HTML, Pandoc JSON and plain text paths use a bounded
page cache and the caller’s safe-fs backing storage for source data and table
widths; individual fields can exceed the cache. `workingFiles` supplies `fs`, an
absolute `directory`, and optional `cacheBytes` (one MiB by default, in 16 KiB
pages). Use an external filesystem backend for large data: a memory filesystem
still retains the backing bytes in RAM. No host scratch directory is used.
Pandoc JSON stores tree nodes, parent links, subtree boundaries and string contents
in that backing store. Construction and serialization keep no resident document
index or traversal stack; long fields retain their original inline semantics.

Single-input JSON → JSON conversion also retains the complete wire document in
caller storage. Strings, nesting state, duplicate-key indexes, schema traversal,
table-span occupancy, and numeric metadata-key ordering do not require resident
document collections. Output preserves constructor bytes and binary64 numeric
semantics, validates the complete document before publication, and preflights
finite output budgets. Retained JSON conversions support finite `inputBytes`, `outputBytes`, `work`,
`diagnostics`, `fonts`, `includes`, `images`, `binaryBytes`, `layoutWork`, `parts`,
`compressedBytes`, `expandedBytes`, `resources`, `resourceBytes`, `tableRows`,
`tableColumns`, `tableFieldText`, `tableCells`, `attributes`, `depth`, `nodes`, and `text`,
line endings, and the same non-transforming options as the table path. It uses
two page caches of at most `cacheBytes` each, plus fixed small index caches.
JSON → JSON without filters, metadata overrides or writer transformations also
retains finite `references` limits through both SDK and command, including input-block, decoded-fragment, parser-edge and table-span
accounting with the same limit diagnostics. Other reference-limited combinations
still use the compatibility path.
JSON `metadataFiles` merge into retained generations before filters. File contents,
merge keys, duplicate-key indexes and recursive map/list work stay in caller
storage; null deletion, last-key-wins JSON parsing and native number conversion
are preserved. One file is retired before the next is acquired. Merging uses at
most seven page caches, each bounded by `cacheBytes`, plus fixed index caches.
`metadataJson` option layers share one retained snapshot and merge directly from
it after metadata files, before filters. They add two page caches independently
of layer count and do not count resident option values as input bytes. The SDK
map and one immediate key enumeration remain resident at admission, as with
template variables. Typed SDK `metadata` maps also retain their snapshot,
schema validation, enum translation and recursive merges after JSON layers.
Their caller-owned graph, one immediate own-key vector and one property name
remain admission costs; traversal and table geometry live in storage. They add
one wire page cache plus the shared option scratch cache after admission.
RTF/ODT retain image origins through typed merges and Lua filters: replacement
images use caller resource settings while unchanged images keep their input base.
HTML `includeInHeader`, `includeBeforeBody`, and `includeAfterBody` inputs also
stream into caller storage before document acquisition. Include replacement
generations use one additional page cache, preserve raw text and replacement
tokens, and retire before output commit. CLI `-H`, `-B`, and `-A` use this same
path. Custom HTML templates retain their source, block continuations, body and
output in the same caller storage. Variable values and nested loop bindings use
one additional page cache. The SDK's `variables` object is already resident at
entry; admission additionally enumerates one object's keys at a time and reads
one complete property name. It avoids cloning the value graph and stores its
traversal state externally. CLI `-V` and `--variable-json` use the same retained
conversion path; CLI option parsing still constructs the input map.
JSON filters with `applyJsonStream` also use retained generations: each validated
response replaces the prior document before the next filter starts. At most five
page caches coexist (two document pairs and one response spool), independently
of filter count. Filter image-origin admission currently materializes each URI;
the trusted runtime's own document state is separate and must be measured.
Single-input RTF → JSON/plain/HTML/CommonMark/GFM/RST/LaTeX/RTF/ODT also uses caller-backed
source, parser state, document nodes and real Lua or JSON filters. Embedded picture
bytes stay in caller storage independently of filter document generations; JSON
output continues to reject resource sidecars even after a filter removes the images.
Embedded pictures survive Lua filter generations; JSON filters reject relative
image targets whose origin cannot be preserved. Finite font-count, include-count, image-count, binary-byte,
layout-work, archive-part, compressed-byte and expanded-byte budgets also retain
this path and their existing failures. ODT members remain in caller storage while
document validation precedes package-budget admission.
HTML image embedding (`embedResources: true` or `--embed-resources`) streams
image bytes and base64 text through caller storage, including local VFS images
and pictures retained from RTF. Templates and Lua image origins are preserved.
Other finite structural budgets still use the compatibility path.
Single-input JSON → plain text uses the same retained document and streaming
JSON filters. Its writer jobs, diagnostic paths, intermediate text, wrapping and
indentation use caller storage, including long words and nested lists. It preserves
the existing plain writer's constructors, raw-content policy and diagnostics.
Rendering uses three page caches (the document pair and writer); filter validation
still uses up to five. Plain text accepts `wrap` and `columns` on these paths.
JSON → JSON/plain/HTML also supports `shiftHeadingLevelBy` and `stripComments` through
caller-backed rewrite jobs and scalar slices. Rewrites run after filters, retain
both generations only until the old one is retired, and use at most four page
caches plus fixed small index caches. Metadata remains unchanged by these block
transformations, matching the convenience converter.
Single-input JSON → HTML retains writer calls, output, heading identifiers,
footnotes, attributes and table occupancy in caller storage. It supports the
existing HTML constructors, URL/attribute policy, raw-content diagnostics,
`standalone`, `toc`, `numberSections`, `ascii` and line endings. Unicode heading
normalization and duplicate identifiers stay bounded even for long text. Rendering
uses three page caches plus fixed small indexes; filter validation still uses up
to five. The SDK and command select this path with the same options.
JSON and CSV/TSV → CommonMark/GFM retain writer continuations, intermediate text,
code fences, link-reference collision indexes and table-span occupancy in caller
storage. Markdown aliases and extension switches, wrapping, task markers, rich
tables, loss diagnostics and post-filter transforms preserve the existing writer
behavior. Long targets, code runs and nesting do not grow resident writer state;
the document pair and writer use three page caches plus fixed small indexes.
JSON and CSV/TSV → RST also retain writer continuations, source-name collision
checks, identifiers, notes, tables and output in caller storage. Existing roles,
list-table rules, indentation, projections and diagnostics remain available; long
name searches keep their pattern and failure links in caller pages.
JSON and CSV/TSV → LaTeX retain labels, deferred notes, table columns/span
occupancy, repeated headers, writer jobs and output in caller storage. The fixed
standalone preamble, document metadata, math allowlist and URL/image-path checks
keep their existing behavior. Legacy filters, embedded resources, other transformations
and other finite document budgets continue through the compatibility converter.

JSON and CSV/TSV → RTF retain writer continuations, sorted font/color indexes,
list definitions, table columns and output in caller storage. Local pictures use
`resourceFiles.readStream`, honoring ordered `resourcePath` directories; data URI decoding, PNG validation and JPEG decoding
also use bounded transfers and caller backing storage. Explicit byte-only resource
resolvers and `readFile`-only capabilities remain buffering convenience boundaries.
Filesystem path strings and diagnostic messages still materialize; this does not
qualify all resource handling or conversion formats for bounded Worker memory.
Malformed base64 image data reports `E_RESOURCE` consistently across both paths.

JSON and CSV/TSV → ODT retain XML continuations, list styles, image indexes and
ZIP members in caller storage. PNG, JPEG, GIF, BMP and TIFF metadata use bounded
source reads; TIFF directory traversal also uses caller storage. Image dimensions
are parsed incrementally. The output preserves package member order, image density,
XML escaping and warning rejection. Other ODT input and compatibility paths still
materialize documents; the Worker measurement plan remains incomplete.

For media extraction, supply `workingFiles` and `resourceFiles.writeStream` to
spool external resources in caller storage and publish them in 16 KiB chunks.
The publisher must consume through EOF, await writes, and honor exclusive
creation (`flag: "wx"`). The command uses atomic streaming publication when the
injected provider advertises it. Resource resolution, preflight collision checks,
and cleanup remain in effect. Embedded image conversion and providers exposing
only `writeFile` still use byte buffers; the document AST and resource name index
remain resident. Resource byte budgets remain cumulative across streamed reads.

EPUB reads also accept `workingFiles` through `readDocument` and `convert`.
Streamed archives and expanded ZIP members use the bounded page cache and caller
backing storage, including ZIP names, span validation and member locations;
unused members are still CRC-checked. XML parts feed the parser incrementally.
XML trees and tokens, images, publication metadata and the document AST remain
materialized in memory.

CSV/TSV also feeds the retained filter and writer pipeline, including multiple
inputs, chained `applyJsonStream` filters, heading/comment transforms and standalone
HTML options. Filters see all input tables before transforms run. Source retirement
precedes output commit, including cleanup failure and cancellation.

The unfiltered backed CSV/TSV paths support line endings (and ASCII conversion for HTML) and finite
`inputBytes`, `outputBytes`, `tableRows`, `tableColumns`, `tableCells`, and
`tableFieldText` limits. With filters, finite input/output, work, diagnostics, font, include, image, binary-byte,
layout-work, archive-part, compressed-byte, expanded-byte, resource-count and resource-byte budgets are supported;
finite row, column and field-text limits remain on the retained reader path, including typed metadata.
Finite table-cell budgets with filters still use the compatibility converter. Limits for unrelated formats
(`glyphs`, `pages`, `objects`, `xmlDepth`, `xmlNodes`, `macros`, `directives`, `entities`,
`entityBytes`, `yamlAliases`) do not force these retained conversions to buffer.
Additional transformations, other finite limits,
and other format pairs
currently use the existing buffered converter. The Safe Bash command uses the
output-only API for stdout and selects backing storage in the injected filesystem
at `TMPDIR` or the command directory. `-o` streams into the supplied filesystem’s atomic
`publishFileConditional` capability when available; byte-only atomic providers
retain the buffered compatibility path. SDK hosts can use
`createFileOutput(fs, path, {expected, parent, maxBytes, signal})` with
`convertToOutput`; the sink retains the supplied publication guards and waits for
commit before completing. Standalone hosts can pass `workingFiles` to
`createStandalonePandocCommand` explicitly. For standalone file output, supply
`CommandInputs.createOutput(path, signal)` returning a streaming sink such as
`createFileOutput`. The host supplies path resolution and publication guards;
the adapter creates the sink lazily after preflight and awaits commit or cleanup.
This capability takes precedence over `writeFile`, which remains a buffered
compatibility option. These remaining buffered paths are
not yet suitable for files larger than Worker memory.

Conversion-only `filters` is an ordered list of `{kind: "json", path}`,
`{kind: "lua", path}`, or `{kind: "citeproc"}` requests. Shell equivalents are
`--filter`/`-F`, `--lua-filter`/`-L`, and `--citeproc`/`-C`.
Supply `ConversionContext.filters.apply(document, request, context)` (or the
same capability to `createPandocCommand`) to process them after metadata merges
and before writing. The callback receives the target format as `context.to`.
An optional `supports(request)` check rejects unsupported requests before any
input is acquired. Requests are snapshotted before these checks. Returned documents
are validated with the conversion limits; cancellation and callback errors prevent publication. Without an
explicit capability these requests fail `E_CAPABILITY` before input acquisition.
Paths identify requests for the trusted adapter; they never enable implicit
host execution, filesystem access, or citation support.

`createJsonFilterCapability(runtime)` adapts an explicitly supplied JSON-filter
runtime to this capability. Its `run({path, args, stdin, stdout, signal})` method
receives Pandoc JSON API `[1,23,1,2]` bytes and the base target writer name as its
sole argument (extension suffixes are removed; aliases are preserved). Await `stdout.write(bytes)` for each output chunk and return the numeric
exit status after runtime cleanup. Alternatively, supply
`runStream({path, args, stdin, stdout, signal})`, whose `stdin` is an async byte
iterable. This enables retained JSON conversion in `convertToOutput`; the CLI
also streams interpreter input and output. The adapter slices input and output
into owned chunks of at most 16 KiB, allows one outstanding output write, and
closes unread input on completion. Runtimes must await writes and honor aborts.
Providing both methods preserves legacy document calls while using `runStream`
for retained conversions.
The runtime always receives a scoped cancellation signal: caller cancellation and
output-write failures abort it, and it closes when the runtime returns or throws.
Output is copied and charged against shared input budgets (and retained-byte
budgets on the compatibility path), then decoded and validated before the next filter or
writer runs. Invalid JSON, nonzero status, cancellation, and limit failures prevent
publication. Document-level resources, language, and direction stay outside the
JSON protocol and are preserved across filters. Source documents with relative
image targets are rejected because their source-directory information cannot survive
arbitrary JSON filtering. Absolute and URL image targets retain their existing writer
and resource policies. Lua uses the explicit capability below. For genuine CSL
citations and bibliography, import `createCiteprocFilterCapability` from
`@poe-platform/safe-bash/commands/pandoc` and supply `{style, locale, references}`. Here
`style` and `locale` are CSL XML strings and `references` is an array of CSL JSON
items with unique string IDs. Pass the result as `filters`; `--citeproc` and `-C`
then process citation-bearing Pandoc JSON, including author suppression, textual
citations and note styles, and append the bibliography. Prefixes and suffixes
currently require plain text. No styles, locales or bibliography files are fetched.
Use trusted CSL data: citeproc-js runs synchronously without instruction isolation.
The engine is Frank Bennett's citeproc-js, licensed under CPAL or AGPL.

The Safe Bash plugin accepts the same capability as `pandocCommands({filters})`.
For example, with your already configured `jsonRuntime`:

```ts
import {createJsonFilterCapability} from "@poe-platform/safe-bash/commands/pandoc";
import {pandocCommands} from "@poe-platform/safe-bash/commands/pandoc";

const filters = createJsonFilterCapability(jsonRuntime);
shell.use(pandocCommands({filters}));
await shell.exec("pandoc -f commonmark -t html -F ./identity.py sample.md");
```

The runtime owns filter loading and execution. Registration does not grant it
filesystem or process authority, install an interpreter, or enable ambient lookup.

Local Lua AST filters can run in the supplied JavaScript Lua VM. Configure a
stream reader for trusted scripts, then pass the capability to the SDK or shell plugin:

```ts
import {createLuaFilterCapability} from "@poe-platform/safe-bash/commands/pandoc";
const filters = createLuaFilterCapability({
  readStream: (path, signal) => configuredFileSystem.readStream(path, {signal, chunkSize: 65536})
});
await convert([{bytes: new TextEncoder().encode("Hello")}], {
  from: "commonmark", to: "html", filters: [{kind: "lua", path: "uppercase.lua"}]
}, {filters});
// uppercase.lua: function Str(el) el.text = string.upper(el.text); return el end
```

The VM exposes basic Lua, string, table, math and UTF-8 libraries and `FORMAT`.
Its bundled VM works without Node globals or built-in modules, including in Workers.
The stream reader compiles source incrementally, without collecting the script first.
Compiler-owned source copies are capped at 64 KiB even when a reader supplies larger
chunks; source bytes count toward cooperative work and cancellation checkpoints.
The shell uses the injected filesystem’s stream reader when available; an explicitly
buffered reader remains supported for compatibility. For the retained JSON/CSV
conversion routes targeting JSON, plain text, HTML, Markdown, RST, LaTeX, RTF or ODT,
and the RTF text conversions described above,
`convertToOutput` with `workingFiles` runs Lua through caller-backed
compiler, VM, tables, strings and document storage with fixed page caches. Use an
external safe-fs backend for large files. RTF/ODT preserve image-origin sidecars in caller storage, including unchanged
targets across filter generations and post-filter transformations. Other conversion routes and the buffered
`apply` convenience API still use the resident VM; streaming source alone does not
bound their allocations. Streams close after compilation, syntax errors or cancellation.

For bounded diagnostic delivery, configure `onError(error, message)` on the Lua
capability and consume the async byte stream inside that callback. It runs before
scratch storage closes; the same error is then thrown by conversion. The command
writes these chunks to stderr. Without `onError`, the SDK collects the error text
into `Error.message` for compatibility. Retaining the iterator after the callback
returns is unsupported.

Neither VM exposes host filesystem/process libraries. Conversion work limits,
yield checkpoints and timer cancellation apply to retained execution, including
native library loops and callbacks. Use trusted scripts; this is not an isolation
boundary. `readStream` takes precedence when both readers are supplied.
Both `createLuaFilterCapability({readFile})`
and `createLuaFilterCapability(loadScript)` accept the same filters. Define global
callbacks, return one callback table, or return a list of tables to run in order.
Within each table, inline callbacks run before `Inlines`, block callbacks, `Blocks`,
`Meta`, and `Pandoc`. Callback identities remain fixed if the script changes globals.

Callbacks cover the document's inline and block elements, including headers,
paragraphs, code, links, images, spans, divs, lists, tables, and raw content.
Return an element, a replacement list (empty deletes the element), or nil to
preserve the original. Use `pandoc.Header`, `pandoc.Para`, `pandoc.Plain`,
`pandoc.Code`, `pandoc.CodeBlock`, `pandoc.Link`, `pandoc.Image`, `pandoc.Span`,
`pandoc.Div`, `pandoc.RawInline`, `pandoc.RawBlock`, and the inline constructors
such as `pandoc.Str` and `pandoc.Emph` to create replacements. `pandoc.List`
provides list operations; `pandoc.utils.stringify` extracts text from elements.
For example:

```lua
return {
  {Header = function(el) el.level = 2; return el end},
  {Para = function(el) return pandoc.Plain(el.content) end}
}
```

`FORMAT` contains the target writer name without extension suffixes and is
available while the script loads. Scripts run in a fresh VM; script bytes and
returned AST values share conversion budgets. This capability does not process
citeproc; use the separate CSL capability above.

`limits` configures optional resource budgets. EPUB, ODT, and PPTX archive paths and
text metadata use `text`; binary archive metadata uses `binaryBytes`. Every exported `defaultLimits` value
is `Infinity` (disabled); finite limits accept nonnegative safe integers, and explicit `Infinity` is accepted: `inputBytes`,
`resourceBytes`, `outputBytes`, `nodes`, `depth`, `work`, `retainedBytes`, `text`,
`attributes`, `tableCells`, `tableFieldText`, `tableRows`, `tableColumns`,
`resources`, `diagnostics`, `references`, `entities`, `entityBytes`,
`compressedBytes`, `expandedBytes`, `parts`, `xmlDepth`, `xmlNodes`, `binaryBytes`,
`macros`, `includes`, `directives`, `fonts`, `glyphs`, `pages`, `objects`, `images`,
and `layoutWork`. See [the exported types](src/types.ts) for adapter contracts.

## Environment variables

The runtime exposes no environment variables. The RST development conformance
runner accepts `PANDOC_DOCUTILS_PYTHON` to select its Python executable (default:
`python3`).
