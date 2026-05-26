# Memory Install MCP Config Failure Leaves Skill Installed

## Summary

The exported `@poe-code/memory` `installMemory()` API installs the Memory skill before configuring its MCP server integration. If MCP configuration then fails, the installation rejects after leaving the skill file persisted, creating a partial installation that does not match the failed result.

## Reproduction

Create a disposable probe at `packages/memory/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";

const { configure } = vi.hoisted(() => ({
  configure: vi.fn().mockRejectedValue(new Error("injected MCP config failure"))
}));

vi.mock("@poe-code/agent-mcp-config", () => ({ configure }));

const { installMemory } = await import("./install.js");

describe("memory installer partial publication probe", () => {
  it("fails after installing the skill when MCP configuration rejects", async () => {
    const fs = createMockFs(undefined, "/home/test");

    await expect(installMemory({
      agent: "claude-code",
      skillContent: "# Memory skill",
      fs,
      cwd: "/repo",
      homeDir: "/home/test",
      platform: "darwin"
    })).rejects.toThrow("injected MCP config failure");

    expect(configure).toHaveBeenCalledOnce();
    expect(fs.getContent("/repo/.claude/skills/poe-code-memory/SKILL.md")).toBe(
      "# Memory skill"
    );
  });
});
```

Run:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
```

The probe passes, proving that the skill is published before the failed MCP step. Remove the disposable probe afterward.

## Observed Behavior

`installMemory()` rejects with `injected MCP config failure`, but `/repo/.claude/skills/poe-code-memory/SKILL.md` already contains the newly installed skill. The requested default installation therefore ends with a skill present while its paired MCP server configuration was not completed.

## Expected Behavior

The default Memory installation should complete skill installation and MCP configuration as one coherent operation. If MCP configuration cannot be committed, the function should not leave the new skill installed, or it should explicitly report a partial-success state that callers can recover from.

## Impact

Callers can receive an installation error while the agent begins exposing Memory skill instructions without the MCP integration required to execute them. Retrying installation or diagnosing unavailable Memory functionality now depends on discovering undocumented partial state in the agent skill directory.
