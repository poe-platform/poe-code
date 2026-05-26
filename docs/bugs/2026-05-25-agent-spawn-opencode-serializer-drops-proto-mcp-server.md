# Agent Spawn OpenCode Serializer Drops a `__proto__` MCP Server

## Summary

The exported `@poe-code/agent-spawn` `serializeOpenCodeMcpEnv()` API silently drops an MCP server explicitly named `__proto__`. It copies arbitrary server names into an ordinary `mcp` object using bracket assignment, so the server becomes the temporary object's prototype rather than part of the serialized `OPENCODE_CONFIG_CONTENT` payload.

## Reproduction

Create a disposable Vitest probe at `packages/agent-spawn/src/configs/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { serializeOpenCodeMcpEnv } from "./mcp.js";

describe("OpenCode MCP special server names", () => {
  it("drops an explicit __proto__ server from serialized config", () => {
    const serialized = serializeOpenCodeMcpEnv(
      JSON.parse('{"__proto__":{"command":"custom-server"}}')
    );
    const config = JSON.parse(serialized.OPENCODE_CONFIG_CONTENT) as { mcp: Record<string, unknown> };

    expect(Object.hasOwn(config.mcp, "__proto__")).toBe(false);
    expect(config.mcp).toEqual({});
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-spawn/src/configs/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the server is absent from the generated OpenCode configuration. Remove the disposable probe after validation.

## Observed Behavior

`serializeOpenCodeMcpEnv()` returns `OPENCODE_CONFIG_CONTENT` whose parsed `mcp` object is empty after receiving an input that owns a `__proto__` MCP server. In `packages/agent-spawn/src/configs/mcp.ts`, the function initializes `mcp` as `{}` and writes each accepted server as `mcp[name] = entry` before calling `JSON.stringify({ mcp })`.

## Expected Behavior

The OpenCode MCP serialization API should preserve every explicitly configured server as inert serialized data, including the valid object key `__proto__`, or reject unsupported server names rather than silently removing one.

## Impact

Callers configuring OpenCode through the exported agent-spawn serializer can successfully request an MCP server that is never delivered to the launched tool. This causes silent configuration loss and makes troubleshooting unavailable MCP tools significantly harder.
