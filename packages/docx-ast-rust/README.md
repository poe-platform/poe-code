# docx-ast-rust

Create editable Word documents with explicit styles, heading hierarchy, tables,
numbering, links and embedded images from `document-ast-rust` content. No Word
installation, shell, browser or network service is required.

```rust
let document = document_ast_rust::Document::default();
let bytes = docx_ast_rust::write_docx(&document)?;
let mut package = docx_ast_rust::to_package(&document)?;
// Inspect or modify an OOXML part before packaging it.
let body = package.parts.iter_mut().find(|part| part.name == "word/document.xml");
let bytes = package.write()?;
# Ok::<(), String>(())
```

`to_package_async` and `write_docx_async` provide cooperative variants for hosts
that need cancellation between bounded work batches. The synchronous APIs drive
the same implementations. Body defaults follow modern Microsoft Word: regular
12-point Aptos from the document's body theme, automatic text color, 1.15 line
spacing and 8-point paragraph spacing. Headings use the Aptos Display heading
theme; code uses Courier New. The embedded OOXML theme keeps these font choices
editable in Word. Font files are resolved by the document viewer.

Vector blocks use the shared scene's canonical SVG serializer and embed the
result with Word's `asvg:svgBlip` extension. The package contains the original
vector paths, semantic text, transforms, clips, and any authored raster images;
it does not render the diagram to a bitmap. This follows Pandoc's SVG-only
packaging when no bitmap fallback is available. It requires an SVG-capable Word
viewer; older viewers have no bitmap fallback. Diagram objects are retained in
SVG, rather than separate native Word shapes. Normal document text and tables
remain editable. Scene dimensions are points and diagrams fit the page or table
cell without upscaling.

A list item's leading `Paragraph.list_checked` replaces its marker with an empty
or checked box using native Word numbering. The marker's hanging indent aligns
wrapped text and continuation paragraphs; nested, mixed and ordered task lists
retain their structure. These are document list markers, not form controls.

Direction scopes preserve nested paragraph, list and table resets,
inline isolation and directional overrides without reversing stored text. Generated
direction markup passes the Word schemas; Unicode-isolate rendering has not been
verified in a Word application.

Word forbids footnote references inside footnotes. A nested `Inline::Note` returns
an unsupported error instead of producing a non-conformant package; independent
notes remain supported. Table column headers repeat; section and row headings
retain their emphasis and shading without becoming repeating rows. Merged heading
cells retain that styling through their continuation cells.

`to_package` exposes the actual Office package parts, rather than hiding them
inside an opaque download. `office-package-rust` validates names and sizes and
writes the ZIP package. Both packages use only first-party Rust dependencies.

Package/style separation was checked against the designs of
[Pandoc's DOCX writer](https://github.com/jgm/pandoc/tree/main/src/Text/Pandoc/Writers/Docx)
and [docx-rs](https://github.com/bokuweb/docx-rs/tree/master/docx-core/src/documents).
These are design and output references; their implementations are not bundled.

Typography references: Microsoft's [Aptos font documentation](https://learn.microsoft.com/en-us/typography/font-list/aptos)
and [Word's default line spacing](https://support.microsoft.com/en-us/office/change-the-default-line-spacing-in-word-411437a0-0646-490d-b426-a9249a78b315).
