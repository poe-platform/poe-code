# Table geometry and writer policy

The TypeScript converter validates every table, including tables nested in blocks,
notes and metadata, before invoking any writer or publishing output. Validated
normalization owns a clone and preserves constructors, cell text, source order,
captions (including null versus empty short captions), column specifications,
headers, all bodies, body heads, row-header counts and footers. It is idempotent.

Invalid tables fail; this implementation does not emulate upstream repair:

- Row/column spans must be positive safe integers. Zero, negative, fractional or
  oversized spans fail. Logical span area exceeding AST budgets fails with E_LIMIT.
- A span must fit the declared colspec width and its own section's remaining rows.
  It cannot cross the table head, a body's intermediate head, that body's rows,
  another body or the footer. The intermediate head and body rows are separate.
- Placement skips occupied columns before each cell. An occupied column inside
  that cell's colspan is an overlap and fails. Cells cannot straddle a body's
  row-header column boundary. Row-header counts must be within declared width.
- Each physical row must have complete occupancy at the declared width, including
  earlier rowspans. Uneven/short rows fail rather than being padded, and extra cells
  fail rather than being truncated. An empty row is valid only when completely
  covered by earlier spans (or when the declared width is zero).
- Colspecs and captions use the AST's typed validation. Explicit widths must be
  finite, positive and at most one; their sum is not required to equal one.
- Empty sections, no bodies, and zero-column tables are valid AST data. GFM cannot
  represent zero-column tables and rejects them even in lossy mode.

Sparse occupied-column indexes never allocate a row-by-column grid. Existing
100,000 logical-cell/reference ceilings admit span area before sparse map growth;
node ceilings admit rows and colspecs. Cooperative traversal yields during index
operations. Large coordinates are checked against section dimensions and budgets
before expansion. Writer text fragments and temporary text projections reserve
retained bytes and references before growth; output admission remains bounded.

HTML5 retains supported rowspans/colspans, long captions (or a sole short caption),
colspec widths/alignment, the table head, multiple tbody sections, intermediate
body heads, scope=row headers and the footer. Default cell alignment inherits its
colspec alignment. Plain/paragraph text, emphasis, strong/strikeout, code, links,
spans, code blocks, quotes, divs and ordinary lists have HTML projections. Other
complex blocks/inlines require lossy mode; their text is escaped. HTML event
attributes and malformed attribute names are unsupported. This is a declared
writer subset, not a complete HTML5 Pandoc writer.

GFM's strict subset is a nonzero-width rectangular table with exactly one head
row, one body, no intermediate body head or footer, no row-header columns, unit
spans, default per-cell alignment, default colspec widths and no attributes or
captions. Each cell is empty or contains one Plain/Para block of Str/Space text.
Column alignment is retained in the delimiter row. Rich inlines and complex cell
blocks require explicit lossy mode. The pipe_tables extension must be enabled.

SDK writeDocument/convert use `lossy: true`; the byte-only safe-bash conversion
adapter accepts `--lossy`. Absence of this option is strict. Every explicit table
flattening emits W_TABLE_LOSS with a deterministic message, format, operation and
AST node path. Invalid geometry always fails, regardless of lossy mode.

Lossy GFM prints the first physical head row then the delimiter, later head rows,
each body's head and rows, then footer rows. An absent head becomes a blank head.
Spanned cell text is printed exactly once at its anchor; covered slots are empty.
Multiple blocks are joined by spaces in source order; Markdown punctuation and
pipes are escaped. A caption becomes preceding text; widths, attributes and row
header/section semantics are discarded with diagnostics.

Plain is a documented text projection: caption first, then physical rows in
head/body-head/body/footer order, with tabs between original cells and a newline
after each physical row, including an empty row. Cell blocks are joined by spaces;
text formatting, attributes, alignment and widths have no textual representation.
Spans and complex cell blocks require explicit lossy mode and diagnostics. Covered
positions are not padded in Plain; anchor text appears once in source order.

Tests are original bounded cases inspired by AnnotatedTable and table edge-case
categories, with no upstream source/fixture copying. HTML is checked through an
independent parse5 DOM and GFM/Plain against literal expected syntax, rather than
testing a writer solely through its own reader.
