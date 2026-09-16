# DOCX dialect codec

The low-level TypeScript codec reads and preserves Strict and Transitional
packages. The full document model, command adapter and generated runtime
schema/capabilities remain pending. The authoritative target is
[the DOCX specification](../specs/docx.md).

## Creation and namespace lookup

`createDocumentArchive(options: DocumentCreateOptions, context: ArchiveContext)`
returns `Promise<AdmittedDocumentArchive>`. Options are closed:

| Option | Values | Omitted or undefined |
| --- | --- | --- |
| `dialect` | `"strict"`, `"transitional"` | `"transitional"` |
| `kind` | `"docx"`, `"dotx"` | `"docx"` |

The options object and context are required. Null, unknown keys and unknown
values fail with `InvalidValueError` (`usage`). Context supplies the existing
explicit archive limits and cancellation signal; there is no environment or
configuration-file fallback. Creation has no host filesystem, network, clock,
identity or rendering dependencies.

The original minimal package contains one empty paragraph, portrait US Letter
dimensions, one-inch margins, one column and a Normal paragraph style. It has
no dated properties or application/author branding. ZIP member dates use the
fixed UTC instant 1980-01-01. Equal options produce equal package bytes through
the deterministic writer. This low-level seed does not accept a template or
structured content; those document-model operations remain pending.

`DocumentDialect` is the string union `"strict" | "transitional"`.
`documentDialects[dialect]` is a frozen vocabulary with keys `w`, `r`, `a`, `wp`,
`pic`, `c`, `dgm`, `m`, `ep`, `cus`, `vt`. Values are namespace URIs. `r` also
provides the prefix for dialect-specific relationship types. The table does
not declare all features in those namespaces editable or MCE-understood.

## Existing XML edits

`DocumentXmlEditor.setText(node, value)` retains its original text, CDATA,
comment and processing-instruction slot behavior. `setAttribute(element, name,
value)` accepts either the existing qualified-name string or an expanded name
`{ namespace: string, localName: string }`. Expanded-name lookup selects an
existing attribute and retains its actual serialized prefix, quote style and
surrounding bytes. It never creates a missing attribute or rebinds a namespace.

For example, after selecting an existing attribute-owning node:

```typescript
editor.setAttribute(paragraph, {
  namespace: documentDialects[admitted.dialect].w,
  localName: "rsidR"
}, "05060708");
```

Edits operate synchronously on editor-owned snapshots. Foreign nodes, absent
attributes, namespace declarations and affected opaque content reject. Failed
staging restores preceding edits. Clean serialization preserves the exact input,
including a standalone XML source whose dialect validation would prevent editing.
Admitted document-vocabulary edits validate active namespace consistency before
accepting the candidate. Raw XML editing does not interpret formatting values or
translate dialect-dependent element/attribute names or enum values.

## Detection and preservation boundary

Admission requires exactly one internal, fragment-free main document
relationship. Its exact relationship type, the main content type and the
WordprocessingML document root determine kind/dialect; filenames and serialized
prefixes do not. The main document has exactly one active body.

Checks cover opposite-dialect package relationship types, Word part content-type
and root agreement, active opposite-dialect element/attribute namespaces, and
DrawingML `graphicData/@uri`. Known Word relationship targets must have their
corresponding content type. Word roots covered are document/template, styles,
settings, numbering, font table, web settings, headers, footers, comments,
footnotes and endnotes. Other declared Office XML is inspected for dialect
consistency without claiming a complete schema validator.

MCE processing determines the active representation. Unselected branches,
ignored payloads and application extension storage remain opaque and byte-exact;
opposite namespaces inside them do not by themselves make the active document
mixed. Unused namespace declarations do not establish a dialect. The existing
understood-namespace profile is unchanged.

Active Strict legacy VML/Office namespaces and the legacy Word elements `pict`,
`hMerge`, `legacy`, `shapeDefaults`, `hdrShapeDefaults` reject. Transitional VML
remains opaque and is not normalized. Full Strict/Transitional schema validation,
all legacy compatibility switches and formatting-value semantics remain outside
this codec check. No whole-document dialect converter is provided.

`InvalidPackageError` (`invalid-package`) distinguishes main-edge cardinality,
target mode, dialect disagreement, active mixed XML, related-part type/root
disagreement, body cardinality and active Strict legacy markup through bounded
messages without document text. XML/MCE failures retain `invalid-xml` or
`unsupported-profile`; unsafe edits retain `unsupported-edit`, limits retain
`limit-exceeded`, and cancellation retains `cancelled`.

`DocumentArchiveEditor.snapshot()` and `writeArchive()` remain raw package tools.
After changing package metadata/relationships, callers must use
`readDocumentArchive()` on the candidate before document publication. They are
not substitutes for the later transactional operation engine.

## Command and model contract

The documentary `create` operation now declares `--dialect` and SDK `dialect`
consistently. With a template, omission retains its dialect and an explicit
conflict rejects; no template conversion is allowed. That command and its runtime
schema/capabilities are still planned, not implemented by this codec milestone.
The existing plural resources, `text replace`, common flags/selectors, JSON and
exit statuses are unchanged. The neutral model API, inherited members,
collections, enums and helpers retain their separate pending coverage obligations.
