---
name: "Poe Agent `--mcp-servers` Drops a `__proto__` Server Environment Variable"
---

# Poe Agent `--mcp-servers` Drops a `__proto__` Server Environment Variable

## Summary

The standalone `poe-agent` CLI preserves an MCP server declared via `--mcp-servers`, but silently drops a string environment variable named `__proto__` from that server before invoking the agent provider. This is distinct from dropping an entire server: the command starts with the server configured but with altered environment settings.

## Reproduction

Create a disposable Vitest probe at `src/cli/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPoeAgentProgram, normalizePoeAgentArgv } from "./poe-agent-main.js";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("../providers/poe-agent.js", () => ({
  spawnPoeAgentWithAcp: spawnMock
}));

describe("standalone poe-agent MCP environment prototype-key repro", () => {
  beforeEach(() => {
    spawnMock.mockReset().mockReturnValue({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    });
  });

  it("drops a __proto__ environment variable from a retained MCP server", async () => {
    const program = createPoeAgentProgram();
    await program.parseAsync(
      normalizePoeAgentArgv([
        "node", "poe-agent", "--mcp-servers",
        '{"server":{"command":"custom-server","env":{"__proto__":"visible"}}}',
        "hello"
      ])
    );

    const options = spawnMock.mock.calls[0]?.[0] as {
      mcpServers: { server: { env?: Record<string, string> } }
    };
    expect(options.mcpServers.server.env).toEqual({});
    expect(Object.hasOwn(options.mcpServers.server.env!, "__proto__")).toBe(false);
  });
});
```

Run:

```sh
npm exec -- vitest run src/cli/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that agent startup receives a retained MCP server whose supplied environment variable has vanished. Remove the disposable probe after validation.

## Observed Behavior

Calling the standalone command parser with `--mcp-servers '{"server":{"command":"custom-server","env":{"__proto__":"visible"}}}'` reaches mocked `spawnPoeAgentWithAcp()` with `mcpServers.server` intact but `mcpServers.server.env` equal to `{}`. In `src/cli/poe-agent-main.ts`, `parseMcpSpawnConfig()` validates nested environment entries and writes them into `env = {}` using `env[envKey] = envValue`; the special environment name does not become an own retained variable.

## Expected Behavior

The standalone Poe Agent CLI should preserve every accepted MCP server environment value, including `__proto__`, or reject unsupported names explicitly before launching the agent.

## Impact

MCP servers started through the standalone CLI can silently lose necessary configuration while still being passed to the provider. Authentication or runtime settings may be absent at server startup, making tools fail or behave differently even though the supplied JSON was accepted.
