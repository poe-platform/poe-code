# Agent Maestro negative polling interval creates hot timer loop

## Summary

`agent-maestro` accepts a negative `polling.interval_ms` workflow setting and passes it directly to Node's `setInterval()`. Node treats a negative interval as a minimal-delay timer, so a malformed workflow can turn normal periodic polling into an approximately millisecond-frequency loop.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/agent-maestro/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config/schema.js";

describe("negative polling interval", () => {
  it("accepts a negative interval that runs approximately every millisecond", async () => {
    const cfg = resolveConfig({
      states: { ready: { prompt: "Do it" }, done: { terminal: true } },
      polling: { interval_ms: -1 },
    }, "/repo");
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, cfg.polling.intervalMs);
    await new Promise((resolve) => setTimeout(resolve, 25));
    clearInterval(timer);
    console.log(JSON.stringify({ intervalMs: cfg.polling.intervalMs, ticks }));
    expect(cfg.polling.intervalMs).toBe(-1);
    expect(ticks).toBeGreaterThanOrEqual(5);
  });
});
PROBE
npm exec -- vitest run packages/agent-maestro/src/__probe__.test.ts --reporter verbose
rm packages/agent-maestro/src/__probe__.test.ts
```

Output:

```text
{"intervalMs":-1,"ticks":19}
✓ packages/agent-maestro/src/__probe__.test.ts > negative polling interval > accepts a negative interval that runs approximately every millisecond
```

## Observed Behavior

The configuration resolver preserves `-1` because `readNumber()` at `packages/agent-maestro/src/config/schema.ts:236` through `packages/agent-maestro/src/config/schema.ts:238` accepts any finite number. `runMaestro()` supplies `cfg.polling.intervalMs` directly to `setInterval()` at `packages/agent-maestro/src/index.ts:168` through `packages/agent-maestro/src/index.ts:170`. In the reproduction, the resulting negative-delay timer fires nineteen times in roughly twenty-five milliseconds.

## Expected Behavior

Polling intervals should require a positive, reasonable duration before a workflow starts. Negative or zero-like scheduling settings should be rejected with a configuration error rather than silently becoming minimal-delay timer activity.

## Impact

A typo or untrusted workflow configuration can make Maestro continuously perform reconciliation, validation, and task-query work at near-hot-loop frequency. This can waste CPU and I/O, amplify backend/API traffic, and interfere with other work even when no task needs dispatch.
