# safe-bash-mcp

Turn remote MCP tools into safe-bash commands using the repository's MCP client.
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
| `createRemoteMcpCommands(servers, options)` | Generate safe-bash command definitions |
| `remoteMcpCommands(servers, options)` | Generate a plugin that registers those commands |
| `initRemoteMcpConfiguration(servers, options)` | Create versioned configuration and empty credential templates |
| `parseRemoteMcpConfiguration(value, options)` | Validate and copy configuration from JSON text or an object |
| `createRemoteMcpManagementCommand(servers, options)` | Create the safe-bash `mcp init` command |

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

Register a generated plugin on your shell:

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { remoteMcpCommands } from "safe-bash-mcp";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(await remoteMcpCommands([
  { name: "catalog", url: "https://catalog.example/mcp", tools: knownTools }
]));
try {
  const result = await shell.exec("catalog search_items --query '005930'");
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

Each server name becomes a command; exact tool names become subcommands.
`catalog --help` lists tools, and `catalog search_items --help` shows arguments.
Help uses supplied or discovered schemas without connecting again. For tool
names beginning with a dash, use `catalog -- '--tool' [arguments]`.
Use inline flags such as `--query=--help` for literal values beginning with
`--`. `--raw -` and `--raw=-` read a bounded UTF-8 JSON object from virtual
stdin, supporting shell input redirection and pipelines.

Stdout contains the complete MCP result as one JSON value, including all content
blocks, structured output and metadata. Tool failures and invalid structured
output return exit code 1; invalid arguments return 2 before connecting. Protocol
and transport errors produce JSON diagnostics on stderr with codes, data and
HTTP status when available. Output writes are awaited and cancellation closes
owned requests. Set `maxOutputBytes` to bound command output (default 16 MiB).
Output schemas and external schema registrations are captured during generation.
Registration checks all command conflicts before registering any of them.

Prepare credential configuration without reading secrets or connecting:

```ts
import { initRemoteMcpConfiguration, createRemoteMcpManagementCommand } from "safe-bash-mcp";

const servers = [{
  name: "catalog", url: "https://catalog.example/mcp",
  auth: {
    type: "oauth" as const, clientMode: "static" as const,
    env: { clientId: "GOOGLE_APP_ID", clientSecret: "GOOGLE_APP_SECRET" },
    scope: "read offline_access", redirectUri: "http://localhost:39119/callback"
  }
}];
const { configuration, envTemplate } = initRemoteMcpConfiguration(servers);
const management = createRemoteMcpManagementCommand(servers);
// Register management with your shell's CommandRegistry.
```

`mcp init` prints `{ configuration, envTemplate }` as JSON. Use
`mcp init --format config` or `mcp init --format env` for separate outputs that
can be redirected to files. `mcp init --help` explains the available formats.
OAuth requires an explicit `clientMode: "static"` or `"dynamic"`. Templates
include client ID/secret, scope, redirect URL, access/refresh tokens and expiry
in Unix epoch milliseconds. Every template value is empty; public scope and
redirect defaults remain in configuration. Bearer tokens and arbitrary headers
also use explicit `{ env: "VARIABLE_NAME" }` references. Literal credentials
and unknown configuration fields are rejected. Supplied schemas remain
authoritative, including an empty tool list.

Runtime binding of declarative credentials and reproducible artifact generation
are under development.
