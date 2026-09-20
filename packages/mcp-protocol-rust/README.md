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
| Serialization   | Iterative traversal, escaped controls, and JavaScript-compatible non-finite-number handling |

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
replaced. Serialization retains property order and produces valid JSON; numeric
exponent formatting is not promised to be byte-identical to `JSON.stringify`.
As with `JSON.parse`, numeric overflow can produce infinity, which serializes
as `null`, matching `JSON.stringify`.

This additive package is under development. MCP message APIs and the native
TypeScript binding are being added; existing MCP packages continue to operate
independently.
