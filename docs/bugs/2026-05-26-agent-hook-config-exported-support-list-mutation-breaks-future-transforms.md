# Agent hook config exported support list mutation breaks future transforms

## Summary

The public `@poe-code/agent-hook-config` API exports `supportedHookAgents` as a read-only array type, but the runtime value remains a mutable process-global array. A caller that inspects this advertised capability list can append an unconfigured agent ID, after which an ordinary supported `transformHooks("claude-code", "codex", ...)` operation throws `Unknown hook agent "unexpected-agent"` while building its handler rules.

## Reproduction

Create a disposable probe at `packages/agent-hook-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { supportedHookAgents, transformHooks } from "./index.js";

describe("agent-hook-config exported support list mutation", () => {
  it("lets a public metadata reader break later supported hook transforms", () => {
    const mutableAgents = supportedHookAgents as string[];
    mutableAgents.push("unexpected-agent");

    try {
      expect(() =>
        transformHooks(
          [
            {
              event: "Stop",
              handler: { type: "command", command: "echo ok" }
            }
          ],
          "claude-code",
          "codex",
          { runId: "probe" }
        )
      ).toThrow('Unknown hook agent "unexpected-agent"');
    } finally {
      mutableAgents.pop();
    }
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-hook-config/src/__probe__.test.ts
```

The probe passes, confirming that the injected capability-list entry breaks a later transformation involving only built-in supported agents:

```text
✓ packages/agent-hook-config/src/__probe__.test.ts > agent-hook-config exported support list mutation > lets a public metadata reader break later supported hook transforms
```

## Observed Behavior

`supportedHookAgents` is created from `Object.keys(agentHookConfigs)` and exported directly at `packages/agent-hook-config/src/configs.ts:97` and `packages/agent-hook-config/src/index.ts:17` through `packages/agent-hook-config/src/index.ts:22`. Although its TypeScript type is `readonly string[]`, the actual array can be mutated at runtime. `getHandlerTypeRules()` iterates that same exported array and calls `requireAgentConfig()` for every entry at `packages/agent-hook-config/src/event-mapping.ts:33` through `packages/agent-hook-config/src/event-mapping.ts:79`. After `"unexpected-agent"` is appended, a valid Claude-to-Codex transformation fails before it can process its supported command hook.

## Expected Behavior

Public capability-list inspection must not expose mutable internal state that controls future hook transformation. `supportedHookAgents` should be immutable or defensively copied, and a caller reading supported IDs must not be able to make later built-in transformations fail.

## Impact

Any same-process consumer that reads exported hook support metadata can accidentally or deliberately deny hook bridging for all later calls. Valid supported transforms can fail with an unrelated unknown-agent error, preventing generated hooks from being installed for spawned agents and making behavior dependent on prior metadata inspection code.
