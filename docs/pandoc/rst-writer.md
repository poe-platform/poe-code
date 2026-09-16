# TypeScript RST output profile

The writer is implemented in packages/pandoc and bound declaratively to `rst`.
SDK conversion and the existing thin safe-bash byte adapter share that binding.
There is no Python product dependency, native fallback, executable directive,
resource acquisition or LLM call in the writer.

Output is a UTF-8 fragment with blank lines between blocks, a final newline for
nonempty output, and no line wrapping (`wrap: none`). `columns` is unavailable
at engine preflight. Standalone and metadata options are not advertised. Metadata
remains in the AST envelope but is not rendered by this fragment profile.

Headings use `= - ~ ^ " ' + : #` at levels 1–9. Width measures the emitted source
line using pinned Unicode 13.0.0 East_Asian_Width (W/F = 2, others = 1), subtracting
one for each nonzero canonical combining class. The checked-in range table was
computed from Python 3.9's Unicode database, not downloaded fixtures; runtime
lookup is TypeScript. Missing numeric levels are interpreted by RST as relative
adornment order; docutils may promote initial headings to document title/subtitle.
Empty headings fail. Levels above nine fail strictly, or project to nine with a
located diagnostic when `lossy` is explicit.

Literal blocks use `::` and three-space indentation. A single language class
selects `.. code:: language` (ASCII letters, digits, `_`, `-`, `+` only).
Code-leading punctuation is never interpreted as a directive or list. Lists use
content-column continuation indentation, including blank paragraphs and nested
blocks. Decimal period numbering preserves the start; other numbering profiles
require diagnosed projection. Adjacent list/quote/definition containers use empty
comments when needed to prevent merging. Transitions require surrounding content.
Definitions support one definition body; multiple bodies require diagnosed merging.

References use generated indirect targets and explicit displayed labels. Identifier
labels encode Unicode scalar values; duplicate identifiers receive unique names,
and internal links select the first occurrence. Forward references resolve;
missing targets fail. Generated names avoid names present in source text, including
implicit heading targets. Target strings reject whitespace, backslashes, backticks,
angle brackets and controls rather than risking multiline directive injection.
Notes use numbered references and deferred footnote bodies; nested notes are
assigned later numbers. Empty notes fail.

Images use only generated substitution directives `.. |name| image:: URI` with
optional `:alt:`. Width, height, alignment, arbitrary attributes, titles and figure
semantics are not represented. Unsupported attributes/titles require diagnosed
loss. No image file is fetched. Supported roles are exactly `:sup:` and `:sub:`;
inline code uses double-backtick literals, and emphasis/strong use their native
RST delimiters. Unsupported roles are never invented. Empty or whitespace-bounded
styles/literals, boundary backticks and double-backtick literal payloads fail.

Markup at adjacent word boundaries uses escaped whitespace separators that do not
add displayed spaces. Text punctuation is escaped conservatively. Native RST
inline markup does not support nested styles: strict mode fails at the nested
node; explicit lossy mode reports projection to display text. Nested links/code
also require diagnosed projection; nested images/notes fail. Spans always require
strict failure or diagnosed projection, including empty-attribute spans.

Tables use `list-table`, avoiding truncation or fixed-width splitting of long cells.
Rectangular cells retain blocks and continuations and support zero or one header
row. Spans, incomplete rows and empty tables fail even in lossy mode. Alignment,
widths, captions, attributes and body header semantics require explicit diagnosed
loss. The writer does not pretend that those features survived conversion.

All projections report the existing `W_TABLE_LOSS` diagnostic with format `rst`
and AST location; this shared code also covers nontable projections. Strict errors
are `E_CAPABILITY`. Raw source is escaped/literalized only with explicit lossy
conversion, never retained as executable RST.

## Core AST coverage

Original tests are in packages/pandoc/src/rst-writer.test.ts; independently written
expected strings and docutils structure assertions are in conformance/rst.mjs.

| Constructors | Representation or loss/error row | Tested case |
| --- | --- | --- |
| Str, Space, SoftBreak | Escaped text, space | boundaries; explicit soft-break case |
| LineBreak | Diagnosed space projection | unsupported families |
| Emph, Strong | Native delimiters; nested projection/error | boundaries; projected nesting |
| Underline, Strikeout, SmallCaps | Diagnosed display projection | unsupported families |
| Superscript, Subscript | sup/sub roles | roles-images |
| Quoted | Unicode curly quotes | code/roles/quotes case |
| Code | Inline literal; delimiter failure | roles-images; boundary backticks |
| Math, RawInline | Diagnosed escaped-source projection | unsupported families |
| Cite, Span | Diagnosed displayed-text projection | unsupported families |
| Link | Independent display and target; forward/duplicate/error | references; internal-duplicate; implicit target collision |
| Image | image substitution and alt | roles-images |
| Note | Deferred numbered body; empty error | references |
| Plain, Para | Inline body | ordered lists; all paragraph cases |
| LineBlock | Native line block, empty error | code/roles/lines; empty containers |
| CodeBlock | Literal/code directive | blocks; code-leading punctuation |
| RawBlock | Diagnosed literal projection | unsupported families |
| BlockQuote | Indented body; empty error | adjacent-containers; empty parents |
| BulletList, OrderedList | Content-column lists; empty error | blocks; ordered list; empty containers |
| DefinitionList | Indented definition body | blocks; empty containers |
| Header | Nine deterministic adornments; deeper loss/error | unicode-heading; extended-combining; deep-headings |
| HorizontalRule | Interior transition; boundary error | transition; container-boundary failure |
| Div, Figure | Diagnosed content/caption projection | unsupported families |
| Table | Rectangular list-table; explicit semantic losses/span error | table; long cell continuations |

This is a conservative supported profile, not a claim of complete Pandoc
Writers.RST compatibility. Cases are original and inspired by the requested
failure patterns; no upstream tests or expected output were copied.
