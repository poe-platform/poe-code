# Poe Agent Provider ACP Launch Drops a `__proto__` MCP Server Before Session Creation

## Summary

The exported `spawnPoeAgentWithAcp()` provider helper accepts an MCP server named `__proto__` but silently drops it while converting spawn configuration into Poe Agent session configuration. The ACP lifecycle proceeds normally, yet the created agent session receives no MCP servers.

## Reproduction

Create a disposable Vitest probe at `src/providers/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionOptions: undefined as unknown,
  sendMessage: vi.fn(async () => ({ content: "done" })),
  dispose: vi.fn(async () => undefined)
}));

vi.mock("@poe-code/poe-agent", () => ({
  createAgentSession: vi.fn(async (options: unknown) => {
    mocks.sessionOptions = options;
    return { sendMessage: mocks.sendMessage, dispose: mocks.dispose };
  }),
  parseNullablePluginConfigEntries: (value: unknown) => value,
  parsePluginConfigEntries: (value: unknown) => value
}));

describe("poe-agent provider MCP server prototype-key repro", () => {
  beforeEach(() => {
    mocks.sessionOptions = undefined;
    mocks.sendMessage.mockClear();
    mocks.dispose.mockClear();
  });

  it("drops an explicitly supplied __proto__ server before session creation", async () => {
    const { spawnPoeAgentWithAcp } = await import("./poe-agent.js");
    const { done } = spawnPoeAgentWithAcp({
      prompt: "hello",
      cwd: "/repo",
      mcpServers: JSON.parse('{"__proto__":{"command":"custom-server"}}')
    });

    await done;

    const options = mocks.sessionOptions as { mcpServers?: Record<string, unknown> };
    expect(options.mcpServers).toBeUndefined();
  });
});
```

Run:

```sh
npm exec -- vitest run src/providers/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that ACP session creation succeeds without the explicitly supplied MCP server. Remove the disposable probe after validation.

## Observed Behavior

Calling `spawnPoeAgentWithAcp()` with an input `mcpServers` object owning `__proto__: { command: "custom-server" }` resolves successfully, but the mocked `createAgentSession()` receives `mcpServers: undefined`. In `src/providers/poe-agent.ts`, `toAgentSessionMcpServers()` creates `mappedServers = {}` and copies dynamic server names using `mappedServers[name] = ...`; assigning `__proto__` changes the intermediate object's prototype rather than creating an own server entry. Because `Object.keys(mappedServers)` remains empty, the helper discards the configuration before starting the session.

## Expected Behavior

The ACP provider launcher should pass every accepted MCP server configuration through to Poe Agent session creation, including a data key named `__proto__`, or reject unsupported server names explicitly before starting execution.

## Impact

Applications launching Poe Agent through the exported ACP provider path can silently lose a required MCP tool server while receiving an otherwise successful session lifecycle. Tools expected by the prompt become unavailable with no configuration error, causing incorrect or degraded agent execution.
