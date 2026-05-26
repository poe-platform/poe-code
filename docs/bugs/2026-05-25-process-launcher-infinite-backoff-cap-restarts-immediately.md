# Process launcher infinite backoff cap restarts immediately

## Summary

The exported `@poe-code/process-launcher` supervisor accepts `backoffMs: Number.POSITIVE_INFINITY` together with `maxBackoffMs: Number.POSITIVE_INFINITY`. Rather than preserving an unbounded restart delay or rejecting invalid timing configuration, a crashed process is relaunched almost immediately because the computed `Infinity` delay is handed to Node's timer implementation.

## Reproduction

Create a disposable Vitest probe at `packages/process-launcher/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimulation } from "./testing/simulation.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("process-launcher infinite capped restart backoff", () => {
  it("restarts immediately instead of preserving an infinite delay", async () => {
    vi.useFakeTimers();
    const simulation = createSimulation(
      {
        id: "process",
        command: "npm",
        args: ["run", "dev"],
        restart: "on-failure",
        maxRestarts: 1,
        backoffMs: Number.POSITIVE_INFINITY,
        maxBackoffMs: Number.POSITIVE_INFINITY
      },
      [
        { pid: 301, exitCode: 1, exitAfterMs: 1 },
        { pid: 302, exitCode: 0, exitAfterMs: 10_000 }
      ]
    );

    await simulation.supervisor.start();
    await vi.advanceTimersByTimeAsync(2);

    expect(simulation.execCalls).toHaveLength(2);
    expect(simulation.supervisor.getState()).toMatchObject({
      pid: 302,
      restartCount: 1,
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

After the initial process fails at one millisecond, the replacement process has already started by two milliseconds despite both restart-delay values being infinite:

```text
✓ packages/process-launcher/src/__probe__.test.ts > process-launcher infinite capped restart backoff > restarts immediately instead of preserving an infinite delay
```

The passing assertions observe:

```json
{"execCalls":2,"state":{"pid":302,"restartCount":1,"status":"running"}}
```

`ProcessSpec` in `packages/process-launcher/src/types.ts` exposes `backoffMs?: number` and `maxBackoffMs?: number` without finite-duration validation. In `packages/process-launcher/src/supervisor/supervisor.ts`, `getBackoffDelay()` evaluates `Math.min(Infinity * 2 ** restartCount, Infinity)` as `Infinity`, and `monitorExit()` then passes that value to `delay()`. Node does not schedule `setTimeout(..., Infinity)` as an unlimited delay; the overflowed timer executes immediately, allowing `launch(true)` to start the replacement process right away.

## Expected Behavior

Supervisor configuration should reject non-finite restart backoff durations before launching managed processes, or explicitly implement a defined unlimited-wait behavior. An infinite backoff request must not silently become an immediate restart.

## Impact

Misconfigured or deserialized process specifications can reverse intended restart throttling: an operator attempting to prevent automatic relaunches by setting an effectively unbounded backoff instead receives rapid recovery attempts. Crashing services can consume resources, churn logs and process state, and repeatedly execute startup side effects contrary to their configured retry timing policy.
