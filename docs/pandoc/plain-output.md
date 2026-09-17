# Plain text output

`plain` is a write-only, explicitly lossy UTF-8 text format. Use SDK
`writeDocument(document, {to: "plain", wrap: "none"}, context)` or the opt-in
byte-stdin `createPandocCommand()` adapter with `-f json -t plain --wrap=none`.
The adapter delegates conversion and limits to the SDK. Neither uses native
Pandoc, external executables, ambient files, terminal styling or terminal width.

## Text policy

- Empty paragraphs and containers emit nothing. Nonempty output gets one final
  newline in addition to any newline already in its content.
- Ordinary blocks and paragraphs use two newlines between them. A nonempty
  `Plain` block uses one newline before its successor. Empty blocks do not change
  the separator. Headings emit their text; horizontal rules emit `---`.
- Explicit spaces remain spaces. Soft and hard line breaks remain newlines.
  Line blocks use one newline between lines, including empty lines.
- Formatting wrappers and spans retain all their child text. Quoted nodes use
  literal single or double quotation marks. Adjacent text fragments are preserved
  exactly, including whitespace; markup removal never strips child words.
- Inline code is verbatim. Code blocks prefix each nonempty line with four spaces,
  preserving existing indentation, tabs, trailing spaces and content newlines.
  Empty lines receive no added spaces. No line is wrapped or trimmed.
- Bullet items use `-`; ordered items use decimal numbers beginning at the AST
  start value, followed by `.`. Items use one newline between them. Continuation
  lines hang beneath the item text, so nested lists retain their nesting. Empty
  items emit their marker. Paragraphs inside items retain their blank lines.
- Definitions emit the term, then definitions on subsequent lines indented by two
  spaces. Entries use blank lines. Block quotes indent nonempty lines two spaces.
- Notes appear at their original position as `[note: CONTENT]`, preserving their
  block separators and nested content. They are not silently discarded.
- Links emit their label plus ` (DESTINATION)` when the label differs from a
  nonempty destination. An identical label/destination is emitted once. Empty
  labels fall back to the destination. A title is appended as ` "TITLE"`.
- Images emit alt text plus an optional quoted title. Empty alt text emits a space,
  preserving a boundary between surrounding words. Image destinations and binary
  resources are intrinsically omitted by this text format.
- Tables emit tabs between physical cells and newlines between physical rows.
  All head, body-head, body and foot rows appear in source order. Cell block
  separators, lists, code and notes are preserved; this is a text projection,
  not a rectangular or machine-readable TSV encoding. Captions precede rows with
  one newline. Short and long captions both appear, separated by a blank line.
  Spans require `lossy: true` / `--lossy`, produce `W_TABLE_LOSS`, and emit anchor
  text exactly once in physical source order.
- Figures emit their content followed by captions, separated by a blank line.
- Raw inline/block nodes fail with `E_CAPABILITY` by default or with
  `rawContent: "reject"`. Explicit `"retain"` or `"escape"` (CLI `--raw-content`)
  emits source verbatim with `W_RAW_CONTENT`: plain has no escaping syntax and
  cannot interpret raw meaning. Empty retained raw source emits a space. No tags
  are deleted. Math and citations fail with `E_CAPABILITY`, including with `lossy`.

Formatting, attributes, heading levels, list numbering style/delimiter, table
alignment, widths and section styling, language/direction presentation, metadata
and resource embedding are intrinsically absent. Unicode scalar sequences remain
unchanged: no normalization, ANSI styling, bidirectional reordering or display
width calculation is performed. Metadata is document configuration, not body text;
standalone output and metadata overrides are unsupported for this writer.

Only omitted wrap or `wrap: "none"` is supported. `auto`, `preserve`, `columns`,
standalone and other undeclared options fail with `E_OPTION`. There is no ambient
terminal-width default. Limits and cancellation are the shared SDK policies,
including UTF-8 output bytes, retained bytes, AST size/depth, work and diagnostics;
failures occur before the byte-only adapter publishes content.

## Verification evidence

Original cases inspired by the coverage topics of Tests.Writers.Plain use original
ASTs and literal expected strings; no downloaded fixtures or external oracle are
used. The initial run reproduced five failures against the previous writer.
Tests cover empty nodes, nested/empty lists, meaningful code whitespace, CJK/RTL,
emoji, combining marks, long URLs, differing link labels, empty alt text, notes,
multiple cell paragraphs, captions, raw/math/citation policies and CLI/SDK parity.
Unit tests use only in-memory ASTs and byte sinks; no filesystem mutation is needed.

Verified on September 16, 2026:

- `npm test --workspace=@poe-code/pandoc`: 577 tests passed across 18 files.
- `npm run build:workspaces -- --workspace=@poe-code/pandoc`: selected workspace
  build closure passed.
- `npm run lint --workspace=@poe-code/pandoc`: package ESLint and source/test
  typechecking passed.
- Ad hoc built-byte-adapter conversion matched SDK output; captured bytes are in
  `plain-command.txt` and the inspected terminal rendering in `plain-command.png`.
  The poe-code screenshot wrapper targets the agent CLI, which has no Pandoc
  subcommand; this capture exercises the actual converter adapter using the same
  terminal PNG renderer. Its font displays missing-glyph boxes for several CJK,
  RTL and emoji characters; original expected strings and byte comparisons verify
  Unicode preservation independently of that renderer limitation.

No full-repository checks, native Pandoc parity claim, push or release are included.
