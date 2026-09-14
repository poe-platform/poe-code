# Bounded XML part access

The explicit XML-part utility milestone supports `xml get` and `xml set` through
the existing command engine. It does not establish document-model XML-view or
whole-public-API conformance. The remaining model APIs and later editing tasks
are pending.

Use a complete absolute OPC part name from inspection, including
`/[Content_Types].xml` or an explicit relationship part. Basenames, wildcard
expressions, traversal and multiple selectors reject; no implicit main-part
selection exists. A missing part fails unless replacement explicitly uses
allowEmpty/--allow-empty, which reports no change but still validates XML and
publication intent. Binary parts reject even if their payload looks like XML.

```text
docx xml get report.docx --part /word/document.xml --raw
docx xml get report.docx --part /word/document.xml --pretty --json
docx xml set report.docx --part /word/document.xml --file replacement.xml --output revised.docx
docx xml set report.docx --part /word/document.xml --file replacement.xml --dry-run --json
```

`getDocumentXml(bytes, context, options)` is always async. `raw: true` returns an
owned Uint8Array with exact original bytes, including BOM, encoding, whitespace,
comments and processing instructions. Default structured `XmlData` uses base64;
`pretty: true` uses UTF-8 display serialization. Raw conflicts with pretty, and
CLI raw conflicts with JSON. Plain CLI output without pretty emits original XML
bytes; it never appends a newline or banner.

Pretty serialization is for display, not byte comparison or a round-trip fidelity
promise. It may normalize declarations, entities and quotes. Existing text and
CDATA whitespace remains; indentation is added only to content without text nodes
and outside inherited xml:space="preserve". Mixed content retains its ordering.
The `bytes` and `sha256` fields always describe original part bytes, even when
`content` contains pretty text. XML and output limits apply before returning data.

`replaceDocumentXmlPart(inputBytes, xmlBytes, options, publicationContext)` owns
replacement bytes and publishes through the same staged capability checks as
other package primitives. `options.part` names one complete part; publication
requires output or inPlace unless dryRun. The context supplies limits, signal,
optional shared budget, writer encoding and explicit filesystem/stdout authority.
There are no new environment variables or implicit host filesystem access.

Replacement requires a complete well-formed XML document, supported UTF-8 or
BOM-marked UTF-16LE/BE with consistent encoding declarations, and no DTD/entities.
It preserves the selected root expanded name, all existing part content types,
the main document binding, kind and dialect. Namespace declarations and package
relationships are parsed and validated, never rewritten by regex. The partial
core-v1 validator checks its declared structural/reference invariants before
publication; it does not claim full XSD or extension-semantic validation.

Opaque XML content must retain its element-child position, ordered content,
attributes and in-scope namespace bindings. Introducing, removing, moving or
changing opaque content rejects. This conservative policy can reject harmless
namespace reorderings; it never assumes unknown semantics are safe to edit.
Protected or signed source packages reject before replacement can remove their
guards. The candidate receives the same protection and package validation.

Unselected uncompressed parts remain byte-identical. Whole-part replacement
explicitly affects all owners referencing that part. ZIP encoding may change
under the supplied writer policy; CLI uses input member order and stored entries.
A byte-identical replacement reports changed=false and no changes; publication
intent is still validated. Dry-run validates without acquiring a destination sink.
Mutation data includes before/after part locations, output byte count and SHA-256
when published, and dryRun. Existing staged publication rules cover force,
aliases, stale input identity, permissions and cleanup. No external relationship
is followed and no document-supplied code runs.

Evidence and exact check results are recorded in
[the owned task plan](../plans/docx-explicit-xml-parts.md).
