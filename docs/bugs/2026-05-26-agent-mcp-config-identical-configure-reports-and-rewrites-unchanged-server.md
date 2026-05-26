# Agent MCP config identical configure reports and rewrites unchanged server

## Summary

The exported `@poe-code/agent-mcp-config` `configure()` operation reports a successful mutation and rewrites a configuration file even when the requested MCP server definition is already present with identical values. A repeated idempotent configuration request is therefore surfaced as an update rather than a no-op.

## Reproduction

Create the following disposable probe at `packages/agent-mcp-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { configure } from "./apply.js";

describe("MCP configuration idempotency", () => {
  it("reports an identical existing server entry as changed", async () => {
    const fs = createMockFs({
      "~/.claude.json": JSON.stringify({
        mcpServers: {
          "poe-code": { command: "poe-code", args: ["mcp"] }
        }
      }, null, 2) + "\n"
    }, "/home/test");
    const onComplete = vi.fn();

    await configure(
      "claude-code",
      {
        name: "poe-code",
        config: { transport: "stdio", command: "poe-code", args: ["mcp"] }
      },
      {
        fs,
        homeDir: "/home/test",
        platform: "linux",
        observers: { onComplete }
      }
    );

    expect(JSON.parse(fs.getContent("/home/test/.claude.json")!)).toEqual({
      mcpServers: { "poe-code": { command: "poe-code", args: ["mcp"] } }
    });
    expect(onComplete.mock.calls.map(([, outcome]) => outcome.changed)).toEqual([false, true]);
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
✓ packages/agent-mcp-config/src/__probe__.test.ts > MCP configuration idempotency > reports an identical existing server entry as changed
```

## Observed Behavior

The initial Claude configuration already contains the same `poe-code` server requested by the second `configure()` call, yet the operation invokes its completion observer with outcomes `[false, true]`: the directory ensure step is a no-op, while the configuration transform is reported as changed. In `packages/agent-mcp-config/src/apply.ts:185`, the JSON/TOML path always returns `changed: true` from its server-entry transform after rebuilding the map, without comparing the shaped server value to the existing entry. `applyConfigTransform()` in `packages/config-mutations/src/execution/apply-mutation.ts:568` trusts that changed flag and writes serialized output at `packages/config-mutations/src/execution/apply-mutation.ts:594`, reporting an update even when the parsed configuration is semantically unchanged.

## Expected Behavior

Configuring a server entry with the same already-persisted definition should be idempotent: the operation should return or report a no-op and avoid rewriting the configuration file unless the requested configuration actually differs.

## Impact

Repeated setup, repair, login refresh, or automation runs can generate spurious configuration writes and progress/audit events despite making no effective change. This unnecessarily changes file timestamps, creates noisy dry-run or verbose output, can trigger file watchers and reloads, and increases exposure to write-failure or concurrency hazards during otherwise harmless idempotent operations.
