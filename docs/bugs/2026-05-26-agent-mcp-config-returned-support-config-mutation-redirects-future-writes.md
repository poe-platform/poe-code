# Agent MCP config returned support config mutation redirects future writes

## Summary

`@poe-code/agent-mcp-config` exposes its internal mutable `AgentMcpConfig` object through the public `resolveAgentSupport()` result. A caller that inspects supported agents can mutate the returned Claude Code configuration and redirect a later `configure()` operation away from `~/.claude.json`. Mutating `configFile` to `~/.redirected/mcp.json` causes subsequent MCP configuration to write into that alternate location instead of the standard Claude Code config file.

## Reproduction

Create a disposable Vitest probe at `packages/agent-mcp-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { configure } from "./apply.js";
import { resolveAgentSupport } from "./configs.js";

describe("agent-mcp-config returned support config mutation", () => {
  it("does not allow a support-inspection result to redirect later writes", async () => {
    const support = resolveAgentSupport("claude-code");
    if (support.status !== "supported" || !support.config) {
      throw new Error("Expected claude-code support");
    }

    const original = support.config.configFile;
    const fs = createMockFs({}, "/home/test");

    try {
      support.config.configFile = "~/.redirected/mcp.json";
      await configure(
        "claude-code",
        { name: "poe-code", config: { transport: "stdio", command: "npx" } },
        { fs, homeDir: "/home/test", platform: "darwin" }
      );

      expect(fs.getContent("/home/test/.claude.json")).toBeDefined();
    } finally {
      support.config.configFile = original;
    }
  });
});
```

Run and remove the probe:

```sh
npm exec -- vitest run packages/agent-mcp-config/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-mcp-config/src/__probe__.test.ts
```

## Observed Behavior

The probe fails because configuration no longer writes the Claude Code MCP settings file after mutating the public support result:

```text
FAIL  packages/agent-mcp-config/src/__probe__.test.ts > agent-mcp-config returned support config mutation > does not allow a support-inspection result to redirect later writes
AssertionError: expected undefined to be defined
 ❯ packages/agent-mcp-config/src/__probe__.test.ts:24:56
```

`agentMcpConfigs` stores the live Claude Code config object with `configFile: "~/.claude.json"` at `packages/agent-mcp-config/src/configs.ts:15` through `:62`. `resolveAgentSupport()` returns that object directly as `config` at `packages/agent-mcp-config/src/configs.ts:75` through `:88`. Later, `configure()` retrieves the same live object through `getAgentConfig()` and resolves its mutated `configFile` before executing the write mutation at `packages/agent-mcp-config/src/apply.ts:144` through `:205`.

## Expected Behavior

Public support inspection must not expose mutable internal registry state used by subsequent configuration operations. Returned config values should be immutable or defensively copied, so changing a caller-owned object cannot redirect future MCP configuration output paths.

## Impact

Any same-process consumer that examines supported MCP configuration can accidentally or deliberately poison global configuration state for later calls. MCP server entries intended for Claude Code can be silently written into an unrelated path, leaving the actual agent unconfigured and potentially overwriting a caller-selected JSON configuration file.
