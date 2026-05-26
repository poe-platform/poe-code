# Agent maestro exported state machine mutation admits invalid tick transition

## Summary

The exported `@poe-code/agent-maestro` `maestroTaskStateMachine` object contains live mutable event definitions that are also used internally to validate `runMaestroTick()` inputs. Mutating the exported `complete.from` array causes a later tick request for the normally invalid transition `queued:done` to be accepted rather than rejected.

## Reproduction

Create a disposable probe at `packages/agent-maestro/src/__probe__.test.ts`:

```ts
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { maestroTaskStateMachine, runMaestroTick } from "./index.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

describe("agent-maestro exported tick transition mutation", () => {
  beforeEach(() => {
    vol.reset();
    vol.fromJSON({
      "/repo/WORKFLOW.md": [
        "---",
        "states:",
        "  queued:",
        "    prompt: Work",
        "  agent-running:",
        "    prompt: Continue",
        "  done:",
        "    terminal: true",
        "---",
        ""
      ].join("\n")
    });
  });

  it("admits a queued-to-done tick after mutating exported workflow metadata", async () => {
    const from = maestroTaskStateMachine.events.complete.from as string[];
    from.push("queued");

    try {
      await expect(
        runMaestroTick({
          configPath: "/repo/WORKFLOW.md",
          task: "maestro/one",
          transition: "queued:done"
        })
      ).resolves.toBeUndefined();
    } finally {
      from.pop();
    }
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/agent-maestro/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-maestro/src/__probe__.test.ts
```

The probe passes, confirming that a previously rejected Maestro tick transition becomes accepted after public metadata mutation:

```text
✓ packages/agent-maestro/src/__probe__.test.ts > agent-maestro exported tick transition mutation > admits a queued-to-done tick after mutating exported workflow metadata
```

## Observed Behavior

`maestroTaskStateMachine` is defined with ordinary nested arrays and objects at `packages/agent-maestro/src/state-machine.ts:13` through `packages/agent-maestro/src/state-machine.ts:24`, then publicly re-exported at `packages/agent-maestro/src/index.ts:472` through `packages/agent-maestro/src/index.ts:477`. `runMaestroTick()` parses and validates every non-trigger transition before emitting its event at `packages/agent-maestro/src/tick-command.ts:21` through `packages/agent-maestro/src/tick-command.ts:40`. That validation reads the same exported live event collection at `packages/agent-maestro/src/tick-command.ts:60` through `packages/agent-maestro/src/tick-command.ts:75`. The package's own test suite establishes that `queued:done` must be rejected, but after appending `"queued"` to `maestroTaskStateMachine.events.complete.from`, `runMaestroTick({ transition: "queued:done" })` resolves successfully.

## Expected Behavior

Reading public Maestro workflow metadata must not allow callers to alter the transition validation rules applied by future tick events. The exported state machine should be deeply immutable or the tick validator should operate on a private immutable definition, so `queued:done` remains invalid unless the workflow is explicitly configured through a supported customization path.

## Impact

Any same-process consumer that modifies exported Maestro workflow metadata can silently weaken validation for subsequent scheduler or CLI tick events. Invalid lifecycle notifications can be accepted as real progress, causing external orchestrators to observe impossible state transitions, bypass expected agent-running or review phases, and make workflow correctness dependent on unrelated code executed earlier in the process.
