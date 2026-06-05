# tiny-stdio-mcp-server

Minimal [Model Context Protocol](https://modelcontextprotocol.io) server for Node.js. Zero runtime dependencies, type-safe tool definitions, prompt and resource registries, rich content helpers for images/audio/files.

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

### `.tool(name, description, schema, handler)`

Register a tool. The handler receives typed args matching the schema and returns a string, content helper, or array of either.

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

### `.prompt(definition, handler)`

Register a reusable MCP prompt. Prompt arguments arrive as strings and required
arguments declared in `definition.arguments` are validated before the handler
runs.

```ts
server.prompt(
  {
    name: "review",
    description: "Create a code review prompt",
    arguments: [{ name: "diff", required: true }]
  },
  ({ diff }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `Review this diff:\n${diff}` }
      }
    ]
  })
);
```

Clients call `prompts/list` and `prompts/get` to discover and render prompts.

### `.resource(definition, handler)` / `.resourceTemplate(definition, handler)`

Register static resources by URI or templated resources by URI template.
Handlers return MCP `contents` with either `text` or base64 `blob` payloads.

```ts
server
  .resource({ uri: "memo://welcome", name: "welcome", mimeType: "text/plain" }, () => ({
    contents: [{ uri: "memo://welcome", mimeType: "text/plain", text: "Welcome" }]
  }))
  .resourceTemplate({ uriTemplate: "memo://{id}", name: "memo" }, (uri) => ({
    contents: [{ uri, mimeType: "text/plain", text: `Loaded ${uri}` }]
  }));
```

Clients call `resources/list`, `resources/templates/list`, `resources/read`,
`resources/subscribe`, and `resources/unsubscribe`.

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

### Dynamic registries and notifications

Use `.removeTool(name)`, `.removePrompt(name)`, `.removeResource(uri)`, and
`.removeResourceTemplate(uriTemplate)` to mutate registries at runtime. After a
change, notify initialized clients with `.notifyToolsChanged()`,
`.notifyPromptsChanged()`, `.notifyResourcesChanged()`, or
`.notifyResourceUpdated(uri)`. Resource update notifications are sent only to
clients subscribed to that URI.

## `defineSchema(definition)`

Type-safe schema builder. Returns a JSON Schema object with inferred TypeScript types.

```ts
const schema = defineSchema({
  name: { type: "string", description: "User name" },
  age: { type: "number", description: "User age", optional: true }
});
// Handler receives: { name: string; age?: number }
```

Supported types: `string`, `number`, `boolean`, `object`, `array`.

## Configuration

`createServer()` accepts these options:

| Option                         | Default | Description                                                               |
| ------------------------------ | ------- | ------------------------------------------------------------------------- |
| `name`                         | none    | MCP server name exposed during initialization.                            |
| `version`                      | none    | MCP server version exposed during initialization.                         |
| `validateToolArguments`        | `true`  | Validate tool arguments against each tool input schema.                   |
| `supportNotifications`         | `true`  | Advertise list-change notifications for tools, prompts, and resources.    |
| `supportResourceSubscriptions` | `true`  | Advertise resource subscription support and enable `resources/subscribe`. |

The server advertises MCP protocol `2025-11-25` by default and also accepts
clients requesting `2025-03-26` or `2025-06-18`.

## Content helpers

Tool handlers can return rich content beyond plain text.

### Images

```ts
import { Image } from "tiny-stdio-mcp-server";

server.tool("screenshot", "Take a screenshot", schema, async () => {
  return Image.fromBase64(base64Data, "image/png");
  // or: await Image.fromUrl("https://example.com/image.png")
  // or: Image.fromBytes(uint8Array)
});
```

Supported formats: PNG, JPEG, GIF, WebP.

### Audio

```ts
import { Audio } from "tiny-stdio-mcp-server";

server.tool("speak", "Text to speech", schema, async () => {
  return Audio.fromBase64(base64Data, "audio/mpeg");
  // or: await Audio.fromUrl("https://example.com/audio.mp3")
  // or: Audio.fromBytes(uint8Array, "mp3")
});
```

Supported formats: MP3, WAV, OGG, M4A.

### Files

```ts
import { File } from "tiny-stdio-mcp-server";

server.tool("export", "Export data", schema, async () => {
  return File.fromText(csvContent, "text/csv");
  // or: File.fromBytes(uint8Array, "application/pdf")
  // or: await File.fromUrl("https://example.com/report.pdf")
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

## Environment Variables

This package does not use any environment variables. All runtime configuration
is passed through `createServer()` options and registry methods.

## License

MIT
