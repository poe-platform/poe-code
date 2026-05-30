---
name: "Spawn Command Drops a `__proto__` MCP Server Environment Variable"
---

# Spawn Command Drops a `__proto__` MCP Server Environment Variable

## Summary

The root `poe-code spawn` command preserves an MCP server declared through `--mcp-servers`, but silently removes an environment variable named `__proto__` from that server's configuration before autonomous spawning. The agent starts with the server present and an empty server environment instead of the supplied variable.

## Reproduction

Create a disposable Vitest probe at `src/cli/commands/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";

const mocks = vi.hoisted(() => ({
  spawnAutonomous: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
}));

vi.mock("../../sdk/spawn.js", () => ({ spawn: vi.fn() }));
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

describe("root spawn MCP environment prototype-key repro", () => {
  it("drops a __proto__ environment variable from a retained MCP server", async () => {
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
      "node", "cli", "--yes", "spawn", "--mcp-servers",
      '{"server":{"command":"custom-server","env":{"__proto__":"visible"}}}',
      "codex", "hello"
    ]);

    const options = mocks.spawnAutonomous.mock.calls[0]?.[1] as {
      mcpServers: { server: { env?: Record<string, string> } }
    };
    expect(options.mcpServers.server.env).toEqual({});
    expect(Object.hasOwn(options.mcpServers.server.env!, "__proto__")).toBe(false);
  });
});
```

Run:

```sh
npm exec -- vitest run src/cli/commands/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the MCP server is forwarded while its declared environment value disappears. Remove the disposable probe after validation.

## Observed Behavior

Parsing `poe-code --yes spawn --mcp-servers '{"server":{"command":"custom-server","env":{"__proto__":"visible"}}}' codex hello` invokes the autonomous SDK wrapper with `mcpServers.server` present but `mcpServers.server.env` equal to `{}` with no own `__proto__` value. In `src/cli/commands/spawn.ts`, `parseMcpSpawnConfig()` validates each server environment and copies its dynamic keys into `env = {}` through `env[envKey] = envValue`; the special key is lost before the retained server configuration is propagated.

## Expected Behavior

MCP server environment parsing should retain every accepted string-valued variable, including `__proto__`, or reject unsupported variable names explicitly rather than silently altering a successfully forwarded server configuration.

## Impact

A normal `poe-code spawn` invocation can launch an MCP server without required environment configuration while giving no validation error. The server may fail authentication, use wrong behavior, or become unusable even though the CLI accepted the complete configuration and launched the agent.
