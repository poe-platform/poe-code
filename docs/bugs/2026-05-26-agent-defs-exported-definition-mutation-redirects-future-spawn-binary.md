# Agent defs exported definition mutation redirects future spawn binary

## Summary

`@poe-code/agent-defs` exports each built-in `AgentDefinition` object directly, including the mutable `codexAgent` definition. A caller that reads that public metadata can mutate `codexAgent.binaryName`, and later `@poe-code/agent-spawn` argument construction uses the mutated value as the executable to launch. Changing `binaryName` from `"codex"` to `"unexpected-binary"` causes an ordinary future Codex spawn build to target the replacement binary.

## Reproduction

Create a disposable Vitest probe at `packages/agent-spawn/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codexAgent } from "@poe-code/agent-defs";
import { buildSpawnArgs } from "./spawn.js";

describe("agent-defs exported definition mutation", () => {
  it("does not let metadata readers redirect later spawned binaries", () => {
    const original = codexAgent.binaryName;

    try {
      codexAgent.binaryName = "unexpected-binary";

      expect(buildSpawnArgs("codex", { prompt: "hello" }).binaryName).toBe("codex");
    } finally {
      codexAgent.binaryName = original;
    }
  });
});
```

Run and remove the probe:

```sh
npm exec -- vitest run packages/agent-spawn/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-spawn/src/__probe__.test.ts
```

## Observed Behavior

The probe fails because downstream spawn construction uses the mutated executable name returned through public agent metadata:

```text
FAIL  packages/agent-spawn/src/__probe__.test.ts > agent-defs exported definition mutation > does not let metadata readers redirect later spawned binaries
AssertionError: expected 'unexpected-binary' to be 'codex' // Object.is equality

Expected: "codex"
Received: "unexpected-binary"

 ❯ packages/agent-spawn/src/__probe__.test.ts:12:71
```

`codexAgent` is exported as a mutable object at `packages/agent-defs/src/agents/codex.ts:3` through `:17` and re-exported publicly at `packages/agent-defs/src/index.ts:3` through `:12`. `agent-spawn` imports the exported `allAgents` objects, finds that same definition, and reads its live `binaryName` in `packages/agent-spawn/src/configs/resolve-config.ts:11` through `:25`; `buildSpawnArgs()` then returns that value as the binary to execute at `packages/agent-spawn/src/spawn.ts:174` through `:182`.

## Expected Behavior

Public agent metadata must not be mutable process-global execution configuration. Exported built-in definitions should be immutable or defensively copied, so inspecting or transforming an agent definition cannot change which executable later spawning code launches.

## Impact

Any in-process consumer that reads built-in agent metadata can accidentally or deliberately redirect later agent execution to another command. This is more severe than inconsistent enumeration: ordinary Codex spawn requests can invoke an unintended binary, changing behavior or executing a different program than the caller requested.
