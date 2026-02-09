# tiny-stdio-mcp-test-server

A simple MCP test server with deterministic tools, built on [tiny-stdio-mcp-server](https://www.npmjs.com/package/tiny-stdio-mcp-server). Use it to verify your MCP client integration works end-to-end without hitting real APIs.

## Install

```sh
npm install tiny-stdio-mcp-test-server
```

## CLI

Serve a single tool over stdio:

```sh
npx tiny-stdio-mcp-test-server serve encrypt
npx tiny-stdio-mcp-test-server serve word-of-the-day
```

### Configure with an MCP client

Add to your agent's MCP config (e.g. Claude Code's `~/.claude.json`):

```json
{
  "mcpServers": {
    "test": {
      "command": "npx",
      "args": ["tiny-stdio-mcp-test-server", "serve", "word-of-the-day"]
    }
  }
}
```

## Available tools

### `encrypt`

Caesar cipher encryption. Deterministic — same input always gives same output.

| Parameter | Type   | Required | Description                  |
|-----------|--------|----------|------------------------------|
| `text`    | string | yes      | The text to encrypt          |
| `shift`   | number | no       | Shift amount (default: 3)    |

**Expected output:** `"hello"` with shift 3 returns `"khoor"`.

### `word-of-the-day`

Returns a fixed word of the day. No parameters.

**Expected output:** `"Bumfuzzle - to confuse or fluster someone"`.

## SDK usage

Use the library exports for in-memory testing without spawning a process:

```ts
import { createTestPair } from "tiny-stdio-mcp-server";
import { createTestServer } from "tiny-stdio-mcp-test-server";

const server = createTestServer(); // both tools
const { client, cleanup } = await createTestPair(server);

// List tools
const tools = await client.listTools();
assert(tools.tools.length === 2);

// Call encrypt
const encrypted = await client.callTool({
  name: "caesar_cipher_encrypt",
  arguments: { text: "hello", shift: 3 },
});
assert.deepEqual(encrypted.content, [{ type: "text", text: "khoor" }]);

// Call word of the day
const word = await client.callTool({
  name: "word_of_the_day",
  arguments: {},
});
assert.deepEqual(word.content, [
  { type: "text", text: "Bumfuzzle - to confuse or fluster someone" },
]);

await cleanup();
```

Single-tool servers are also available:

```ts
import { createEncryptServer, createWordOfTheDayServer } from "tiny-stdio-mcp-test-server";
```

## What to assert

- **Tool listing:** `client.listTools()` returns tools with correct names, descriptions, and JSON Schema
- **Encrypt determinism:** `caesar_cipher_encrypt({ text: "hello" })` always returns `"khoor"`
- **Shift parameter:** `caesar_cipher_encrypt({ text: "abc", shift: 1 })` returns `"bcd"`
- **Word of the day:** `word_of_the_day({})` always returns `"Bumfuzzle - to confuse or fluster someone"`
- **Schema validation:** `text` is required, `shift` is optional
- **Content format:** Results are always `[{ type: "text", text: "..." }]`

## License

MIT
