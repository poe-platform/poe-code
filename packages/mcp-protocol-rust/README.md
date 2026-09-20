# mcp-protocol-rust

Parse and serialize JSON for MCP messages with a Rust library that has no external
crate dependencies. Preserve UTF-16 strings, including lone surrogates, and bound
input bytes, nesting, and value count before accepting untrusted messages.

| Capability      | Behavior                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------- |
| JSON values     | Null, booleans, numbers, UTF-16 strings, arrays, and ordered objects                        |
| Duplicate keys  | The last value wins, preserving the first insertion position                                |
| Unicode         | Strict UTF-8 input and lossless escaped UTF-16 code units                                   |
| Resource limits | Configurable bytes, container depth, and parsed value count                                 |
| Serialization   | Iterative traversal, escaped controls, and ECMAScript shortest number spelling              |
| Wire formats    | Canonical base64 and strict absolute resource URI checks                                    |

JSON-RPC helpers distinguish requests from notifications, preserve legacy IDs,
enforce modern safe request IDs, and format success/error envelopes.

`isBase64` validates alphabet, padding, and unused bits without decoding a buffer.
`isValidUri` rejects controls, whitespace, raw non-ASCII characters, malformed
percent escapes, relative identifiers, and misplaced brackets. It validates IPv6,
ports, and special-scheme IPv4 hosts. Full internationalized-host conformance is
still under review; do not use this checkpoint as a general URL security policy.

The native Node binding parses directly into JavaScript values, preserving own
`__proto__` properties and UTF-16 keys without a JavaScript JSON bridge. It ships
the compiled addon with the package and has no npm runtime dependencies.

```typescript
import { parseJson, parseJsonUtf8, canonicalizeJson, parseMessage } from "mcp-protocol-rust";

const value = parseJson('{"tools":[]}', { maxBytes: 1024 });
const decoded = parseJsonUtf8(Buffer.from('{"id":1}'));
const encoded = canonicalizeJson('{"id":1,"result":{}}');
const request = parseMessage('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
```

```rust
use mcp_protocol_rust::json::{parse, stringify, Limits};

let message = parse(
    br#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#,
    Limits::default(),
).expect("valid MCP JSON");
let encoded = stringify(&message);
```

Defaults allow 16 MiB, 128 nested containers, and 262,144 values. The maximum
supported depth setting is 512; larger settings return `InvalidLimits` rather
than removing stack protection. Array and object containers count as values;
object keys do not. Limits of zero reject the corresponding resource use.

Strings are stored as UTF-16 code units, so `"\ud800"` is preserved rather than
replaced. Serialization retains property order and produces valid JSON. Numbers
use ECMAScript's shortest spelling, decimal midpoint tie handling and fixed/exponent
boundaries, including subnormal values and negative zero. Use `numbers::format`
in Rust for JavaScript-compatible number text, including `NaN` and infinities.
As with `JSON.parse`, numeric overflow can produce infinity, which serializes
as `null`, matching `JSON.stringify`.

`parse_utf16` also accepts JavaScript source strings containing raw unpaired
surrogates. Its byte limit counts UTF-8 widths, with three bytes per unpaired unit;
escaping those units internally does not consume extra input budget. Parse error
offsets refer to the normalized UTF-8 source.

`parseMessage` and `parseMessageUtf8` return the existing server parser's
`ParseResult | ParseError` shape. They keep legacy null and fractional request IDs
for compatibility, even where the official SDK schemas reject them. Modern
requests with protocol-version metadata require safe integer or string IDs.

This additive package is under development. MCP dispatch APIs and the native
platform artifacts are being added; existing MCP packages continue to operate
independently.
