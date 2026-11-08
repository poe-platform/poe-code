# tiny-stdio-mcp-test-server-rust

Test your MCP client with predictable text responses, a native Rust protocol core
and zero npm runtime dependencies. This private additive package embeds its server
and provides the same fixtures as `tiny-stdio-mcp-test-server`.

```sh
tiny-stdio-mcp-test-server-rust serve encrypt
tiny-stdio-mcp-test-server-rust serve word-of-the-day
```

```ts
import {createTestServer,caesarEncrypt} from 'tiny-stdio-mcp-test-server-rust';

console.log(caesarEncrypt('hello',3)); // khoor
const server=createTestServer(); // Both tools
await server.listen();
```

| Fixture | Tool | Output |
| --- | --- | --- |
| `encrypt` | `caesar_cipher_encrypt` (`text`, optional integer `shift`) | `hello` → `khoor` with default shift 3 |
| `word-of-the-day` | `word_of_the_day` | `Bumfuzzle - to confuse or fluster someone` |
| `createTestServer()` | Both tools | Text content blocks with deterministic results |

`createEncryptServer()` and `createWordOfTheDayServer()` create individual fixtures.
The MCP server identity remains `tiny-stdio-mcp-test-server` for compatible client
assertions. The CLI command carries the `-rust` suffix.

Rust rotates ASCII letters while preserving every other UTF-16 code unit, including
emoji and lone surrogates. Negative and large finite integer shifts wrap correctly;
fractional or nonfinite shifts are rejected. Node built-ins supply streams and
optional fixture files.

| Environment variable | Behavior |
| --- | --- |
| `TOOLCRAFT_TEST_STARTUP_DELAY_MS` | Delay startup when its numeric value is positive |
| `TOOLCRAFT_TEST_STARTUP_GATE_FILE` | Wait until the specified file is accessible |
| `TOOLCRAFT_TEST_SPAWN_COUNT_FILE` | Increment a non-negative safe integer counter before startup |
| `TOOLCRAFT_TEST_WRAPPER_PID_FILE` | Write the process PID before startup |
| `TOOLCRAFT_TEST_TOOL_CALL_FILE` | Append a tool name when its handler runs |

Use `--help`, `serve --help` or `--version` for command information.
The original packages and application imports remain available. Platform artifact
coverage and broader agent integration are still in progress.
