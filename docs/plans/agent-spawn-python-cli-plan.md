# Agent-Spawn Python SDK Plan

## Goal

Ship a **thin** Python SDK for `@poe-code/agent-spawn` by shelling out to the existing `poe-code spawn` CLI, keeping Python logic minimal and provider-agnostic.

## Non-Goals

- No CLI surface in Python — SDK only.
- No provider-specific branching in Python.
- No full port of the spawn logic or ACP adapters to Python.
- No changes to README without explicit approval.

## JS SDK Parity

The Python SDK mirrors the following JS SDK functions:

| JS SDK               | Python SDK            | Notes                          |
|----------------------|-----------------------|--------------------------------|
| `spawn()`           | `spawn()`            | Returns final result           |
| `spawnStreaming()`   | `spawn_streaming()`  | Yields events, returns result  |
| `spawnInteractive()` | `spawn_interactive()` | Inherits stdio                 |

## Prerequisites

- **Bun migration** — standalone binary compilation (`bun build --compile`) is required for bundling the binary into Python wheels. See [bun-migration-plan.md](bun-migration-plan.md).

## Approach

### 1) Implement stable JSON output contract for `poe-code spawn`

`OUTPUT_FORMAT=json` exists as an enum value in the design system but is **not yet implemented** for spawn output. This step builds it.

#### 1a) JSON Lines schema (ACP-compatible subset)

Follow the [ACP spec](https://agentclientprotocol.com/) wire format using `sessionUpdate` as the discriminator. Only the events we need:

- **`agent_message_chunk`** — streamed text content
  ```jsonl
  {"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"..."}}
  ```
- **`tool_call`** — tool invocation with status lifecycle
  ```jsonl
  {"sessionUpdate":"tool_call","toolCallId":"...","title":"...","kind":"read","status":"pending"}
  ```
- **`tool_call_update`** — tool result / status change
  ```jsonl
  {"sessionUpdate":"tool_call_update","toolCallId":"...","status":"completed","rawOutput":"..."}
  ```
- **`session_complete`** — final line, emitted once when spawn completes
  ```jsonl
  {"sessionUpdate":"session_complete","exitCode":0,"threadId":"...","sessionId":"...","usage":{"inputTokens":0,"outputTokens":0}}
  ```

No custom wrapper types — events are ACP objects directly, one per line. Python parses only these four `sessionUpdate` values.

#### 1b) Emit JSON lines in spawn

- When `resolveOutputFormat() === "json"`, suppress all human-facing rendering (design system, logger).
- Pipe each ACP event through a new `json-output` middleware that writes `{"type":"event",...}` lines to stdout.
- On spawn completion, emit the `{"type":"final",...}` line.
- Always pass `--yes` to suppress interactive prompts (CI-safe by default).

#### 1c) Tests

- Unit test the middleware: feed known `AcpEvent` objects, assert correct JSONL output.
- Integration-level: run `OUTPUT_FORMAT=json poe-code spawn ...` and assert parseable JSONL on stdout.

This keeps the CLI the single source of truth and prevents Python from needing to understand providers or adapter formats.

### 2) Python package (SDK)

Create a small Python package in `packages/agent-spawn-py` with:

- `spawn(...)` → runs `poe-code spawn` with `OUTPUT_FORMAT=json` and `--yes`, returns final result.
- `spawn_streaming(...)` → yields events as they arrive, returns final result when stream ends.
- `spawn_interactive(...)` → runs `poe-code spawn --interactive` with stdio inherit.

Only CLI args are constructed in Python; provider behavior remains in the JS CLI.

### 3) Packaging + distribution

#### Standalone binary

Compile the **full `poe-code` CLI** into a self-contained binary (no Node runtime required) using `bun build --compile`. This gives Python users the complete CLI, not just spawn. Produce one binary per platform:

- `poe-code-linux-x64`
- `poe-code-linux-arm64`
- `poe-code-darwin-x64`
- `poe-code-darwin-arm64`
- `poe-code-win-x64.exe`

#### Platform-specific wheels

Publish platform-specific wheels (like `playwright` does), each containing the binary for that platform:

- `poe_code_spawn-0.1.0-py3-none-manylinux_2_17_x86_64.whl`
- `poe_code_spawn-0.1.0-py3-none-macosx_11_0_arm64.whl`
- etc.

The binary is shipped as package data and exposed via a wrapper entry point or resolved at runtime by the SDK.

#### Package layout

- `pyproject.toml` with `src/` layout.
- Package README documenting all env variables and config options.
- `pip install poe-code-spawn` gives you the SDK + binary — zero external dependencies.
- Fallback: if `poe-code` is already on PATH, use that instead of the bundled binary (allows overriding).

### 4) Testing

- Unit tests mock the subprocess runner.
- Verify:
  - argument construction
  - JSON-line parsing
  - streaming iteration + final result handling
  - exit code propagation

## Open Questions

- None (decisions captured: SDK-only, JS-parity functions, `packages/agent-spawn-py`).
