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
Resource limits and the prohibition on DTDs remain in force. With `retainTree: false`,
`parseXmlSteps` discards completed nodes and can emit synchronous `events`, including
repaired closing events. Drain events between generator checkpoints to await
external storage; the source string and open parser frames remain resident.

`parseXmlStream` consumes each chunk before requesting the next and calls the optional asynchronous checkpoint with at most 512 UTF-16 units. It preserves the buffered parser’s tree shape, namespaces and retained content. The source is closed on parsing or checkpoint failure. Decode byte sources incrementally before passing their strings. This avoids a full source string; the resulting tree and individual XML tokens still reside in memory. Recovery is available through `parseXmlSteps` or the externally backed source API.

For validation or root-name detection, pass `retainTree: false` to `parseXmlStream`. It validates the complete document and enforces the same limits, but returns a root element with empty data fields. Only open element frames, namespace scopes and current parser tokens remain resident; completed descendants, text, attributes and document content are not retained. `onElement` still observes each element.

Use `streamElements: { matches, consume }` to process selected complete subtrees asynchronously. Matching non-root elements are detached from their parent; nested matches remain inside the selected ancestor. `consume(element, parent, before?)` runs in source order and is awaited before the next 512-unit parse window. The producer closes on consumer failure. This mode requires normal tree/content retention and retains each selected subtree until consumption; individual large subtrees and XML tokens still need their own storage strategy.

Set `streamElements.captureBefore: true` to detach preceding sibling content when each subtree is selected and receive it as `before`. This preserves text, CDATA, comments and sibling order even when multiple subtrees share one parse window. The remaining trailing content stays in the parent. Store both `before` and the subtree when you need to reconstruct the original mixed content.

`parseXmlStream` also accepts `events` with `retainTree: false` to consume ordered
open, content and close events without constructing a document tree. Each parser
window awaits the consumer before advancing. Event elements contain names,
attributes and namespace metadata; individual XML tokens and open ancestry still
remain resident. This mode lets a caller own document storage independently of
the codec. Consumer failures propagate unchanged and close the input iterator.

`normalizeXmlChunks(chunks)` validates XML characters and normalizes BOM/line endings
in windows of at most 513 UTF-16 units, preserving surrogate pairs across chunks.
Store those windows in caller-owned backing and drive `parseXmlSourceSteps(length,
limits)`: numbers are work checkpoints; read requests specify UTF-16 `offset` and
`length` (at most 4096 units). Fill each request's `value` before advancing the
iterator. The source must already be validated and normalized. This supports the
same repairs and events without a complete source string; tokens and open ancestry
still remain resident. Close the iterator and backing on errors or cancellation.

For tree-free external parsing, set `storeFrames: true` alongside `retainTree: false`.
The iterator also yields `frameOperation` requests: `push` saves the supplied frame,
`pop` removes the latest frame, and `peek` needs its `frame` filled with the saved
metadata. Keep the host stack in bounded backing storage. The parser caches one
current frame; individual frame metadata and namespace scopes still have their own
size cost. The default string and stream APIs retain their existing ancestry behavior.

Also set `storeNamespaces: true` to resolve namespace scopes through host-backed
immutable storage. `namespaceOperation: "get"` supplies a scope and prefix; fill
`value` when present and set `complete: true`. For `"has"`, fill `found` using
membership without reading the URI value. For `"set"`, bind the supplied prefix
and value in a new scope, then fill `result` with its storage `reference` and the
number of distinct bindings (`size`). Frames carry this scope handle so shadowing
never changes ancestor scopes. In this mode event elements have an empty
`namespaces` map; their names and attributes still carry resolved namespace URIs.
The codec remains filesystem-independent. With `deferNamespaces: true`, resolved
URI metadata uses optional `namespaceReference` handles instead of complete strings.
Service `namespaceOperation: "reference"` by supplying the token `reference` when
present and setting `complete: true`. These handles belong to the host scope store;
retain or stream them before retiring that store. Built-in xml/xmlns names keep
their short namespace strings. Individual names still retain their token cost;
attribute values can use the fragment protocol below.

Set `storeAttributes: true` to move current-tag attribute values, source order,
and duplicate-name state behind `attributeOperation` requests (`has`, `append`,
`read`, and `expanded`). Service the request's `found` or `result` field as described
by `XmlAttributeRequest`, keeping records in caller-owned backing. When namespace
storage is also enabled, `expanded` supplies the local name and a `namespace` scope
and prefix. Check the pair of resolved URI and local name without joining them in
memory; an empty prefix means no attribute namespace, regardless of the default
element namespace. With this flag,
element `attributes` arrays are empty. Supply `onAttribute(attribute, element)` to
receive resolved attributes in source order, after the open event and before any
content or close event. The parser yields between attributes so a host can await
storage or a consumer. Namespace declarations may follow prefixed attributes;
resolution and duplicate-expanded-name validation still happen after the complete
start tag. With `fragmentAttributes: true`, ordinary values are validated through source spans; all attribute
values are stored as spans on attribute records and replayed in at most 512 UTF-16
units. Hosts must preserve the optional `source` field in append/read requests.
The third `onAttribute` argument is `true` for continuations of the same logical
attribute; await each fragment before requesting the next step. Empty attributes
still emit once. Entity diagnostics are emitted during validation, not replay.
This mode requires `storeAttributes: true`. Combining it with `storeNamespaces`
also validates namespace declarations in bounded fragments. A namespace `set`
request's `value` may then be a generator: strings are decoded value fragments,
numbers are work checkpoints, and objects are source-read requests. Service each
step before advancing, consume the complete value before filling `result`, and
close the producer if storage fails. Reserved URI checks preserve their diagnostic
order without joining fragments. Expanded-name events return complete URI strings
unless deferred namespace metadata is enabled; individual names still retain
their token cost.

Pass `undefined` as the source length to parse incrementally. Such read requests
have `streaming: true` and request at most 512 UTF-16 units. Return any nonempty
prefix available without pulling more input; set `complete: true` only when that
read reaches EOF (an empty EOF read is valid). Earlier offsets may be requested
again, so retain source spans in caller-backed storage. With `normalizeXmlChunks`,
pass `true` as the second argument to flush at input-chunk boundaries and preserve
early parser failures. The string parser and known-length protocol are unchanged.

With `retainTree: false`, `parseXmlSourceSteps` accepts `fragmentContent: true`
to emit text, CDATA, comment and processing-instruction bodies in at most 512 UTF-16 units without splitting surrogate
pairs. Content events with `continuation: true` belong to the preceding logical
node; store their bodies separately and retain one node identity. Yielded steps
let the host await each fragment before parsing more. Text validation and entity
decoding replay bounded source windows before publishing a logical node, retaining
its diagnostic and limit ordering. Numeric entity references are decoded without
materializing the token. Set `compactDeclaration: true` to retain normalized declaration fields without
copying long whitespace spans; validation always reads bounded windows. The
buffered API keeps the original declaration spelling.

Combine `fragmentContent` with `deferContentNames: true` to validate long
processing-instruction targets through source windows. Their events have an empty
`target` and a `targetSource` span; replay that span before retiring the source.
All body continuations carry the same target span. Short targets remain strings.
The stored document engine transfers these spans to its own token store and
streams targets during output. Element and attribute names still require their
own memory budget.
