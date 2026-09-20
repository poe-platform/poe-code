# JSON codec contract

The original TypeScript reader/writer implements the JSON encoding of
**pandoc-types 1.23.1.2**, observed with Pandoc **3.11**. The only accepted
`pandoc-api-version` is exactly `[1,23,1,2]`. Missing, shortened, older, newer and
otherwise different versions fail with `E_AST`. Unlike the upstream Haskell
reader's major/minor compatibility check, this codec does not infer compatibility.
The writer always emits this exact version.

Use the existing SDK `readDocument`, `writeDocument` or `convert` with
`from: "json"` / `to: "json"`. The declarative format module supplies both
capabilities automatically, including format listings through the existing thin
safe-bash inspection adapter. No native runtime, network or external executable
is used by conversion. Full shell conversion command wiring remains a separate
task; this task adds no command interface.

The wire envelope has exactly three fields: `pandoc-api-version`, `meta` and
`blocks`. Strict JSON syntax is required. The jsonc-parser tokenizer visits
object members before JSON.parse: duplicate decoded keys at **every nesting
level** fail, including escape-equivalent keys. Comments, trailing commas,
trailing values and malformed tokens fail. Metadata keys rejected by the existing
AST safety contract (`__proto__`, `constructor`, `prototype`) remain rejected.

Supported blocks: Plain, Para, LineBlock, CodeBlock, RawBlock, BlockQuote,
OrderedList, BulletList, DefinitionList, Header, HorizontalRule, Div, Figure and
modern six-field Table. Supported inlines: Str, Space, SoftBreak, LineBreak,
Emph, Underline, Strong, Strikeout, Superscript, Subscript, SmallCaps, Quoted,
Cite, Code, Math, RawInline, Link, Image, Note and Span. All six metadata
variants are supported: MetaMap, MetaList, MetaBool, MetaString, MetaInlines
and MetaBlocks, including empty maps/lists and nested values.

Enums use nullary `{ "t": "Constructor" }` objects on the wire, including quote,
math, list style/delimiter, alignment and citation mode. Internal AST enums are
strings; conversion occurs only at their defined positions. ColWidthDefault and
ColWidth remain tagged objects. Caption, Row, Cell, TableHead, TableBody and
TableFoot are untagged tuples, as observed natively. Raw format names and source
text are retained. Math is explicitly preserved as typed source, and citations
retain all six record fields and nested inline values.

Existing bounded AST validation checks constructor sets, exact union/tuple arity,
required fields, attributes, Unicode scalar validity, recursive nested values,
finite numbers and safe integers (`-9007199254740991` through
`9007199254740991`). Header levels and row/column spans must be positive.
Integer-valued JSON tokens must represent that exact integer, preventing binary64
rounding of a fractional token into an accepted integer. That exactness check
bounds the coefficient to 1024 characters and decimal scale to magnitude 1024;
longer integer-valued spellings fail. Fractional widths use finite binary64
values with the existing AST admission rule `0 < width <= 1`. This is narrower
than arbitrary values representable by Haskell Int/Double; no broader native
numeric compatibility is claimed.

Tables preserve attributes, captions, column specifications, head, intermediate
heads/bodies and foot. Spans cannot overlap or exceed a section's row count or
the column count. Row-head column counts must be within `0..columnCount`.
Partially filled rows are retained; normalization does not insert cells or
reshape tables. Absent (`null`) and empty (`[]`) short captions remain distinct.

Unknown constructors and malformed/unsupported versions fail with typed `E_AST`
before any writer callback or output publication. The writer validates the
internal AST first. Nonempty resources and present document-level language or
direction fields cannot be encoded in this envelope and fail with typed
`E_CAPABILITY`; they are never silently omitted or converted into metadata.

Normalization ignores only JSON object key order. It preserves every array's
order, node constructor, text (including whitespace and Unicode), attribute
pair order/duplicates, metadata variant and table shape. The writer emits
compact JSON followed by a newline; native byte formatting/key ordering parity
is not promised. Existing execution budgets/cancellation and atomic output
capabilities apply through the coordinator.
