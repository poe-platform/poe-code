# Caller-backed Office XML

Index XML documents without retaining their payloads, names, or tree in the JavaScript heap. The private workspace is bundled through supported public consumers.

| API | Use |
| --- | --- |
| `openRetainedXmlDocument` | Traverse indexed nodes, attributes, namespaces, and text streams. |
| `openRetainedXml` | Read bounded lexical ranges for a format-specific parser. |

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
