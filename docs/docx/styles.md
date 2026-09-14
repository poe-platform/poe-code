# Styles and headings

The utility supports `styles list`, `styles get --name`, `styles add --name --type`
and `styles set --name`. Names are exact; paragraph, character and table
styles are editable. Inspecting never materializes missing definitions.

`--base`, `--next`, `--linked-style` and `--default-for-type` edit relationships.
Null clears a nullable relationship; omitted values remain unchanged. Linked
styles pair paragraph and character definitions. Setting a type default replaces
the old default designation. Invalid references/types and inheritance or long
link cycles fail validation; reciprocal pairs and self-next are valid.

`styles defaults get/set` reads or edits document defaults. Supported formatting
flags are `--bold`, `--italic`, `--font`, `--size`, `--color`, `--outline-level`,
`--keep-with-next`, `--space-before` and `--space-after`; style definitions also
support `--priority`, `--hidden`, `--locked` and `--quick-style`. Null formatting
removes a direct setting. Unknown style, latent and table metadata is retained
within the existing preservation/editability rules.

The SDK exposes `inspectDocumentStyles(bytes, options, context)` and
`editDocumentStyles(bytes, { operation, ...options }, context)`. Inspection returns
exact definition IDs/names, relationships, direct and resolved supported
properties, defaults and diagnostics. Size and spacing values read as points;
numbering references remain IDs. Style toggle inheritance is distinct from
absolute direct run overrides. This subset does not resolve rendering, table
conditional formatting, theme font discovery or the whole Word layout cascade.

Use `paragraphs add --level 0` for Title and levels 1–9 for headings; structured
creation uses the same level values and allocation rules. An explicit style
cannot be combined with a level. Matching user names never authorize overwriting
styles, and generated collision variants are reused on subsequent calls.

Mutations use the common output/in-place/dry-run rules and validated publication.
All I/O capabilities are supplied. Later style deletion, latent mutation, live
model objects and typed model batches remain pending.

Original regressions and the implementation/check record are in the
[bounded task plan](../plans/docx-styles.md).
