# Process launcher NaN max restarts disables crash ceiling

## Summary

The exported `@poe-code/process-launcher` supervisor accepts `maxRestarts: Number.NaN` in a process specification. Instead of rejecting the invalid restart budget, the supervisor treats its configured ceiling as never reached and continues relaunching a repeatedly crashing process.

## Reproduction

Create a disposable Vitest probe at `packages/process-launcher/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimulation } from "./testing/simulation.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("process-launcher non-finite restart cap", () => {
  it("keeps restarting after repeated crashes when maxRestarts is NaN", async () => {
    vi.useFakeTimers();
    const simulation = createSimulation(
      {
        id: "process",
        command: "npm",
        args: ["run", "dev"],
        restart: "on-failure",
        maxRestarts: Number.NaN,
        backoffMs: 0
      },
      [
        { pid: 301, exitCode: 1, exitAfterMs: 1 },
        { pid: 302, exitCode: 1, exitAfterMs: 1 },
        { pid: 303, exitCode: 1, exitAfterMs: 1 },
        { pid: 304, exitCode: 0, exitAfterMs: 10_000 }
      ]
    );

    await simulation.supervisor.start();
    await vi.advanceTimersByTimeAsync(20);

    expect(simulation.execCalls).toHaveLength(4);
    expect(simulation.supervisor.getState()).toMatchObject({
      pid: 304,
      restartCount: 3,
      status: "running"
    });
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/process-launcher/src/__probe__.test.ts --reporter verbose
rm -f packages/process-launcher/src/__probe__.test.ts
```

## Observed Behavior

The process crashes three times and is launched a fourth time even though a supplied restart ceiling should be a bounded numeric policy:

```text
✓ packages/process-launcher/src/__probe__.test.ts > process-launcher non-finite restart cap > keeps restarting after repeated crashes when maxRestarts is NaN
```

The passing assertion observes a live fourth run after three restarts:

```json
{"execCalls":4,"state":{"pid":304,"restartCount":3,"status":"running"}}
```

`ProcessSpec` in `packages/process-launcher/src/types.ts` exposes `maxRestarts?: number` without a validation contract. In `packages/process-launcher/src/supervisor/supervisor.ts`, `monitorExit()` computes `const maxRestarts = spec.maxRestarts ?? 5` and stops relaunching only when `maxRestarts > 0 && state.restartCount >= maxRestarts`. Both comparisons are false for `Number.NaN`, so the supervisor skips the crash transition on every failed process and proceeds through log rotation, restart state, delay, and `launch(true)` repeatedly.

## Expected Behavior

Supervisor construction or startup should reject non-finite restart budgets before launching any managed process. `maxRestarts` must be a finite non-negative integer whose configured limit reliably bounds automatic relaunches.

## Impact

An SDK caller or deserialized process specification containing `NaN` can silently disable a configured restart safety boundary. A permanently crashing service may then be restarted indefinitely, repeatedly consuming CPU, spawning processes, rotating logs, and writing state instead of transitioning to a stable crashed condition for operator intervention.
