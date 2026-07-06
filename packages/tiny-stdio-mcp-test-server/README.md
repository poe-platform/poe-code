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

| Tool                    | Description                              | Expected output                               |
| ----------------------- | ---------------------------------------- | --------------------------------------------- |
| `caesar_cipher_encrypt` | Caesar cipher (`text`, optional `shift`) | `"hello"` → `"khoor"`                         |
| `word_of_the_day`       | Fixed word of the day (no params)        | `"Bumfuzzle - to confuse or fluster someone"` |

## What to assert

- **Tool discovery:** your client can list tools with correct names, descriptions, and JSON Schema
- **Deterministic output:** `caesar_cipher_encrypt({ text: "hello" })` always returns `"khoor"`
- **Optional parameters:** `caesar_cipher_encrypt({ text: "abc", shift: 1 })` returns `"bcd"`
- **Zero-arg tools:** `word_of_the_day({})` always returns `"Bumfuzzle - to confuse or fluster someone"`
- **Content format:** results are always `[{ type: "text", text: "..." }]`

## Environment Variables

| Variable                           | Description                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `TOOLCRAFT_TEST_STARTUP_DELAY_MS`  | Milliseconds to wait before starting the stdio server. Values greater than `0` delay startup.                                        |
| `TOOLCRAFT_TEST_STARTUP_GATE_FILE` | Path to a file that must exist before startup continues. The CLI polls until the file is accessible.                                 |
| `TOOLCRAFT_TEST_SPAWN_COUNT_FILE`  | Path to a counter file incremented every time the `serve` command starts. The file must contain a non-negative integer when present. |
| `TOOLCRAFT_TEST_WRAPPER_PID_FILE`  | Path where the CLI writes the wrapper process PID when `serve` starts.                                                               |
| `TOOLCRAFT_TEST_TOOL_CALL_FILE`    | Path where the server appends one tool name per successful tool call.                                                                |

## Configuration Options

Configure the server by choosing the `serve` fixture (`encrypt` or `word-of-the-day`) and, for tests, by setting the environment variables above. There is no config file.

## License

MIT
