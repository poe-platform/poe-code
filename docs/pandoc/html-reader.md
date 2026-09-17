# HTML input profile

HTML input is implemented in `packages/pandoc`, selected through its declarative
format descriptor. The existing safe-bash inspection adapter derives availability
from that descriptor. Full safe-bash conversion-command wiring remains a separate
planned task, as for the other readers. There is no native runtime fallback and
`html-to-markdown` is unchanged. No new options or environment variables are exposed.

## Parser and recovery

The parser is pinned to MIT-licensed parse5 7.3.0 with its default tree adapter,
HTML document mode, scripting flag false and source locations disabled. It uses
its actual tokenizer and tree builder, not regular-expression tag extraction or
an XML parser. Fragments go through document parsing with implied html/head/body;
context-specific fragment parsing is not exposed.

Recovery includes quoted tag delimiters, HTML named character references (legacy
semicolon omission and attribute ambiguity), numeric replacement and Windows-1252
remapping, first-wins duplicate attributes, void elements, non-void slash syntax,
omitted paragraph/list/table end tags, active formatting reconstruction, implied
table sections and foster parenting. Raw-text/script end tags use the tokenizer's
name boundary rules; script strings do not prevent HTML closing tags. A leading
newline immediately inside pre is removed by tree construction, while pre/code
newlines remain literal. Invalid UTF-8 fails before parsing with E_ENCODING; the
shared input decoder normalizes BOM and CR/CRLF to LF.

This is a bounded parse5 structural profile, not a full browser compatibility or
complete Pandoc HTML-reader equivalence claim. There is no DOM execution,
document.write, custom-element reaction, CSS interpretation/layout, encoding
sniffing, URL navigation, resource loading or browser rendering. Foreign trees
are parsed structurally but their svg/math subtrees are excluded from the AST.
Parser repairs are deterministic but no recovery diagnostics are emitted by this
reader. Browser or Pandoc round-trip equivalence is not tested or advertised.

## AST projection

- h1–h6 become Header with explicit attributes; no automatic heading identifiers.
  p becomes Para; attributed paragraphs are wrapped in Div. Unwrapped inline runs
  become Plain. Outer ASCII whitespace is trimmed at block boundaries, internal
  ASCII whitespace collapses, and NBSP remains U+00A0 in Str. Formatting boundaries
  retain their own whitespace rather than applying CSS white-space rules.
- em/i, strong/b, u, del/s/strike, sup and sub become typed inline styles.
  Their attributes are retained through a Span wrapper. span and a without href
  become Span; an anchor name supplies an identifier when id is absent. br is
  LineBreak. code/tt/samp/var are literal Code; no CSS-derived style conversion.
- ul/ol become lists of li block sequences; ol start is a positive decimal
  integer, default 1 and bounded at 65534. List-marker CSS and reversed lists are
  not interpreted. blockquote and hr map to their corresponding constructors.
- pre becomes literal CodeBlock, including trailing newlines. Direct child code
  attributes merge with pre attributes: pre identifier/key values take precedence,
  class names combine without duplication. No language-class guessing is needed.
- div and semantic block containers (main, section, article, aside, header, footer,
  nav, address, form, fieldset) become Div with attributes; main does not suppress
  surrounding content. Event attributes whose normalized names start with `on`
  are removed from every retained attribute tuple. Other attribute values,
  including style and data-* names, are literal inert data, not evaluated.
- html lang (then xml:lang) becomes document language; valid html dir becomes
  document direction. Local lang/dir attributes are retained on Div/Span and
  headings. No inherited styling or bidirectional rendering is computed.
- a href and img src become Link/Image with literal targets, titles and alt text.
  No URL scheme is executed, canonicalized or resolved against either an input
  base or a base element. Unsafe URI schemes can occur as inert AST strings;
  downstream active renderers must apply their own target policy.
- figure becomes Figure; its first direct figcaption supplies the long Caption.
  table caption supplies the long table Caption. Explicit thead/tfoot sections
  are retained; implied/explicit tbody groups become TableBody. th remains a cell,
  without inferring a TableHead from the first tbody row.
- Table cells preserve row/column spans and attributes; alignments/widths remain
  default. colspan is a positive decimal capped at 1000; rowspan is a positive
  decimal capped at 65534. Missing, zero, negative, non-decimal or invalid spans
  become 1. In particular HTML rowspan=0's group-to-end behavior is intentionally
  not implemented. Column count accounts for occupied columns from earlier row
  spans within each section. Overlapping cells are not geometrically repaired,
  absent cells are not synthesized, and row spans are not clipped to group length.
  Column/colgroup presentation metadata and CSS table layout are not projected.

## Dropped and unsupported content

Comments and doctypes are omitted. head (including title/base), script, style,
iframe, object, embed, template, noscript, svg and math are dropped with their
subtrees. base never affects targets. link, meta, input, source and track are
omitted. Forms become inert Div rather than executable form elements. Other
unsupported elements unwrap to their child content; known unsupported block tags
such as dl/dt/dd keep block-flow boundaries but have no special AST constructor.
Textarea and other tokenizer raw/RCDATA content become literal text through this
unwrapping policy. No RawInline or RawBlock is produced, even for malformed or
unsupported syntax. External entity declarations have no expansion mechanism.

## Bounds and portability

The shared engine acquires bounded UTF-8 input and checks cancellation. Before
feeding the tokenizer, the reader reserves source text/retention, charges work per
source code unit and cooperates every 256 code units. Every ampersand conservatively
reserves one entity and eight entity bytes, even inside ignored content or when
not a reference. This can reject literal ampersand-heavy inputs earlier than a
reference-only counter would.

Tree allocation reserves nodes and retained bytes before calls into the adapter,
including ignored subtrees and text-insertion events that may coalesce into one
text node. Retained attributes and table cells are charged. Parent attachments
and every open-stack push check depth; tag processing charges work proportional
to current stack size. Feed chunks are at most 256 UTF-16 code units, with a
cooperative cancellation point after each. Source retention covers tokenizer
buffers and discarded token spellings; tree/AST allocations are also charged.
The engine independently normalizes and bounds the returned AST. Consequently
source, tree and AST accounting is deliberately conservative, not a final-AST
size allowance. All existing limits can only be lowered.

Tokenizer/tree-builder work within one feed is synchronous. These limits and
checkpoints do not promise a fixed wall-clock latency per chunk or full accounting
of every private parse5 operation. The pinned internal Parser/tokenizer API is
used for bounded feeding; dependency upgrades require reviewing that API and
rerunning the recovery/bounds tests. The runtime imports no host fs, Buffer,
network, subprocess, browser DOM or LLM API. Its explicit ResourceCapability is
never called, even when supplied and even for entity-derived image/link targets.
