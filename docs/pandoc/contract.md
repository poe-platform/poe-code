# Original TypeScript Pandoc conversion contract

## Status and ownership

This is the normative delivery contract, not an implemented-capability claim.
As inspected on 2026-09-16, `packages/pandoc` is absent. Every required reader,
writer and option below must be implemented and independently verified before it
is advertised as available. A missing implementation returns `E_CAPABILITY`;
it does not delegate to native Pandoc. Contract completion does not complete the
remaining tasks in [the implementation plan](../plans/pandoc-typescript-safe-bash.md).

Conversion logic belongs in private `packages/pandoc`. The safe-bash `pandoc`
command is a thin adapter over the same SDK validation and conversion path;
there is no new root CLI subcommand. Proposed SDK operations are `readDocument`,
`writeDocument` and `convert`; these names are not delivered exports yet. PDF
layout/font metrics/serialization belong in a TypeScript PDF package, with an
AST adapter in pandoc. ZIP codecs belong to their shared codec owner.

No native runtime fallback, subprocess, TeX compiler, browser process, native
PDF engine, WASM Pandoc, arbitrary code execution, implicit host filesystem,
ambient environment lookup or network access is permitted. Conversion does not
change the independent DOCX/PPTX editor specifications or promise preservation
editing, application layout fidelity or formula recalculation.

## Required formats and defaults

Names are case-sensitive. Only output `html` aliases `html5`. File suffixes below
are inference hints usable only with `--yes`; they are not format aliases.
Extensions are dialect switches, not filename suffixes.

| Format       | Read             | Write            | Default profile and inference suffixes                                                                                  |
| ------------ | ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `commonmark` | Required         | Required         | CommonMark 0.31.2, raw HTML represented explicitly; `.md`, `.commonmark`                                                |
| `gfm`        | Required         | Required         | CommonMark plus pipe tables, strikethrough, task lists and extended autolinks; GFM disallowed raw tags rejected; `.gfm` |
| `html`       | Required         | Alias of `html5` | HTML5 structural parsing and recovery; `.html`, `.htm`                                                                  |
| `html5`      | Rejected         | Required         | Escaped semantic fragment by default, fixed wrapper with standalone; `.html`, `.htm`                                    |
| `json`       | Required         | Required         | Pandoc JSON API version exactly `[1,23,1,2]`, validated constructors; `.json`                                           |
| `csv`        | Required         | Rejected         | Comma, double-quote quoting/escaped quotes, embedded quoted newlines; `.csv`                                            |
| `tsv`        | Required         | Rejected         | Tab delimiter, otherwise same quoting rules as CSV; `.tsv`                                                              |
| `plain`      | Rejected         | Required         | Ordered readable text projection; `.txt` output only                                                                    |
| `latex`      | Required         | Required         | Bounded document syntax described below; fragment by default; `.tex`, `.latex`                                          |
| `rst`        | Required         | Required         | Bounded reStructuredText directives/roles below; `.rst`                                                                 |
| `rtf`        | Required         | Required         | RTF 1.9.1 bounded control profile below, complete document; `.rtf`                                                      |
| `epub`       | EPUB2/3 required | EPUB3 required   | Reflowable, unencrypted publication; `.epub`                                                                            |
| `pdf`        | Rejected         | Required         | PDF 1.7 through TypeScript layout, complete document; `.pdf` output only                                                |
| `docx`       | Gated            | Gated            | OOXML document conversion; `.docx`                                                                                      |
| `pptx`       | Gated            | Gated            | OOXML presentation conversion; `.pptx`                                                                                  |
| `xlsx`       | Gated            | Rejected         | Worksheet tables from cached values; `.xlsx`                                                                            |

LaTeX, RST, RTF, EPUB and PDF are all required delivery scope, not optional
follow-ups. EPUB2 writing, PDF reading/OCR, `markdown`, `commonmark_x` and every
unlisted format are explicitly deferred and rejected with `E_FORMAT`.
Pandoc Markdown is a different dialect; `markdown` must never select CommonMark.

The only configurable dialect switches are `gfm+pipe_tables`,
`gfm+strikeout`, `gfm+task_lists`, `gfm+autolink_bare_uris` and the corresponding
`-name` forms. All four default on, for both directions. A disabled switch makes
its syntax ordinary CommonMark input; writing its corresponding AST feature
requires the loss policy below. Other `+extension`/`-extension` combinations,
including switches on other formats, return `E_EXTENSION`; repeated switches
apply left to right. No smart typography, citations, math, YAML front matter,
footnotes or attribute extensions are implicitly enabled for CommonMark/GFM.

CSV/TSV preserve strings, empty cells and row order without numeric inference or
formula evaluation. The first row is data, not a header. Short rows are padded
with empty cells; a wider later row expands earlier rows. Empty input yields no
blocks; a blank record yields one empty cell. CRLF and LF record endings are
accepted. Malformed quoting fails. Each input produces a separate AST table.

## AST and loss policy

The validated AST preserves metadata, paragraphs, headings (levels 1–6), ordered
and bullet lists, task state, quotes, code, rules, line breaks, emphasis, strong,
strikeout, superscript/subscript, links, images with alt text, spans/divs with
attributes, notes, figures with captions, math and raw nodes, and modern tables
with captions, headers, bodies, footers, alignment and cell spans. JSON uses
Pandoc constructors and tuple shapes, not an invented JSON document dialect.
Unknown constructors, invalid shapes, invalid Unicode and invalid table geometry
are errors, even with `--lossy`. Raw and math nodes are data, never executable.

Default conversion is strict: a reader feature outside its declared profile or
an AST feature that the writer cannot represent returns `E_UNSUPPORTED_FEATURE`,
with format, feature and source/AST location. No silent node disappearance,
flattening of content, replacement glyphs or opaque native fallback is allowed.

`--lossy` permits only these explicit reductions, each producing
`W_LOSSY` with feature, location and chosen replacement: unsupported styling or
attributes unwrap to children; unsupported containers flatten in document order;
notes become numbered endnotes; spans in tables expand to a rectangular table
with content in the anchor cell and empty covered cells; unsupported math becomes
literal source text; unsupported raw syntax becomes literal source text;
unsupported media becomes alt text plus its declared target; unsupported
noncontent layout/control information is omitted. Unknown reader constructs
must retain their literal source as text when this reduction is possible.
If meaningful content cannot be recovered, conversion still fails. Lossy never
relaxes malformed input, unsafe resources, encoding, limits or capability gates.

Plain writing is a separately classified **intended projection**, successful in
strict mode: formatting/attributes and presentation layout disappear; headings
and paragraphs retain text, lists retain markers/task state, code retains literal
text, links retain label plus distinct target, images retain alt text and target,
notes become numbered endnotes, math/raw become literal source, captions precede
tables/figures, and table rows use tabs with embedded tabs/newlines escaped as
`\t`/`\n`. This produces `I_PROJECTION`, not `W_LOSSY`. Missing content or
unsupported opaque objects remain accidental loss and require the normal policy.

CommonMark represents its native nodes only; GFM additionally represents the four
listed extension features. HTML5 represents semantic tables with spans, notes as
linked endnotes, figures, spans/divs and attributes. HTML math is escaped literal
source with a `math` class, never rendered by a script. Raw HTML can be emitted
only through the structural safety profile below; raw syntax of another format
requires lossy literal projection. JSON preserves all valid listed AST nodes.
Other writers support only their profiles below; nonrepresentable nodes follow
the same strict/lossy rules.

## Additional format profiles

### LaTeX

Read grouping, escaped punctuation, comments, `document` wrappers, sections
through subparagraph (mapped to levels 1–6), paragraphs, emphasis/bold,
text superscript/subscript, itemize/enumerate/description, quote, verbatim,
`\texttt`, `\href`, `\url`, `\includegraphics`, footnotes, figure/caption,
and rectangular `tabular` with `l/c/r` columns. Preserve inline/display math
source in math nodes without evaluation. Write these structures with escaping;
standalone uses a fixed `article` wrapper with only the required `hyperref` and
`graphicx` declarations. Description lists outside the AST become term-led
paragraphs within list items. Advanced table column programs and layout are
unsupported features.

No macro expansion: `\def`, `\newcommand`, category-code changes, conditionals,
package-defined commands and unknown commands are unsupported. No `\input`,
`\include`, shell escape, file reads, package loading or external TeX execution.
Includes return `E_RESOURCE_DENIED` even with lossy; package declarations are
accepted only for the fixed writer packages and carry no execution semantics.
Macro definitions cannot be used to execute or synthesize document content.
Lossy unknown commands retain literal command and arguments rather than guessing
expansion. The writer never emits user-controlled executable preambles.

### RST

Read/write sections by adornment, paragraphs, emphasis/strong/literals, bullet
and enumerated lists, block quotes, literal blocks, links/targets, footnotes,
image/figure with alt and caption, simple/grid rectangular tables and line blocks
(mapped to explicit line breaks). Supported directives are `image`, `figure`,
`code`, `code-block`, `note`, `warning`, `admonition`; language is a code class,
admonitions are attributed divs. Supported roles are `emphasis`, `strong`,
`literal`, `subscript`, `superscript`, `math`; math is preserved source.
Substitution definitions support literal text/image values only, with bounded
acyclic resolution. Unknown roles/directives are unsupported features.

`include`, `raw`, file insertion options, executable directives and custom role
registration return `E_RESOURCE_DENIED`, including in lossy mode. No docutils,
Python or plugin execution. Writer section adornments are fixed in level order
`=`, `-`, `~`, `^`, `"`, `+`; tables use grid syntax. Unsupported spans follow
loss policy; whitespace-sensitive literals must preserve content.

### RTF

Read byte-oriented groups, destinations and scoped state; support `\rtf1`,
`\ansi`, `\ansicpg1252`, `\ansicpg65001`, font/colour tables,
`\f`, `\fs`, `\cf`, `\b`, `\i`, `\ul`, `\ulnone`, `\strike`,
`\super`, `\sub`, `\nosupersub`, `\plain`, `\pard`, `\par`,
`\line`, `\tab`, escaped braces/backslash, `\'hh`, signed UTF-16
`\uN` with scoped `\ucN` fallback skipping, and surrogate pairs. Other code
pages, `\mac`/`\pc`/`\pca` and per-font charset switches requiring another
encoding return `E_ENCODING`. Validate truncated escapes/binary lengths.

Support paragraph alignment `\ql`/`\qc`/`\qr`, indent controls
`\li`/`\ri`/`\fi`, heading `\outlinelevel`, list tables/list overrides,
`\trowd`/`\cellx`/`\intbl`/`\cell`/`\row` rectangular tables,
footnote destinations, `HYPERLINK` fields as links, and `\pict` PNG/JPEG
hex or length-delimited binary data. Alignment/indent have attributed AST
representations; writers lacking them invoke loss policy. Other field instructions
are retained as unsupported data and never evaluated. Objects, embedded fonts,
OLE, drawing programs and unsupported table merges are unsupported features.
Known noncontent generator/revision bookkeeping may be ignored as lexical
normalization; all other unknown control words/destinations, including ignorable
`\*` destinations, require strict rejection or a lossy diagnostic.

Write ASCII RTF `\rtf1\ansi\ansicpg1252\uc1`, escaped ASCII, signed UTF-16
`\uN?` for non-ASCII, stable font/colour/list tables and PNG/JPEG pictures.
No platform-dependent encoding or implicit image conversion. Writer uses 12pt
serif default and represents headings through outline levels, not guessed styles.

### EPUB

Read EPUB2 OPF/NCX and EPUB3 OPF/nav, container rootfile, manifest, spine order,
local XHTML chapters, metadata, intra-publication links and local PNG/JPEG images.
One rootfile is allowed; multiple rootfiles, missing spine members, duplicate IDs,
invalid ZIP/XML, encryption/DRM, obfuscated fonts and remote spine resources fail.
Nonlinear spine entries are appended after linear entries with an explicit
`I_PROJECTION` ordering diagnostic. NCX/nav navigation is retained as a metadata
outline; chapter text is read once in spine order, not duplicated from navigation.

Write EPUB3 reflowable XHTML, one chapter per level-1 heading (one chapter when
none), OPF, container, required nav TOC and optional cover only from a supplied
PNG/JPEG resource marked by metadata `cover-image`. `mimetype` is first,
uncompressed and exactly `application/epub+zip`. Output has no EPUB2 mode, fixed
layout, audio/video, scripts, forms, SVG rendering, MathML rendering or embedded
fonts. Such meaningful input features require explicit lossy reductions; unsafe
active content returns `E_RESOURCE_DENIED`.

CSS is parsed as data: support type/class selectors and `font-weight`,
`font-style`, `text-decoration`, `text-align`, `white-space` (normal/pre/pre-wrap).
Map supported styles to AST semantics; cascade uses specificity then source order,
without DOM execution. Other declarations/selectors require strict rejection or
lossy omission. No `@import`, `url()` fetch, CSS expressions or network. Writer
emits a fixed local stylesheet for its semantic elements; custom `--css` is
rejected. Relative media/navigation targets must resolve within the publication;
external ordinary hyperlinks remain links but are never fetched. Media packaging
includes only referenced admitted images, with stable names and rewritten links.

### PDF

Required output is PDF 1.7, text searchable, deterministic, produced by a
TypeScript font/layout/object engine; the dependency is not delivered yet.
Default A4 portrait, 54pt margins, serif 12pt, 1.2 line height, left alignment,
no hyphenation or header/footer. Paragraphs, level-1–6 headings, lists, quotes,
code, links, PNG/JPEG images, captions, notes as endnotes and rectangular tables
are required. Headings keep with the next block; lines wrap at whitespace;
long unbreakable runs wrap at Unicode scalar boundaries. Tables repeat header
rows and split between rows; a row taller than the content area fails `E_LAYOUT`.
Images fit available width/height preserving aspect ratio. No content is clipped.

Required bundled, licensed, version-pinned serif/sans/mono fonts must cover the
advertised Latin/Greek/Cyrillic repertoire and be embedded with stable subsets;
actual font files/licences and engine must be verified before PDF availability.
No system-font discovery. Explicit font bytes may be supplied through the resource
capability as TrueType outlines; CFF, variable/colour fonts and unsupported shaping
are rejected. Complex scripts/bidi outside the verified shaping profile fail
`E_LAYOUT`; missing glyphs never silently substitute. Lossy is not permission to
replace text with boxes. No arbitrary CSS, TeX, browser layout, PDF/A, PDF/UA,
encryption, signatures, attachments, JavaScript or PDF input/OCR.

Supported layout options below select page geometry and bundled family/size only.
Math/raw source uses literal text projection with the corresponding diagnostic;
unsupported layout follows strict/lossy policy. Document title/author populate PDF
information fields; hyperlinks generate safe URI/internal link annotations and
headings generate bookmarks. No creation/modification timestamps are invented.

## Office capability gate

These are separate reader/writer gates, never inferred from a suffix or merely
from a package directory. All are blocked for converter activation today.

| Capability | Real dependency or blocked gate                                                                                                                  | Required conversion behavior after verification                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| DOCX read  | Existing `docx` workspace, `packages/docx/src/index.ts`: `readDocumentArchive`, `openDocumentLocations`; AST adapter unverified                  | Main story in order, headings/lists/tables/links/images/notes; other stories/objects diagnosed          |
| DOCX write | Existing `docx`: `createDocument`, `writeDocumentArchive`; complete AST authoring adapter unverified                                             | Fresh OOXML document for supported AST; no preservation-edit promise                                    |
| PPTX read  | Existing `pptx` workspace, `packages/pptx/src/index.ts`: `readPresentationText`, `readTables`, `readImages`, `readNotes`; AST adapter unverified | Slide order, shape document order, slide-boundary divs, tables/images and notes                         |
| PPTX write | Existing `pptx`: `createPresentation`, `addSlide`, `addTable`, `addImage`; authoring/layout adapter unverified                                   | Level-1 headings start slides, fixed 16:9 title/body layout; overflow fails `E_LAYOUT`                  |
| XLSX read  | No sibling XLSX SDK found; blocked pending a real typed, bounded workbook reader                                                                 | Workbook worksheet order, sheet heading and cell table; cached formula values only, missing caches fail |
| XLSX write | Explicitly prohibited                                                                                                                            | `E_FORMAT`, no adapter or writer in this scope                                                          |

Activation requires public byte/capability consumer checks, AST fidelity/loss
checks, cancellation/budget checks and independent package structure verification
for that specific direction. Editors/ZIP admission alone do not satisfy this gate.
XLSX dates use declared workbook epoch and number format, never local timezone;
merged cells follow AST spans, charts/macros/external links are diagnosed and
never executed. No Python bridge, Office application or network fallback.

## CLI and SDK options

Syntax: `pandoc -f FORMAT -t FORMAT [OPTIONS] [INPUT ...]`. `--` ends options.
Long options accept `--name=value` or a following value. Short value options
accept separate or attached values; short option clusters are rejected.
Unknown flags and positional options in the wrong operation return `E_OPTION`.
The following is the entire advertised flag set; native flags not listed are
explicitly rejected, including filters, Lua, citeproc, templates, defaults files,
reference documents, resource paths, extract-media, includes, CSS, PDF engines,
highlight styles and native variable `-V`.

| CLI                                             | Proposed SDK option       | Concrete behavior/default                                                                                                                                  |
| ----------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-f`, `--from`, `--read`                        | `from`                    | Reader name plus valid switches; required unless `yes`                                                                                                     |
| `-t`, `--to`, `--write`                         | `to`                      | Writer name plus valid switches; required unless `yes`                                                                                                     |
| `-o`, `--output`                                | Output capability binding | Destination only; absent or `-` means byte stdout; never authorizes writer selection                                                                       |
| `--yes`                                         | `yes: true`               | Opt into inference/defaults below; default false                                                                                                           |
| `--lossy`                                       | `lossy: true`             | Explicit warning-producing reductions; default false                                                                                                       |
| `-s`, `--standalone`                            | `standalone: true`        | HTML fixed wrapper, LaTeX fixed article; default false. Complete-document binary/RTF writers accept as redundant; other writers reject                     |
| `-M`, `--metadata KEY=VALUE`                    | `metadata`                | Set literal string value, split at first `=`, nonempty key; repeat last wins; no YAML parsing                                                              |
| `--wrap=auto\|none\|preserve`                   | `wrap`                    | Text writers only; default none. Auto wraps prose to columns without changing code/table/literal content; preserve retains source soft breaks when present |
| `--columns=N`                                   | `columns`                 | Text writers only, integer 20–240, default 80; affects auto wrapping only                                                                                  |
| `--pdf-page-size=a4\|letter`                    | `pdf.pageSize`            | PDF only, default a4                                                                                                                                       |
| `--pdf-orientation=portrait\|landscape`         | `pdf.orientation`         | PDF only, default portrait                                                                                                                                 |
| `--pdf-margin=N`                                | `pdf.margin`              | PDF only, all margins in points, finite 0–144, default 54; geometry must leave content area                                                                |
| `--pdf-font=serif\|sans\|mono`                  | `pdf.font`                | PDF only, verified bundled family, default serif                                                                                                           |
| `--pdf-font-size=N`                             | `pdf.fontSize`            | PDF only, finite points 6–72, default 12                                                                                                                   |
| `--pdf-line-height=N`                           | `pdf.lineHeight`          | PDF only, finite multiplier 1–3, default 1.2                                                                                                               |
| `--help`, `-h`                                  | Not conversion            | Usage/options/capability status, exit 0; combined only with help flags                                                                                     |
| `--list-input-formats`, `--list-output-formats` | Capability descriptors    | Available directions only, sorted names one per line; either/both accepted alone, both labelled; blocked formats excluded                                  |

Text wrapping options apply only to commonmark, gfm, rst, latex and plain.
JSON/HTML serialize with their fixed policy. Invalid or inapplicable options
fail before I/O; unsupported options are never ignored, even with lossy.

Explicit SDK/CLI values override reader metadata and inference, which override
format defaults. Repeated scalar CLI options use last value; metadata overrides
merge recursively by key (arrays replace, not concatenate). Resource capabilities,
AbortSignal and budget ceilings are SDK/context-only, never CLI escalation flags.
The CLI calls the SDK rather than maintaining separate conversion semantics.

Without `--yes`, both formats must be explicit, even with filenames or `-o`.
Safe-bash does not prompt: missing selection exits 2 with, for example,
`E_FORMAT_REQUIRED: select both formats: pandoc -f commonmark -t html5 input.md -o output.html; use --yes to accept inference/defaults`.

With `--yes`, explicit selections still win. Infer omitted reader from a known
input suffix; all multiple-input suffixes must agree. No inputs, stdin `-` or
extensionless inputs default to commonmark only when there are no conflicting
known hints. Unknown/ambiguous suffixes or incompatible hints require explicit
`-f`. Infer omitted writer from a known `-o` suffix only because yes opted in;
stdout/extensionless output defaults to html5. Unknown suffixes require explicit
`-t`. `.md` means this contract's commonmark, not native Pandoc Markdown.
`.txt` input cannot infer a reader. Gated/deferred formats never silently substitute.

## Bytes, inputs, metadata and resources

Text inputs use strict UTF-8, optional initial UTF-8 BOM removed; malformed bytes
return `E_ENCODING`. LF/CRLF normalize to LF except literal content whose AST
retains the distinction. RTF uses its declared byte profile; EPUB/Office are ZIP
bytes with XML declaration-aware UTF-8/UTF-16 decoding. Other declared encodings
fail. Text outputs are UTF-8 without BOM and LF, with one terminal newline;
RTF output is ASCII as specified. Binary output is raw `Uint8Array`, never base64
or transcoded shell text. SDK results discriminate text/binary and include typed
diagnostics; inputs/results/resource bytes have explicit ownership and are not
mutated by the engine.

No input paths means stdin; explicit `-` consumes stdin once, and repetition
fails `E_OPTION`. All inputs are parsed independently in argv order using one
selected reader; their blocks are concatenated, not their bytes. References,
macros and substitutions cannot cross input boundaries. IDs are namespaced by
stable input index and links rewritten consistently. Metadata maps merge in input
order, later conflicting scalar/array values replace with `W_METADATA_CONFLICT`;
explicit metadata overrides apply last without a conflict warning. Structured
metadata can be supplied through SDK or JSON; CLI metadata values remain strings.

Title, author (string/list), date, lang and identifier are preserved as typed
metadata. Other keys survive AST/JSON; unsupported rendering metadata is not
body content and produces `I_PROJECTION`. Standalone HTML uses title/lang and
escaped author/date metadata; LaTeX uses title/author/date; EPUB requires title,
lang and identifier, defaulting under yes to `Untitled`, `en` and a stable
content-derived identifier. Without yes, absent required EPUB metadata is
`E_METADATA`. EPUB's required modified date is fixed `1970-01-01T00:00:00Z` unless
explicit date is a valid UTC timestamp. Other outputs never invent date/author.

Resources are admitted through explicit bounded SDK resolver/VFS capabilities,
relative to each input's base, never ambient cwd in the engine. Paths escaping
the admitted root, symlinks escaping it, remote fetch, XML external entities,
archive traversal and executable URLs return `E_RESOURCE_DENIED`. Ordinary
http/https/mailto hyperlinks are preserved without fetching; javascript and active
content are denied. PNG/JPEG signatures and dimensions must validate; no external
image converters. Text writers can retain image references without loading bytes;
packaging/layout writers must resolve required bytes or fail `E_RESOURCE_MISSING`.
HTML scripts, event attributes, executable embeds and active forms are denied;
unsupported inert elements follow feature loss policy. CSS is never executed.

## Determinism, budgets and failures

Identical admitted inputs/resources/options produce identical output bytes and
ordered diagnostics: input order then source/AST location, then diagnostic code.
Use locale-independent ordering/numbers, stable generated IDs, sorted JSON map
keys (array order preserved), fixed HTML escaping, stable archive entry order,
ZIP timestamps fixed to 1980-01-01, pinned compression, stable PDF object/font
subset order and no randomness, runtime timestamps or platform font discovery.
Reader recovery is deterministic, with `W_RECOVERY` for structural HTML repair;
recovery cannot drop content outside the loss policy.

Baseline ceilings per conversion: 32 MiB aggregate input, 64 MiB decoded resource
bytes, 64 MiB output, 100,000 AST nodes, nesting depth 128, 1,000,000 table cells,
10,000 archive entries, 128 MiB archive expanded bytes, 100:1 member expansion
ratio, 40 megapixels per image, 1,000 PDF pages and 1,000,000 bounded work units.
A work unit is one parser token, AST node visit, CSS comparison, substitution
step, layout candidate or archive entry visit; byte/decompression loops charge
at least once per 4 KiB. SDK hosts can lower limits; CLI cannot raise host
ceilings. Cancellation is checked at work-budget checkpoints and before publish.
No optional unsafe or unbounded mode.

| Code                                                | CLI status | Meaning                                                            |
| --------------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| `E_FORMAT_REQUIRED`                                 | 2          | Missing explicit formats; actionable usage                         |
| `E_FORMAT`, `E_EXTENSION`, `E_OPTION`, `E_METADATA` | 2          | Rejected name/direction, switch, flag/value or required metadata   |
| `E_CAPABILITY`                                      | 3          | Required implementation or Office/font dependency gate unavailable |
| `E_PARSE`, `E_AST`, `E_ENCODING`                    | 4          | Malformed document/AST/bytes; location when available              |
| `E_UNSUPPORTED_FEATURE`                             | 5          | Strict feature rejection or reduction impossible                   |
| `E_RESOURCE_DENIED`, `E_RESOURCE_MISSING`           | 6          | Unsafe or unavailable resource                                     |
| `E_LIMIT`                                           | 7          | Budget exhausted, names limit and actual usage                     |
| `E_LAYOUT`                                          | 8          | Missing glyph/shaping or impossible layout                         |
| `E_IO`                                              | 9          | Input/output capability failure                                    |
| `E_CANCELLED`                                       | 130        | Aborted conversion                                                 |
| `E_INTERNAL`                                        | 1          | Unexpected implementation failure, sanitized diagnostic            |

SDK errors carry the same stable codes, operation, format and location/details;
CLI emits `CODE: message` on stderr. Warnings/info never enter conversion stdout.
Successful conversions with warnings still exit 0. Validate options/capabilities,
read, transform and serialize before publishing: conversion errors produce no
output and leave existing destination unchanged. VFS replacement must be atomic;
missing atomic capability returns `E_CAPABILITY`. Explicit `-o` authorizes replacing
that destination only; input aliasing is safe because inputs are read first.
A downstream stdout/sink failure may leave already-published bytes and returns
`E_IO`; no rollback guarantee is claimed for stream consumers.

## Intentional differences from native Pandoc

This bounded original TypeScript implementation intentionally differs in format
coverage, extension defaults, strict loss detection, warning/info codes and exit
statuses. It requires explicit formats unless yes; filenames alone do not select
writers. Markdown is deferred, `.md` inference under yes is CommonMark, and HTML5
has no separate reader alias. Plain has no reader and is an explicit projection.
Multi-input documents are parsed independently, IDs namespaced, metadata merged
as specified; there is no raw-byte concatenation or cross-file reference scope.
JSON version admission is exact rather than accepting arbitrary API versions.

LaTeX never runs TeX or expands macros/includes; RST never executes directives;
RTF uses the listed code pages/control profile rather than general application
rendering. EPUB writes only EPUB3 with bounded semantic CSS/media and fixed
metadata defaults. PDF is laid out in TypeScript rather than delegated to native
Pandoc's external engines. Office conversion is separately gated and limited to
verified structural mappings, with no XLSX writer or editor preservation promise.
Templates, defaults files, plugins/filters, citation processing, native variables,
network resolution, external renderers and all unlisted flags are rejected.
Serialization, dates, IDs, fonts and packaging are deterministic by contract;
byte identity with native Pandoc output is not promised.

Acceptance of this contract means every format/direction and advertised flag
above has a defined behavior or rejection, and each Office direction has a named
existing dependency or blocked gate. Runtime delivery still requires original
failing-first tests, maintained scoped checks and the remaining implementation
plan's independent evidence. Unit mutations use memfs; unit tests use no host
scratch files, LLMs, downloaded fixtures or external executables. Planning and QA
procedures stay under `docs/plans`; conversion evidence stays under `docs/pandoc`.
