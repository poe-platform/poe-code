# safe-bash-mcp

Discover tool schemas for remote MCP servers using the repository's MCP client.
Supply known schemas to skip network discovery, or leave `tools` absent to fetch
every page automatically. Streamable HTTP and legacy HTTP/SSE endpoints are
handled by `tiny-mcp-client`. Discovery tries legacy SSE automatically only when
HTTP connection setup returns 404 or 405. Set `transport: "http"` or `"sse"`
to pin a transport. Local process servers are not supported.

```ts
import { resolveRemoteMcpSchemas } from "safe-bash-mcp";

const schemas = await resolveRemoteMcpSchemas([
  { name: "catalog", url: "https://catalog.example/mcp" },
  { name: "known", url: "https://known.example/mcp", tools: knownTools }
], { signal: controller.signal });
```

An explicitly empty `tools: []` is authoritative and never connects. Returned
schemas are independent copies and retain tool descriptions, annotations,
input/output schemas and other metadata. Discovered snapshots also include
server identity, capabilities and instructions.

| SDK function | Purpose |
| --- | --- |
| `fetchRemoteMcpSchema(server, options)` | Resolve one server's tool schemas |
| `resolveRemoteMcpSchemas(servers, options)` | Preflight a registry and resolve it in order |
| `compileToolArguments(tool, options)` | Compile validated argument parsing and deterministic flag metadata |

Use `headers` or the client's `oauth` options for credentials. URLs must use
HTTP or HTTPS without embedded credentials or fragments. Discovery supports
injected `fetch`, OAuth discovery caches, warning callbacks and cancellation.
Set `maxPages`, `maxTools`, `maxResponseBytes` and `requestTimeoutMs` to bound
discovery. Defaults are 100 pages, 10,000 tools, 16 MiB per HTTP response and
30 seconds per request. Cyclic cursors and duplicate tools fail explicitly;
connections close on success, failure and cancellation. Network, authentication,
rate-limit and server errors retain their original cause. If automatic SSE
fallback also fails, the error retains both failures.

Compile a discovered or supplied tool to parse CLI arguments with its complete
JSON Schema:

```ts
const parser = compileToolArguments(schemas[0].tools[0]);
console.log(parser.parameters); // Exact field names, flags, descriptions and schemas
const args = parser.parse(["--query", "005930"]);
```

Schema-declared strings retain their exact values, including numeric IDs and
timestamps. Numbers, booleans, null, nested objects, unions and typed arrays are
validated before a call. Use `--flag value`, `--flag=value`, `field=value`,
`field:value`, or `field:=<json>` for an explicitly typed JSON value. Flags are
stable across schema key order and remain distinct when names collide with each
other or with `raw`, `yes` and `help`.

Array values accept JSON arrays, repeated flags and JSON item sequences such as
`{"x":1,"y":2},{"x":3,"y":4}`. Bare string elements remain literal, including
commas; use a JSON array or repeat the flag for multiple string elements.
`--raw <json>` accepts a complete object and validates required fields after
parsing. Raw input cannot be mixed with named arguments. Defaults apply only
with `--yes` or the SDK's `{ yes: true }`; explicit falsey values are preserved.
Argument parsing defaults to a 1 MiB input byte limit (`maxInputBytes`). JSON
numbers that would become non-finite or silently round integer literals fail.
Internal and external references use the schema compiler; supply external
documents through its `registry` option.

Safe-bash command generation and the OAuth credential initialization command
are under development.
