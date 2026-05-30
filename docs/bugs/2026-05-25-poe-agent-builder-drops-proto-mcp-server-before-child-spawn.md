---
name: "Poe Agent Builder Drops a `__proto__` MCP Server Before Child Spawn"
---

# Poe Agent Builder Drops a `__proto__` MCP Server Before Child Spawn

## Summary

The public `@poe-code/poe-agent` builder accepts an MCP configuration map with a server named `__proto__`, initializes that server successfully, but silently drops it from the MCP server map forwarded to a spawned child agent. The child handoff rebuilds configured server entries into an ordinary object with dynamic bracket assignment.

## Reproduction

Create a disposable Vitest probe at `packages/poe-agent/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const createInMemorySpawnSessionMock = vi.hoisted(() => vi.fn());

vi.mock("./runtime/agent-host.js", async () => {
  const actual = await vi.importActual<typeof import("./runtime/agent-host.js")>("./runtime/agent-host.js");
  return { ...actual, createInMemorySpawnSession: (...args: unknown[]) => createInMemorySpawnSessionMock(...args) };
});
vi.mock("tiny-mcp-client", () => ({
  StdioTransport: class {},
  McpClient: class {
    async connect(): Promise<void> {}
    async listTools(): Promise<{ tools: never[] }> { return { tools: [] }; }
    async close(): Promise<void> {}
  }
}));

import { agent } from "./agent.js";
import spawnPlugin from "./plugins/poe-agent-plugin-spawn.js";
import { toAcpModelResponse } from "./testing/model-response.js";

describe("poe-agent builder special MCP server names", () => {
  it("drops a map-configured __proto__ server before default child spawn handoff", async () => {
    createInMemorySpawnSessionMock.mockReturnValue({
      cwd: "/workspace",
      mcpServers: [],
      client: {
        initialize: vi.fn(async () => undefined),
        newSession: vi.fn(async () => ({ sessionId: "spawn-session" })),
        prompt: vi.fn(() => ({ response: Promise.resolve({ stopReason: "completed" as const }), async *[Symbol.asyncIterator]() {} })),
        dispose: vi.fn(async () => undefined)
      }
    });
    const model = {
      complete: vi.fn()
        .mockResolvedValueOnce(toAcpModelResponse({ message: { content: "", toolCalls: [{ id: "spawn-1", tool: "spawn", args: { task: "inspect" } }] } }))
        .mockResolvedValueOnce(toAcpModelResponse({ message: { content: "done", toolCalls: [] } }))
    } as never;

    await agent().model("demo").mcp(JSON.parse('{"__proto__":{"command":"custom-server"}}')).use(spawnPlugin()).run("hello", { cwd: "/workspace", acpModel: model });

    const mcpServers = createInMemorySpawnSessionMock.mock.calls[0]?.[0].mcpServers as Record<string, unknown>;
    expect(Object.hasOwn(mcpServers, "__proto__")).toBe(false);
    expect(mcpServers).toEqual({});
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-agent/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the child session receives an empty MCP map after the builder accepted and initialized the declared server. Remove the disposable probe after validation.

## Observed Behavior

The builder accepts `.mcp(JSON.parse('{"__proto__":{"command":"custom-server"}}'))`, and plugin setup is able to initialize that server. When the `spawn` plugin launches a child, `createInMemorySpawnSession()` receives `mcpServers: {}` with no own `__proto__` entry. In `packages/poe-agent/src/agent.ts`, `toSpawnMcpServers()` initializes `byName` as `{}` and assigns each configured name with `byName[server.name] = ...`.

## Expected Behavior

MCP servers configured through the public agent builder should remain available to child agent sessions, including server names that are valid data keys such as `__proto__`, or unsupported names should be rejected before setup rather than dropped only during propagation.

## Impact

An agent can use a configured MCP server in its own context while silently depriving spawned child agents of the same server. This produces inconsistent tool availability across parent and child execution and makes delegated tasks fail or degrade without an explicit configuration error.
