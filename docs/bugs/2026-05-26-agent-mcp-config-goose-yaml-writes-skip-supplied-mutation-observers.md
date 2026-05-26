# Agent MCP config Goose YAML writes skip supplied mutation observers

## Summary

The exported `@poe-code/agent-mcp-config` `configure()` API accepts mutation observers for reporting configuration work, and JSON/TOML-backed agents invoke them through the shared mutation executor. The Goose YAML branch writes a successful MCP configuration without invoking any supplied `onStart`, `onComplete`, or `onError` observer, so identical public API options behave silently for that supported agent.

## Reproduction

Create the following disposable probe at `packages/agent-mcp-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { configure } from "./apply.js";

describe("goose MCP mutation observers", () => {
  it("writes YAML configuration without reporting the mutation to observers", async () => {
    const fs = createMockFs();
    const onStart = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    await configure(
      "goose",
      {
        name: "poe-code",
        config: { transport: "stdio", command: "poe-code", args: ["mcp"] }
      },
      {
        fs,
        homeDir: "/home/test",
        platform: "linux",
        observers: { onStart, onComplete, onError }
      }
    );

    expect(fs.getContent("/home/test/.config/goose/config.yaml")).toContain("poe-code");
    expect(onStart).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
```

Run the probe and delete it immediately afterward:

```sh
npm exec -- vitest run packages/agent-mcp-config/src/__probe__.test.ts --reporter verbose
rm packages/agent-mcp-config/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/agent-mcp-config/src/__probe__.test.ts > goose MCP mutation observers > writes YAML configuration without reporting the mutation to observers
```

## Observed Behavior

`ApplyOptions` publicly exposes `observers?: MutationObservers` in `packages/agent-mcp-config/src/types.ts:27`. For JSON and TOML configurations, `configure()` forwards `options.observers` into `runMutations()` in `packages/agent-mcp-config/src/apply.ts:177`, and that executor invokes `onStart`, `onComplete`, and `onError` around each mutation in `packages/config-mutations/src/execution/run-mutations.ts:41`. For Goose, `configure()` instead takes the YAML-specific branch at `packages/agent-mcp-config/src/apply.ts:163`, then calls `writeYamlConfig()` directly at `packages/agent-mcp-config/src/apply.ts:171`; that writer only creates the directory and writes the file at `packages/agent-mcp-config/src/apply.ts:101` without consulting `options.observers`. The reproduction therefore persists a new Goose extension while every supplied observer records zero calls.

## Expected Behavior

The public `configure()` operation should report Goose YAML configuration activity through the supplied mutation observer hooks with behavior consistent with its JSON and TOML agent paths, including successful writes and failures, or the API should explicitly reject observer support for that path instead of silently ignoring it.

## Impact

Callers use mutation observers for previews, progress logs, auditing, and failure reporting. A supported Goose MCP update can modify configuration without emitting the operation events that the same API emits for other agents, leaving dry-run or verbose UI detail incomplete and causing audit integrations to miss successful or failed YAML-backed configuration work.
