# Original TypeScript LaTeX output profile

The SDK `writeDocument`/`convert` and existing byte-only safe-bash command accept
`to: "latex"` / `-t latex`. Serialization lives entirely in packages/pandoc.
There is no native fallback, compilation, shell escape, template engine, or PDF
backend change. The supported options are `wrap: "none"`, `standalone`, metadata,
raw-content policy, lossy mode and the existing shared resource/limit options.
No new environment variables are exposed.

Standalone output has one original fixed article preamble. Fragments omit the
wrapper and require the same packages in their enclosing document:

| Package | Purpose |
| --- | --- |
| fontenc (T1), inputenc (utf8) | Text encoding |
| babel | Finite language selection |
| amsmath, amssymb | Preserved math source |
| graphicx | Local images |
| array, longtable, multirow | Paragraph columns, page breaks, spans |
| enumitem | Ordered-list starts, styles and delimiters |
| ulem (normalem) | Underline and strikeout |
| hyperref | Internal and external references |

The preamble targets a modern LaTeX distribution with multirow 2.x (the `=` width
form). T1 fonts/UTF-8 input alone do not guarantee arbitrary Unicode glyph
coverage. No font downloading, implicit font configuration or engine discovery
occurs. External QA must qualify its actual fonts and package versions.

`lang` string metadata overrides Document.language. Supported values are en,
en-US, en-GB, de, de-DE, fr, es, it, pt and nl; default is en. They map to fixed
babel options, including british and ngerman. Other languages and directions
other than ltr fail explicitly. Standalone title, author and date accept strings
or inlines and are escaped; absent date is empty for deterministic output.
An explicitly requested fragment language uses a scoped otherlanguage environment;
the enclosing preamble must load that babel language.

| AST feature | Serialization / strict boundary |
| --- | --- |
| Sections | Levels 1–5 map to article section through subparagraph; deeper levels require diagnosed lossy projection |
| Formatting | Grouped emphasis, bold, underline, strikeout, small caps, super/subscript and quotes |
| Lists / definitions | Starts and Roman/alpha/decimal styles; nested lists through depth four; grouped definition terms protect optional delimiters |
| Notes | Explicit numbered marks; text after the containing top-level block; nested note text is deferred outside the parent body |
| Tables | Longtable, repeated headers, last-page footer, paragraph cells, alignment and normalized widths, multicolumn and multirow; AST geometry validation rejects invalid occupancy |
| Images | Local paths through detokenize; spaces and underscores preserved; no resolution by the writer, no remote images or executable filename syntax |
| Links | Passive http/https/mailto/tel or relative URLs; context-specific URL escaping; forward internal references resolve to safe labels |
| Math | Typed source is preserved between fixed math delimiters after command allowlist, group and preprocessing checks; unknown commands and delimiter breakouts fail |
| Raw nodes | Strict rejection; explicit escape or diagnosed lossy text projection; retain always fails |
| Containers | Div groups, quotes, line blocks, rules and outer-context captioned figures |

Explicit IDs become hexadecimal Unicode labels with deterministic duplicate
suffixes; references select the first matching ID. Anonymous headings receive
sequential labels in a disjoint namespace. Code uses escaped texttt and literal
character commands, not verb/Verbatim: even an embedded environment terminator
cannot leave code. Block lines use explicit boxes and preserve indentation;
inline newlines become spaces and tabs use four spaces. Syntax highlighting is
not performed. Text escapes, code escapes, URLs, labels, optional arguments and
image paths use distinct serialization rules.

Unsupported classes/key-value attributes, table section/row attributes, citation
semantics, Example numbering, link/image titles, unresolved references, deep
headings and nested tables require explicit `lossy` projections with located
W_TABLE_LOSS diagnostics. Nested tables become cell text. Unsupported caption
blocks are diagnosed. Figures in notes/tables/figures and longtables in
notes/figures fail because those TeX environments require an outer document
context. Image description inlines serve the AST's alternative text; the fixed
graphicx profile renders the image and surrounding figure caption, and does not
produce tagged-PDF alternative text. Table header roles are structural row groups;
the fixed profile does not style them specially.

The math allowlist is a serialization safety boundary, not a full TeX parser or
a guarantee that arbitrary math source compiles. Unknown environments/macros,
alignment environments and executable raw commands are outside this profile.
Representative compiled conformance belongs to the separate external QA lane.
