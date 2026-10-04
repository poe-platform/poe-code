# XML AST

Read XML as namespace-aware elements, attributes, text, CDATA, comments, and processing instructions in Node.js, browsers, and Workers. The parser has no filesystem, network, or Node.js dependencies.

```ts
import { parseXml, XmlLimitError } from "@poe-code/xml-ast";

const document = parseXml(
  '<doc xmlns="urn:example"><name>A &amp; B</name></doc>',
  { maxDepth: 16, maxNodes: 1000, maxTextLength: 100_000 }
);
console.log(document.namespace);        // urn:example
console.log(document.children[0].text); // A & B
```

| API | Use |
| --- | --- |
| `parseXml(source, limits?)` | Parse a string into an `XmlElement`. |
| `parseXmlStream(chunks, limits?, checkpoint?)` | Consume synchronous or asynchronous string chunks into an `XmlElement`. |
| `parseXmlSteps(source, limits?)` | Advance a parser through work checkpoints; the generator returns the completed element. |
| `XmlLimitError` | Inspect which configured resource limit was exceeded through its `limit` property. |
| `XmlElement`, `XmlContent`, `XmlAttribute`, `XmlName`, `XmlLimits`, `XmlStreamLimits` | Describe and consume the XML tree without Node.js types. |

Pass positive integer limits for depth, element and content counts, attributes, namespaces, and text. Omitted limits are unlimited. `retainContent` preserves ordered mixed content; `onElement` observes element names, parents, and depths during parsing. `expectedEncoding` checks an XML declaration against the caller's decoded input.

`parseXmlSteps` yields work counts so a host can account for parsing and yield between checkpoints. Syntax errors and resource limits remain errors by default; parsing never fetches external entities.
Pass `recover: message => report(message)` to repair truncated elements,
mismatched closing tags, and undeclared entities. Each repair calls the callback.
Resource limits and the prohibition on DTDs remain in force.

`parseXmlStream` consumes each chunk before requesting the next and calls the optional asynchronous checkpoint with at most 512 UTF-16 units. It preserves the buffered parser’s tree shape, namespaces and retained content. The source is closed on parsing or checkpoint failure. Decode byte sources incrementally before passing their strings. This avoids a full source string; the resulting tree and individual XML tokens still reside in memory. Recovery remains available through the buffered parser.

For validation or root-name detection, pass `retainTree: false` to `parseXmlStream`. It validates the complete document and enforces the same limits, but returns a root element with empty data fields. Only open element frames, namespace scopes and current parser tokens remain resident; completed descendants, text, attributes and document content are not retained. `onElement` still observes each element.

Use `streamElements: { matches, consume }` to process selected complete subtrees asynchronously. Matching non-root elements are detached from their parent; nested matches remain inside the selected ancestor. `consume(element, parent, before?)` runs in source order and is awaited before the next 512-unit parse window. The producer closes on consumer failure. This mode requires normal tree/content retention and retains each selected subtree until consumption; individual large subtrees and XML tokens still need their own storage strategy.

Set `streamElements.captureBefore: true` to detach preceding sibling content when each subtree is selected and receive it as `before`. This preserves text, CDATA, comments and sibling order even when multiple subtrees share one parse window. The remaining trailing content stays in the parent. Store both `before` and the subtree when you need to reconstruct the original mixed content.
