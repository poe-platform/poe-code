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
| `parseXmlSteps(source, limits?)` | Advance a parser through work checkpoints; the generator returns the completed element. |
| `XmlLimitError` | Inspect which configured resource limit was exceeded through its `limit` property. |
| `XmlElement`, `XmlContent`, `XmlAttribute`, `XmlName`, `XmlLimits` | Describe and consume the XML tree without Node.js types. |

Pass positive integer limits for depth, element and content counts, attributes, namespaces, and text. Omitted limits are unlimited. `retainContent` preserves ordered mixed content; `onElement` observes element names, parents, and depths during parsing. `expectedEncoding` checks an XML declaration against the caller's decoded input.

`parseXmlSteps` yields work counts so a host can account for parsing and yield between checkpoints. Syntax errors and resource limits remain errors by default; parsing never fetches external entities.
Pass `recover: message => report(message)` to repair truncated elements,
mismatched closing tags, and undeclared entities. Each repair calls the callback.
Resource limits and the prohibition on DTDs remain in force.
