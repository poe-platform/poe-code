---
name: "Spawn Command Drops a `__proto__` MCP Server Before Autonomous SDK Invocation"
---

# Spawn Command Drops a `__proto__` MCP Server Before Autonomous SDK Invocation

## Summary

The root `poe-code spawn` command accepts a syntactically valid `--mcp-servers` JSON object containing a server named `__proto__`, but silently omits that MCP configuration before invoking the autonomous spawn SDK path. This affects ordinary MCP-capable agent spawning through the main CLI, independently of the standalone Poe Agent command and provider handoff paths.

## Reproduction

Create a disposable Vitest probe at `src/cli/commands/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";

const mocks = vi.hoisted(() => ({
  sdkSpawn: vi.fn(async () => ({
    events: (async function* () {})(),
    result: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
  })),
  spawnAutonomous: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
}));

vi.mock("../../sdk/spawn.js", () => ({ spawn: mocks.sdkSpawn }));
vi.mock("../../sdk/autonomous.js", () => ({ spawnAutonomous: mocks.spawnAutonomous }));
vi.mock("@poe-code/braintrust", () => ({
  loadIntegrations: vi.fn(async () => ({
    middlewares: [],
    traceRun: async (_command: string, _name: string, run: () => Promise<unknown>) => run(),
    shutdown: vi.fn(async () => undefined)
  }))
}));
vi.mock("@poe-code/workspace-resolver", () => ({ resolveWorkspace: vi.fn() }));
vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return { ...actual, supportsMcpAtSpawn: () => true };
});

describe("root spawn MCP server prototype-key repro", () => {
  it("drops a __proto__ MCP server before invoking the spawn SDK", async () => {
    const volume = new Volume();
    volume.mkdirSync("/home/test/.poe-code", { recursive: true });
    const program = createProgram({
      fs: createFsFromVolume(volume).promises as never,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test" },
      commandRunner: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
      logger: () => {}
    });

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "spawn",
      "--mcp-servers",
      '{"__proto__":{"command":"custom-server"}}',
      "codex",
      "hello"
    ]);

    const options = mocks.spawnAutonomous.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.hasOwn(options, "mcpServers")).toBe(false);
  });
});
```

Run:

```sh
npm exec -- vitest run src/cli/commands/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the root spawn command continues into autonomous execution without forwarding the explicitly supplied MCP server. Remove the disposable probe after validation.

## Observed Behavior

Running the parsed command equivalent of `poe-code --yes spawn --mcp-servers '{"__proto__":{"command":"custom-server"}}' codex hello` calls the autonomous SDK wrapper with no own `mcpServers` option. In `src/cli/commands/spawn.ts`, `parseMcpSpawnConfig()` validates the input and then constructs `servers = {}` while assigning each parsed dynamic server name through `servers[name] = ...`; for `name === "__proto__"`, the assignment mutates the temporary object's prototype rather than adding a server. The subsequent own-key length check converts the accepted input to `undefined`.

## Expected Behavior

The root spawn command should pass every accepted MCP server declaration through to autonomous spawning, including a data key named `__proto__`, or reject unsupported server names before starting execution.

## Impact

Users can supply a required MCP server to a normal `poe-code spawn` invocation and receive a running agent that lacks the configured tools without any validation failure. This can silently change agent behavior and make MCP-enabled workflows unreliable at the primary CLI entrypoint.
