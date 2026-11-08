# tiny-stdio-mcp-server

Minimal [Model Context Protocol](https://modelcontextprotocol.io) server for Node.js. Type-safe tool definitions, rich content helpers for images/audio/files.

## Install

```sh
npm install tiny-stdio-mcp-server
```

## Quick start

```ts
import { createServer, defineSchema } from "tiny-stdio-mcp-server";

const schema = defineSchema({
  text: { type: "string", description: "Text to reverse" }
});

createServer({ name: "my-server", version: "1.0.0" })
  .tool("reverse", "Reverse a string", schema, ({ text }) => {
    return text.split("").reverse().join("");
  })
  .listen();
```

Run it:

```sh
node my-server.js
```

Any MCP client (Claude Code, Codex, etc.) can connect to it over stdio.

## API

### `createServer(options)`

Creates a new MCP server.

```ts
const server = createServer({ name: "my-server", version: "1.0.0" });
```

### `.tool(name, description, schema, handler, outputSchema?)`

Register a tool. The handler receives typed args matching the schema and returns a string, content helper, array of content, or a typed object when `outputSchema` is supplied.

```ts
const schema = defineSchema({
  query: { type: "string", description: "Search query" },
  limit: { type: "number", description: "Max results", optional: true }
});

server.tool("search", "Search for things", schema, async ({ query, limit }) => {
  // `query` is string, `limit` is number | undefined
  return `Found results for: ${query}`;
});
```

For structured-data tools, pass a root-object output schema. The server advertises it as MCP `Tool.outputSchema`, validates successful handler results, and returns them as `CallToolResult.structuredContent`. Plain object returns receive a JSON text backstop in `content[]` for older clients. Explicit `CallToolResult` values keep their handler-supplied content blocks; the JSON text backstop is added only when `content` is empty.

```ts
const input = defineSchema({
  query: { type: "string" }
});
const output = defineSchema({
  items: {
    type: "array",
    items: {
      type: "object",
      properties: {
        title: { type: "string" },
        score: { type: "number" }
      },
      required: ["title", "score"]
    }
  }
});

server.tool(
  "search",
  "Search",
  input,
  async ({ query }) => ({
    items: [{ title: query, score: 1 }]
  }),
  output
);
```

Object output schemas work across MCP versions; modern MCP also supports other JSON output types. Otherwise, supported JSON Schema keywords are accepted, including composition keywords, nullable type unions, and local `$defs`/`$ref` references. Input and output schemas compile synchronously during `.tool()` or `.registerTool()` registration, so malformed schemas throw immediately instead of failing on the first tool call.

Successful structured results must satisfy `outputSchema`. Validation failures use JSON-RPC `-32602` for inputs and `-32603` for outputs, with formatted validation details in the message and the issue array in `error.data`. Explicit handler results with `isError: true` are passed through unchanged and are exempt from structured-content and output-schema validation.

Tools whose natural result is prose, images, audio, files, or other content blocks should omit `outputSchema` and keep returning content.

Handlers can throw `ToolError` to return a JSON-RPC tool error with a specific code, message, and optional structured `data` payload. The server forwards that `data` field in the JSON-RPC error response so clients can inspect machine-readable failure details.

### Standard schemas, including Zod

Pass schemas implementing Standard Schema v1 and Standard JSON Schema v1
straight to `.tool()` or `.registerTool()`. Toolcraft schemas and Zod 4.5.4
support both interfaces. Existing `defineSchema` and raw JSON Schema inputs
continue to work on the same server.

```ts
import { z } from "zod"; // Your application's existing dependency
import { createServer } from "tiny-stdio-mcp-server";

createServer({ name: "search", version: "1" }).tool(
  "search",
  "Search",
  z.object({ query: z.string(), limit: z.number().default(10) }),
  ({ query, limit }) => `${query}: ${limit}`
);
```

Tiny MCP has no Zod dependency, peer dependency, imports, or adapter setup.
Detection uses the standard interfaces. Older libraries exposing validation
without JSON Schema conversion fail clearly during registration.

Discovery uses the schema's input JSON Schema and, when supplied, its output
JSON Schema. Runtime parsing uses the original library, preserving defaults,
coercions, transforms, refinements, and asynchronous validation. Handler arguments
are inferred from parsed output; a handler's return value is checked against the
output schema's accepted input. Output parsing runs once before structured content
and fallback text are produced. Explicit error results skip output parsing.

Input wire schemas must describe objects. Output schemas may describe any JSON
value for modern MCP; older clients receive object structured content or text
fallbacks for other values. Conversion failures occur at registration. Custom
refinements remain runtime checks and cannot always appear in discovery JSON
Schema. Async parsing shares the tool timeout and concurrency limits.
`validateToolArguments: false` disables input parsing, including defaults and
transforms; handlers then receive the original arguments.

### `.listen()`

Start listening on stdin/stdout (standard MCP stdio transport).

```ts
await server.listen();
```

### `.connect(transport)`

Connect to a custom readable/writable stream pair.

```ts
await server.connect({ readable: process.stdin, writable: process.stdout });
```

### `.connectSDK(transport)`

Connect using an SDK-compatible in-memory transport (for testing).

```ts
await server.connectSDK(sdkTransport);
```

### `.removeTool(name)` / `.notifyToolsChanged()`

Dynamically add/remove tools at runtime and notify connected clients.

## Configuration Options

- `createServer({ name, version, toolCallTimeoutMs? })`: server identity plus an optional positive-integer tool timeout in milliseconds. Timed-out calls return JSON-RPC error `-32603`; handlers continue running in the background.
- `.tool(name, description, schema, handler, outputSchema?)`: tool metadata, input schema, handler, and optional structured output schema.
- `.connect({ readable, writable })`: custom stream transport for tests or embedded hosts.

## `defineSchema(definition)`

Type-safe schema builder. Returns a JSON Schema object with inferred TypeScript types.

```ts
const schema = defineSchema({
  name: { type: "string", description: "User name" },
  age: { type: "number", description: "User age", optional: true }
});
// Handler receives: { name: string; age?: number }
```

## Environment Variables

This package does not read public environment variables.

Supported types: `string`, `number`, `boolean`, `object`, `array`.

## Content helpers

Tool handlers can return rich content beyond plain text.

### Images

```ts
import { Image } from "tiny-stdio-mcp-server";

server.tool("screenshot", "Take a screenshot", schema, async () => {
  return Image.fromBase64(base64Data, "image/png");
  // or: await Image.fromUrl("https://example.com/image.png", { maxBytes: 2 * 1024 * 1024 })
  // or: Image.fromBytes(uint8Array)
});
```

Supported formats: PNG, JPEG, GIF, WebP.

### Audio

```ts
import { Audio } from "tiny-stdio-mcp-server";

server.tool("speak", "Text to speech", schema, async () => {
  return Audio.fromBase64(base64Data, "audio/mpeg");
  // or: await Audio.fromUrl("https://example.com/audio.mp3", { maxBytes: 2 * 1024 * 1024 })
  // or: Audio.fromBytes(uint8Array, "mp3")
});
```

Supported formats: MP3, WAV, OGG, M4A.

Remote helpers (`Image.fromUrl`, `Audio.fromUrl`, and `File.fromUrl`) cap downloads at
`DEFAULT_FROM_URL_MAX_BYTES` (5 MiB). Pass `{ maxBytes }` to set a positive integer byte limit per
call; responses that exceed the limit are rejected before being converted to content blocks.

### Files

```ts
import { File } from "tiny-stdio-mcp-server";

server.tool("export", "Export data", schema, async () => {
  return File.fromText(csvContent, "text/csv");
  // or: File.fromBytes(uint8Array, "application/pdf")
  // or: await File.fromUrl("https://example.com/report.pdf", { maxBytes: 2 * 1024 * 1024 })
});
```

### Mixed content

Return arrays to send multiple content blocks:

```ts
server.tool("analyze", "Analyze image", schema, async () => {
  const image = await Image.fromUrl(url);
  return [image, "Analysis complete: found 3 objects"];
});
```

## Testing

Use `createTestPair` with the official MCP SDK for in-memory testing:

```ts
import { createTestPair } from "tiny-stdio-mcp-server/testing";

const server = createServer({ name: "test", version: "1.0.0" }).tool(
  "ping",
  "Ping",
  defineSchema({}),
  () => "pong"
);

const { client, cleanup } = await createTestPair(server);

const result = await client.callTool({ name: "ping", arguments: {} });
// result.content === [{ type: "text", text: "pong" }]

await cleanup();
```

Requires `@modelcontextprotocol/sdk` as a dev dependency.

## Environment variables

This package exposes no environment variables. Remote content helpers use the runtime `fetch`
implementation and do not read package-level configuration.

## Configuration

There are no package-level config files. Configure each server in code with `createServer(options)`,
per-tool schemas, and per-call content helper options such as `maxBytes` for remote files.

## License

MIT

## Protocol-only hosts

Import `createProtocolServer` and `defineSchema` from
`tiny-stdio-mcp-server/core` when your host supplies its own transport. This
entry point loads no Node stdio modules. Use `createMessageSession()` for an
isolated request lifecycle and close it when the transport completes. The
`handleMessage` context accepts `localContext` for host-owned state; tool
handlers receive it separately from client parameters and metadata. Use the
ordinary root `createServer` export for `listen()` or `connect()`; the core
entry point does not provide a stdio runtime.
