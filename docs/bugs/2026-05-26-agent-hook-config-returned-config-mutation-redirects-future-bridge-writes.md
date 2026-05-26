# Agent hook config returned config mutation redirects future bridge writes

## Summary

`@poe-code/agent-hook-config` returns its internal mutable `AgentHookConfig` objects through the public `getAgentConfig()` API. A caller that mutates the returned Codex config can alter where a later, unrelated `bridgeHooks()` operation writes generated project hooks. Mutating `localHookPath` from `.codex/hooks.json` to `.redirected/hooks.json` causes a normal Claude-to-Codex transform bridge to skip the documented Codex hook file and write into the attacker-selected project-relative path instead.

## Reproduction

Create a disposable Vitest probe at `packages/agent-hook-config/src/__probe__.test.ts`:

```ts
import * as fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { bridgeHooks, getAgentConfig } = await import("./index.js");

describe("agent-hook-config returned config mutation", () => {
  beforeEach(() => {
    vol.reset();
    vol.fromJSON({
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "notify" }] }] }
      })
    }, "/");
  });

  it("does not allow callers to redirect later bridge output", () => {
    const exposed = getAgentConfig("codex")!;
    const original = exposed.localHookPath;

    try {
      exposed.localHookPath = ".redirected/hooks.json";
      bridgeHooks("claude-code", "codex", "/repo", "/home/user", "run-1", {
        strategy: "transform",
        scope: "project"
      });

      expect(fs.existsSync("/repo/.codex/hooks.json")).toBe(true);
    } finally {
      exposed.localHookPath = original;
    }
  });
});
```

Run and remove the probe:

```sh
npm exec -- vitest run packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-hook-config/src/__probe__.test.ts
```

## Observed Behavior

The probe fails because no hook file is created at the normal Codex target after mutating the returned config object:

```text
FAIL  packages/agent-hook-config/src/__probe__.test.ts > agent-hook-config returned config mutation > does not allow callers to redirect later bridge output
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ packages/agent-hook-config/src/__probe__.test.ts:33:56
```

`agentHookConfigs` stores the live Codex object containing `localHookPath: ".codex/hooks.json"` at `packages/agent-hook-config/src/configs.ts:49` through `:95`. `resolveAgentSupport()` returns that same object as `config` at `packages/agent-hook-config/src/configs.ts:108` through `:123`, and `getAgentConfig()` forwards it directly at `packages/agent-hook-config/src/configs.ts:125` through `:128`. Later, `bridgeHooks()` obtains that mutated config through `requireSupport()` and computes its write destination through `resolveHookPath()` in `requireTargetPath()` at `packages/agent-hook-config/src/bridge-hooks.ts:97` through `:118` and `:158` through `:169`.

## Expected Behavior

Public configuration inspection must not expose mutable internal registry state that controls future bridge operations. `getAgentConfig()` and support-resolution results should return immutable or defensively copied configuration data so caller mutations cannot redirect where later generated hook files are written.

## Impact

A library consumer, plugin, or test that only intends to inspect supported hook configuration can silently poison process-global state for all later hook bridging in the same runtime. Generated hooks may be placed in unexpected project paths, leaving Codex unconfigured at its expected location and potentially overwriting an unrelated file chosen through the mutated path.
