# Original HTML5 output profile

`writeDocument` and `convert` select `html5` or its write-only `html` alias.
The byte-only `createPandocCommand` uses the same engine. There is no native
fallback, filesystem access, resource fetching or execution in this writer.
No environment variables are exposed.

## SDK options and content policy

- `standalone: boolean` defaults to false. Fragments have no wrapper. Standalone
  uses the fixed original doctype/html/head/charset/viewport/title/body wrapper
  asserted literally in `html-writer.test.ts`. There are no remote styles,
  highlighting engines, arbitrary templates or generated author/date content.
- `metadata` is a map of validated AST MetaValue nodes. Explicit keys replace
  document metadata keys. `title`, `lang`, `dir` accept MetaString or MetaInlines;
  other keys are preserved in the document but do not alter this fixed wrapper.
  Metadata lang/dir override document language/direction; dir must be ltr/rtl/auto.
  Titles use text escaping; lang/dir use attribute escaping.
- `rawContent` accepts `reject` (default), `escape`, or `retain`. Reject fails on
  RawInline/RawBlock. Escape emits their literal source as text, including raw
  formats other than HTML. Retain permits only html/html5 raw nodes and emits
  their exact source, with `W_RAW_CONTENT` at each node's original AST path.
  RawBlock receives a deterministic terminating LF. Existing `lossy: true`
  without an explicit raw policy escapes raw nodes with `W_TABLE_LOSS` for
  compatibility with the earlier table projection. It never retains raw markup.

**Retained raw HTML may include scripts, event handlers, executable embeds,
forms, CSS, unsafe URLs, duplicate IDs or markup that changes surrounding DOM
structure. Conversion is not sanitization.** No sanitization guarantee is made
for this converter, and raw retention is an explicit trust decision. The writer
never loads or executes retained resources; rendering its output elsewhere can.
Even ordinary allowed links/images can cause navigation or resource loads when
the resulting HTML is opened in a browser.

Typed-node attributes permit id/classes plus title/lang/dir/role/data-*/aria-*.
Names are restricted to ASCII lowercase letters, digits and hyphens; duplicate
keys and all other attributes are rejected, including style, event handlers,
URL-bearing attributes and reserved ID/class overrides. Image/link title cannot
be supplied twice. This passive vocabulary also applies to table attributes.
Only writer-derived numeric alignment/width styles are emitted.

Text escapes ampersands and angle brackets; double-quoted attributes additionally
escape double quotes. CR becomes `&#13;` to survive HTML parser newline handling.
NUL cannot be represented faithfully by HTML and is rejected. URLs have a
separate validation/encoding step before attribute escaping: http/https/mailto/tel
schemes, relative references and fragments are permitted; other schemes, leading
or trailing whitespace, ASCII controls/DEL and backslashes are rejected. Spaces,
double quotes, angle brackets and backticks are percent-encoded. Existing percent
escapes, meaningful delimiters and Unicode are retained. No base resolution occurs.

## AST rendering

All supported block and inline constructors have an explicit rendering path,
including inside table cells, figures and deferred notes. Plain retains an
unwrapped inline run; Para wraps a paragraph. Tight lists retain Plain items and
loose lists retain Para items. Ordered-list starts and numbering styles map to
start/type; HTML uses its normal marker delimiter, independent of AST delimiter.
LineBlock uses a line-block div and br separators. Heading levels above six map
to h6. Generated IDs use locale-independent lowercase text and deterministic
suffixes; duplicate heading IDs are renamed, reserving explicit suffixed IDs.
Generated heading/note IDs also avoid retained typed-node identifiers. Arbitrary
duplicate explicit IDs on other nodes are not rewritten.

Code is literal escaped text with original classes and whitespace, with no
highlighting. Math is escaped typed source in math inline/display spans with
literal TeX delimiters; no renderer runs. Cite emits its already-rendered inline
content without citation processing. Quoted uses fixed Unicode quotation marks.
Image alt text projects formatting to plain text. Figure/table captions use the
long caption when present, otherwise the short caption; the short alternative is
not separately visible when both exist. Notes, including JSON and nested notes,
receive stable references/backlinks and a single end-of-document notes section.
No block/section note-placement options exist in this profile.

Tables reuse the AST geometry validator and bounded placement iterator. They
retain spans, headers, bodies, footer, captions, column widths, alignment and
scope attributes without flattening rich cell content or allocating a rectangular
grid. Empty fragments are empty bytes; standalone empty documents retain the
wrapper. Code-only input retains the code and its meaningful whitespace.

## Original coverage mapped to upstream Writers.HTML

The research inventory is `upstream-cases.json`, commit
`c9a9a5eed7185783b69043e019c067370dc09615`, path
`test/Tests/Writers/HTML.hs`. The following maps its named cases to original
TypeScript expectations; upstream source, fixtures and expected output bytes
were not imported or executed. This is bounded profile coverage, not upstream
byte equivalence or completion of the wider converter contract.

| Upstream case (line) | Original coverage or explicit profile limit |
| --- | --- |
| basic (59) | Nested formatting/quotes/citations/breaks; exact bytes and complete DOM shape |
| haskell (60) | Original corpus obligations: haskell class on escaped code; highlighting excluded |
| nolanguage (62) | Original corpus obligations: unclassified literal code |
| alt with formatting (66) | URL/title/alt escaping test projects Emph alt to text |
| definition list with empty dt (71) | Original corpus obligations: empty dt retained |
| heading with disallowed attributes (74) | Heading event attribute rejection; safe multilingual heading attributes retained |
| quote with cite attribute, without q-tags (80) | Fixed Unicode quote rendering; cite attribute is outside passive attribute vocabulary |
| quote with cite attribute, with q-tags (83) | q-tags extension is unsupported; extension registry rejects unlisted switches |
| code should be rendered correctly (88) | Code-only and inline-code escaping/CR expectations |
| sample should be rendered correctly (93) | Code classes retained literally; class-driven samp tag substitution excluded |
| variable should be rendered correctly (98) | Code classes retained literally; class-driven var tag substitution excluded |
| samp should wrap highlighted code (103) | Highlighting and samp substitution excluded |
| var should wrap highlighted code (109) | Highlighting and var substitution excluded |
| notes at end of document (116) | JSON/nested note references, backlinks and endnotes; full DOM/bytes |
| notes at end of block (137) | Unsupported placement; this profile always uses document endnotes |
| notes at end of section (161) | Unsupported placement; this profile always uses document endnotes |
| notes at end of section with section divs (182) | Unsupported placement/section generation; explicit Div AST renders normally |

Additional independent obligations cover dangerous schemes and attributes before
publication, raw retention warnings, Unicode, duplicate/suffixed IDs, carriage
returns/NUL, figures, tightness/starts, standalone metadata, nested rich tables,
and retained row/column spans. Tests compare parse5 DOM structures including all
attributes and whitespace; separate literal byte assertions do not normalize
away security attributes or meaningful whitespace. All tests are in memory;
there are no unit filesystem mutations, external executables or LLM calls.
