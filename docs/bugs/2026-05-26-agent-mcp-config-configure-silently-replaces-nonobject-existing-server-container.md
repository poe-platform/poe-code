# Agent MCP config configure silently replaces nonobject existing server container

## Summary

The exported `@poe-code/agent-mcp-config` `configure()` API silently treats an existing non-object MCP server container as absent. If a user's parsed configuration contains a valid JSON value such as `mcpServers: ["user-value"]`, configuring one Poe Code server replaces the entire prior container with a new object instead of rejecting the incompatible shape or preserving it for diagnosis.

## Reproduction

Create the following disposable probe at `packages/agent-mcp-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { configure } from "./apply.js";

describe("malformed MCP server container", () => {
  it("silently replaces an existing non-object server container when configuring", async () => {
    const fs = createMockFs({
      "~/.claude.json": JSON.stringify({ mcpServers: ["user-value"], keep: true })
    }, "/home/test");

    await configure(
      "claude-code",
      { name: "poe-code", config: { transport: "stdio", command: "poe-code" } },
      { fs, homeDir: "/home/test", platform: "linux" }
    );

    expect(JSON.parse(fs.getContent("/home/test/.claude.json")!)).toEqual({
      mcpServers: { "poe-code": { command: "poe-code" } },
      keep: true
    });
  });
});
```

Run the probe and remove it immediately afterward:

```sh
npm exec -- vitest run packages/agent-mcp-config/src/__probe__.test.ts --reporter verbose
rm packages/agent-mcp-config/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/agent-mcp-config/src/__probe__.test.ts > malformed MCP server container > silently replaces an existing non-object server container when configuring
```

## Observed Behavior

The initial JSON configuration is syntactically valid and contains the existing value `mcpServers: ["user-value"]`. After the public `configure("claude-code", ...)` operation, that complete array has disappeared and is replaced by `{ "poe-code": { "command": "poe-code" } }`, without an error identifying the incompatible prior structure. `resolveServerMap()` in `packages/agent-mcp-config/src/apply.ts:30` returns `{}` whenever the existing configured value is not a non-array object. The configuration transform then spreads that empty replacement map and writes the new Poe Code entry at `packages/agent-mcp-config/src/apply.ts:185`, discarding the original container value.

## Expected Behavior

If an existing MCP server container has an incompatible persisted type, configuration should fail with an actionable validation error or require explicit repair. It must not silently substitute an empty server map and overwrite existing parsed user data while applying an unrelated new server entry.

## Impact

Externally edited, migrated, or tool-generated client configurations with an unexpected but syntactically valid MCP section can lose their complete prior value during routine Poe Code setup. The overwrite hides the reason for the incompatibility, can destroy user-managed server information, and converts a detectable configuration-shape problem into silent data loss.
