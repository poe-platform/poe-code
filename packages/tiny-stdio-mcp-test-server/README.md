# tiny-stdio-mcp-test-server

A deterministic MCP server for testing your MCP client integration end-to-end — no real APIs, no flaky responses. Every call returns the same predictable output, so you can assert with confidence.

Built on [tiny-stdio-mcp-server](https://www.npmjs.com/package/tiny-stdio-mcp-server).

## Quick start

```sh
npx tiny-stdio-mcp-test-server serve encrypt
npx tiny-stdio-mcp-test-server serve word-of-the-day
```

## Configure with an MCP client

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

| Tool | Description | Expected output |
|------|-------------|-----------------|
| `caesar_cipher_encrypt` | Caesar cipher (`text`, optional `shift`) | `"hello"` → `"khoor"` |
| `word_of_the_day` | Fixed word of the day (no params) | `"Bumfuzzle - to confuse or fluster someone"` |

## What to assert

- **Tool discovery:** your client can list tools with correct names, descriptions, and JSON Schema
- **Deterministic output:** `caesar_cipher_encrypt({ text: "hello" })` always returns `"khoor"`
- **Optional parameters:** `caesar_cipher_encrypt({ text: "abc", shift: 1 })` returns `"bcd"`
- **Zero-arg tools:** `word_of_the_day({})` always returns `"Bumfuzzle - to confuse or fluster someone"`
- **Content format:** results are always `[{ type: "text", text: "..." }]`

## License

MIT
