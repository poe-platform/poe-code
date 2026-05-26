# Spawn MCP overflowing timeout forwards infinite agent timeout

## Summary

The `poe-code spawn --mcp-servers` command accepts a valid JSON numeric timeout whose exponent overflows JavaScript, such as `1e400`. `JSON.parse()` produces `Infinity`, the command's timeout validation treats it as a positive number, and SDK spawn receives an unbounded MCP timeout value that is serialized into downstream agent configuration.

## Reproduction

Create this disposable probe at `src/cli/commands/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import type { FileSystem } from "../../utils/file-system.js";

vi.mock("../../sdk/spawn.js", () => ({ spawn: vi.fn() }));
import { spawn as sdkSpawn } from "../../sdk/spawn.js";

function emptyAsyncIterable<T>(): AsyncIterable<T> {
  return (async function* () {})();
}

describe("spawn MCP overflowing timeout probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));
  });

  it("accepts overflowing JSON timeout as Infinity", async () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises as unknown as FileSystem;
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test" },
      commandRunner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      logger: () => {}
    });

    await program.parseAsync([
      "node", "cli", "--yes", "spawn", "--mcp-servers",
      '{"bad":{"command":"srv","timeout":1e400}}',
      "codex", "Run MCP"
    ]);

    const mcpServers = vi.mocked(sdkSpawn).mock.calls[0]?.[1].mcpServers;
    console.log(JSON.stringify({
      timeout: String(mcpServers?.bad.timeout),
      finite: Number.isFinite(mcpServers?.bad.timeout)
    }));
    expect(mcpServers?.bad.timeout).toBe(Infinity);
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run src/cli/commands/__probe__.test.ts --reporter verbose
rm src/cli/commands/__probe__.test.ts
```

Output:

```text
stdout | src/cli/commands/__probe__.test.ts > spawn MCP overflowing timeout probe > accepts overflowing JSON timeout as Infinity
{"timeout":"Infinity","finite":false}

 ✓ src/cli/commands/__probe__.test.ts > spawn MCP overflowing timeout probe > accepts overflowing JSON timeout as Infinity 7ms
```

## Observed Behavior

`parseMcpSpawnConfig()` parses the CLI JSON input in `src/cli/commands/spawn.ts:541` and validates each optional timeout only with `typeof value.timeout !== "number" || value.timeout <= 0` in `src/cli/commands/spawn.ts:610`. For the valid JSON number `1e400`, `JSON.parse()` returns `Infinity`; it is still a number and is greater than zero, so it is forwarded as `mcpServers.bad.timeout`. The Codex MCP argument serializer later inserts that value verbatim as `mcp_servers.<name>.timeout=Infinity` in `packages/agent-spawn/src/configs/mcp.ts:70`.

## Expected Behavior

MCP server timeouts accepted by `poe-code spawn` should be finite positive numbers. Numeric literals that overflow to `Infinity` should be rejected with the same `--mcp-servers entry "<name>".timeout` validation error rather than forwarded to an agent.

## Impact

A user or generated MCP configuration can silently disable the intended per-server timeout bound for spawned agents by supplying an overflowing JSON numeric literal. Tool calls to a stalled MCP server may then wait indefinitely or be governed by backend-specific handling of an invalid infinite timeout, despite the CLI accepting the input as a validated timeout configuration.
