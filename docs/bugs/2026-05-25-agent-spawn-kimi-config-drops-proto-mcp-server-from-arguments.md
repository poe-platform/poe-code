# Agent Spawn Kimi Config Drops a `__proto__` MCP Server From Arguments

## Summary

The public Kimi spawn configuration returned by `getSpawnConfig("kimi")` silently drops an MCP server explicitly named `__proto__` when it builds Kimi's `--mcp-config` command arguments. Kimi routes MCP setup through the JSON argument serializer, which copies dynamic server names into an ordinary object before stringifying it.

## Reproduction

Create a disposable Vitest probe at `packages/agent-spawn/src/configs/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getSpawnConfig } from "./index.js";

describe("Kimi MCP special server names", () => {
  it("drops an explicit __proto__ server from command arguments", () => {
    const config = getSpawnConfig("kimi");
    const args = config!.mcpArgs!(JSON.parse('{"__proto__":{"command":"custom-server"}}'));
    const serialized = JSON.parse(args[1]!) as { mcpServers: Record<string, unknown> };

    expect(Object.hasOwn(serialized.mcpServers, "__proto__")).toBe(false);
    expect(serialized.mcpServers).toEqual({});
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-spawn/src/configs/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that Kimi's generated command configuration contains no declared special-name server. Remove the disposable probe after validation.

## Observed Behavior

`getSpawnConfig("kimi")!.mcpArgs!(...)` returns a `--mcp-config` JSON payload whose `mcpServers` object is `{}` after input owning `__proto__` was supplied. `kimiSpawnConfig` delegates MCP arguments to `serializeJsonMcpArgs()`, whose `toJsonMcpServers()` helper creates `out = {}` and assigns dynamic names with `out[name] = mapped` before `JSON.stringify()` serializes the result.

## Expected Behavior

Kimi spawn argument generation should preserve each explicitly requested MCP server as inert JSON configuration data, including a server key named `__proto__`, or reject unsupported names explicitly instead of silently omitting one.

## Impact

Users launching Kimi through the public agent-spawn configuration can specify an MCP server that never reaches the launched agent. The operation appears configured successfully while Kimi receives an incomplete `--mcp-config` payload, hiding the reason expected MCP tools are unavailable.
