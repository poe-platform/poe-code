# document-ast-rust

Describe a document once and export it through independent Rust Word and PDF
writers. The tree carries editable rich text, headings, lists, tables, quotes,
images, notes, links and explicit LTR/RTL scopes without depending on a browser,
Markdown parser or shell. Block direction is inherited; inline direction isolates
its content and can request a directional override. Stored text remains in logical
order.

```rust
use document_ast_rust::{Block, Document, Paragraph};
let mut document = Document::default();
document.blocks.push(Block::Paragraph(Paragraph::default()));
document_ast_rust::validate(&document)?;
# Ok::<(), String>(())
```

`docx-ast-rust` and `pdf-ast-rust` consume this same tree. A parser or plugin lowers
its custom syntax into these nodes. `Block::Vector` carries positioned, editable
paths, text, groups and authored raster images through `vector::Scene`. Scene
coordinates use points (72 per inch), measured from the top-left. Each node keeps
its local bounds, affine transform, optional source ID, clipping path and opacity.
Paths use move, line, cubic and close segments; text retains its original string,
font family, baseline, measured width and ascent. Shape and text content is never
implicitly flattened into a raster image.
Image display dimensions use CSS pixels (96 per inch); table widths are fractions
of the available width. Each writer converts those values into its format units.
`TableRow.header` identifies leading column-header rows that repeat across pages.
`TableCell.header` identifies individual section or row-heading cells without
repeating their rows.
IDs remain literal strings. Text and image links carry URI references. For a
fragment link, `resolve_fragment` first tries the exact ID, then percent-decodes
once and tries again. It does not reserialize URLs, normalize Unicode, convert
`+` to a space, or decode a second time. Malformed percent escapes stay literal;
invalid UTF-8 bytes become replacement characters. Missing targets retain each
writer's existing behavior: Word keeps the authored bookmark reference, while PDF
omits the link annotation.

Validation bounds nesting, content size and table spans before either writer runs.
The package uses Rust's standard library and the shared first-party cooperative
future helper from `mcp-protocol-rust`.

The separation between semantic authoring and format output follows
[Pandoc's document model](https://pandoc.org/using-the-pandoc-api.html).
