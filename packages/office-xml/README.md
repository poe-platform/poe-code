# Caller-backed Office XML

Index XML documents without retaining their payloads, names, or tree in the JavaScript heap. The private workspace is bundled through supported public consumers.

| API | Use |
| --- | --- |
| `openRetainedXmlDocument` | Traverse indexed nodes, attributes, namespaces, text and exact markup streams. |
| `openRetainedXml` | Read bounded lexical ranges for a format-specific parser. |
| `stageRetainedXmlEdits` | Validate and stage ordered XML edits while preserving encoding and BOM. |

```ts
const document = await openRetainedXmlDocument(source, {
  workingStorage: { fs: filesystem, directory: "/scratch", cacheBytes: 65536 },
  signal
});
try {
  for await (const bytes of document.text(document.root)) await sink.write(bytes);
} finally {
  await document.close();
}
```

Working storage always belongs to the caller. Use an external backend when large files must spill outside Worker memory. Limits remain unlimited unless explicitly supplied; cancellation, malformed XML, namespace validation, owned output chunks, and cleanup retain the Office diagnostic contract. The lexical API requires its consumer to validate document semantics.

`stageRetainedXmlEdits(source, edits, context)` admits the original XML, passes a
borrowed lexical view to an async edit factory, and validates the edited document
before returning any output. Each edit supplies an original UTF-8 `range` and a
UTF-8 replacement stream. Ranges must be ordered, disjoint, and aligned to complete
characters; edits can insert, delete, or replace markup and text. The lexical view
expires when staging finishes. The returned result exposes `byteLength`, replayable
`bytes()`, `write(sink)`, and `close()`; close it after publication. Source and sink
ownership remain with the caller. Format-specific consumers must still enforce
presentation/workbook semantics and protected-source publication policies.

For format-specific mutation guards, `elements(root)` walks elements in document
order (including `root`) using stored links rather than an additional traversal
stack. `markup(element)` streams the original decoded UTF-8 element, preserving
quotes, entities and line endings. `shell(element)` removes only its direct
element children while retaining text, comments, CDATA and instructions. These
streams do not inject inherited namespace declarations; `declarations(element)`
exposes local `xmlns` attributes in source order, and `resolveNamespace` resolves
inherited bindings. All node handles and streams expire when the document closes.
