# Superintendent proto MCP server disappears before agent spawn

## Summary

`@poe-code/superintendent` loses a valid frontmatter MCP server named `__proto__` while assembling the MCP configuration passed to the superintendent agent. The configured server becomes the JavaScript prototype of the temporary server map instead of an own MCP server entry, so the spawned agent never receives the declared tool server.

## Reproduction

From the repository root, add a disposable probe at `packages/superintendent/src/runtime/__probe__.test.ts`:

```ts
import type { SuperintendentDoc } from "../document/parse.js";
import { describe, expect, it, vi } from "vitest";

const { runAutonomousAgentMock } = vi.hoisted(() => ({
  runAutonomousAgentMock: vi.fn(async () => "done")
}));

vi.mock("./agent-runner.js", () => ({
  runAutonomousAgent: runAutonomousAgentMock
}));

describe("superintendent special MCP server names", () => {
  it("drops an explicitly configured __proto__ server before spawning", async () => {
    const { runSuperintendent } = await import("./run-superintendent.js");
    const document = {
      filePath: "/repo/docs/plans/feature.md",
      body: "# Feature plan\n",
      frontmatter: {
        kind: "superintendent",
        version: 1,
        mcp: JSON.parse('{"__proto__":{"command":"custom-server"}}'),
        builder: { agent: "claude-code", prompt: "Build" },
        superintendent: { agent: "codex", prompt: "Review" },
        owner: { agent: "claude-code", prompt: "Approve" },
        status: { state: "in_progress", round: 1, review_turn: 0 }
      }
    } as SuperintendentDoc;

    await runSuperintendent(document, {}, { defaultCwd: "/repo" });

    const servers = runAutonomousAgentMock.mock.calls[0]?.[0].mcpServers as Record<string, unknown>;
    expect(Object.hasOwn(servers, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(servers)).toEqual({ command: "custom-server" });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/superintendent/src/runtime/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/superintendent/src/runtime/__probe__.test.ts > superintendent special MCP server names > drops an explicitly configured __proto__ server before spawning
```

Remove the disposable probe after running it.

## Observed Behavior

An own `__proto__` MCP entry parsed from document frontmatter is absent from the `mcpServers` map supplied to `runAutonomousAgent()`. Instead, `Object.getPrototypeOf(mcpServers)` equals the configured server object. `buildMcpServers()` in `packages/superintendent/src/runtime/run-superintendent.ts` initializes a normal object and copies dynamic server names with `servers[name] = toSpawnMcpServer(config)`, so the special key invokes prototype mutation rather than preserving the server entry.

## Expected Behavior

Every accepted MCP server declaration should be forwarded as an own spawn configuration entry, including names that are legal data keys such as `__proto__`, or those names should be rejected explicitly during document validation. Building runtime server maps must not reinterpret declared server names as JavaScript prototype operations.

## Impact

Superintendent documents can silently lose an explicitly configured MCP server before execution, causing required tools to be unavailable to the autonomous agent while configuration parsing and startup appear successful. The mutation also contaminates the intermediate spawn-map prototype with frontmatter-controlled data.
