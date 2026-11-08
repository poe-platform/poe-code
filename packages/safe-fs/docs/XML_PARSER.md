# Shared XML parser

`parseXml` and `parseXmlSteps` are exported from `@poe-platform/safe-fs/core`.
Both accept a decoded string and optional `XmlLimits`. They return one root
`XmlElement` and reject DTDs, DOCTYPE, unknown entities, invalid characters,
malformed namespaces, and malformed XML with `SyntaxError`.

`parseXml(input, limits)` drains the parser synchronously. It does not impose
an input-byte or execution-time limit: the caller must admit input before calling
it. `parseXmlSteps(input, limits)` is a generator that yields numeric work charges
and returns the tree. A cooperative host must count these charges, enforce its
work budget, yield to the event loop, check cancellation, and close an unfinished
generator. Merely iterating it synchronously does not provide cancellation.

## Options

| Option | Default | Meaning |
| --- | ---: | --- |
| `maxDepth` | 64 | Maximum element nesting |
| `maxNodes` | 100,000 | Maximum element count |
| `maxAttributes` | 10,000 | Total attribute count |
| `maxAttributesPerElement` | 128 | Attribute count on one element |
| `maxNamespaces` | 256 | Namespace bindings in one scope |
| `maxContentNodes` | 100,000 | Retained elements, attributes, and content nodes |
| `maxTextLength` | `Number.MAX_SAFE_INTEGER` | Cumulative decoded scalar UTF-16 code units |
| `retainContent` | true | Retain ordered mixed content and metadata |
| `expectedEncoding` | omitted | Require an explicit declaration to match the caller's decoding |
| `onElement` | omitted | Admission callback receiving element name, parent name, and depth |

Numeric limits must be positive safe integers. `XmlLimitError` extends
`SyntaxError` and exposes the exceeded `limit`. `expectedEncoding` accepts
`UTF-8`, `UTF-16`, `UTF-16LE`, or `UTF-16BE`. An explicit declaration is compared
case-insensitively; an absent declaration is allowed. This option checks the
label, not the original bytes: callers remain responsible for decoding them.
No environment variables configure this parser.

An element carries its qualified `name`, namespace URI, `localName`, element
`children`, and direct `text`. Rich mode also retains ordered `content` (elements,
text, CDATA, comments, and processing instructions), resolved `attributes`,
namespace bindings, and the root XML declaration when present. Namespace scopes
may be shared; treat the exposed readonly metadata as immutable.

With `retainContent: false`, `content`, `attributes`, and `namespaces` are empty
and the declaration is omitted. `children` and direct `text` remain available.
The default `maxContentNodes` then follows `maxNodes`; an explicit value still
applies. This lightweight mode supports the existing WebDAV parser without
retaining query-only metadata. `onElement` runs after name, namespace, and
structural admission and before descendants, allowing protocol-specific resource
checks without putting protocol rules in the generic parser.

Rich roots additionally expose ordered `prolog` and `epilog` arrays for whitespace,
comments and processing instructions outside the document element. The declaration
remains separate. These nodes consume `maxContentNodes`; lightweight mode omits
them. Character references outside the root are invalid even when they decode to
whitespace. Declaration field names and standalone values are case-sensitive.
A generic `UTF-16` declaration also matches `expectedEncoding: "UTF-16LE"` or
`"UTF-16BE"`; an opposite explicit byte order still rejects.

`maxTextLength` optionally bounds cumulative decoded text, CDATA, comment and
processing-instruction data, and attribute values in UTF-16 code units. Its
compatibility default is `Number.MAX_SAFE_INTEGER`; document callers must supply
a finite application ceiling. This counts values before retention, including
metadata in lightweight mode. Source bytes, token/name lengths and cumulative
work still need caller admission and generator charge accounting.

The isolated `@poe-code/safe-fs/xml` export exposes this parser and its types
without importing filesystem implementations or host/native adapters.
