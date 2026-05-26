# Agent MCP config rejects whitespace-wrapped alias normalized by agent defs

## Summary

The public agent-definition API normalizes a whitespace-wrapped known alias such as `"  CLAUDE  "` to the supported agent ID `"claude-code"`, but the exported `@poe-code/agent-mcp-config` configuration API resolves aliases through a different path that does not trim surrounding whitespace. The same user-supplied agent identifier is therefore canonicalized as valid by `normalizeAgentId()` yet rejected as unsupported when passed to `configure()`.

## Reproduction

Create the following disposable probe at `packages/agent-mcp-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { normalizeAgentId, resolveAgentId } from "@poe-code/agent-defs";
import { configure, UnsupportedAgentError } from "./apply.js";

describe("whitespace-wrapped supported agent ids", () => {
  it("normalizes an alias but rejects the same wrapped alias during configuration", async () => {
    const fs = createMockFs({}, "/home/test");

    expect(normalizeAgentId("  CLAUDE  ")).toBe("claude-code");
    expect(resolveAgentId("  CLAUDE  ")).toBeUndefined();

    await expect(configure(
      "  CLAUDE  ",
      { name: "poe-code", config: { transport: "stdio", command: "poe-code", args: ["mcp"] } },
      { fs, homeDir: "/home/test", platform: "linux" }
    )).rejects.toBeInstanceOf(UnsupportedAgentError);
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
✓ packages/agent-mcp-config/src/__probe__.test.ts > whitespace-wrapped supported agent ids > normalizes an alias but rejects the same wrapped alias during configuration
```

## Observed Behavior

`normalizeAgentId()` trims its complete input before parsing and resolving the alias in `packages/agent-defs/src/specifier.ts:30`, so `"  CLAUDE  "` becomes the canonical supported ID `"claude-code"`. The companion exported resolver `resolveAgentId()` instead lowercases without trimming in `packages/agent-defs/src/registry.ts:36`, and therefore returns `undefined` for the same padded alias. `resolveAgentSupport()` in `packages/agent-mcp-config/src/configs.ts:75` calls the untrimmed resolver directly, causing `configure()` to throw `UnsupportedAgentError` through `packages/agent-mcp-config/src/apply.ts:149` rather than applying configuration for the normalized supported agent.

## Expected Behavior

Public APIs consuming agent identifiers should use consistent canonicalization. If surrounding whitespace is accepted and trimmed by `normalizeAgentId()`, supported configuration APIs should resolve the same whitespace-wrapped known aliases to their canonical IDs rather than rejecting them as unsupported.

## Impact

Callers that normalize stored, prompted, or config-derived agent selections before passing them to lower-level package APIs can observe contradictory validity for the same identifier. Whitespace introduced by human input or configuration formatting can make an otherwise supported MCP client unexpectedly fail setup, while other flows accepting normalized identifiers continue to treat it as valid.
