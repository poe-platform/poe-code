# Agent script spawn retry launches new attempt after abort during backoff

## Summary

The `agent` host module in `@poe-code/agent-script` exposes `spawn.retry()` with a `signal` option, but its retry implementation does not observe that signal while waiting between attempts. If cancellation arrives during backoff after a failed attempt, the helper waits out the timer and launches another agent invocation with an already-aborted signal instead of stopping promptly.

## Reproduction

From the repository root, run this disposable Vitest probe. It aborts the caller's signal during retry backoff and observes that a second spawn is still issued afterward:

```sh
cat > packages/agent-script/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { makeAgentModule } from "./modules/agent.js";

describe("agent script retry cancellation", () => {
  it("starts another agent attempt after the spawn signal is aborted during backoff", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const spawnAgent = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "retry", summary: "", durationMs: 1 })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "ok", stderr: "", summary: "done", durationMs: 1 });
    const agent = makeAgentModule(spawnAgent);

    const resultPromise = agent.spawn.retry(
      "codex",
      { prompt: "work", signal: controller.signal },
      { maxAttempts: 2, backoffMs: 1000 }
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    console.log(JSON.stringify({ aborted: controller.signal.aborted, calls: spawnAgent.mock.calls.length, exitCode: result.exitCode }));
    expect({ aborted: controller.signal.aborted, calls: spawnAgent.mock.calls.length, exitCode: result.exitCode }).toEqual({
      aborted: true,
      calls: 2,
      exitCode: 0
    });
    vi.useRealTimers();
  });
});
EOF
trap 'rm -f packages/agent-script/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/agent-script/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Cancellation is already final before the backoff expires, but the module performs another agent attempt and reports its success:

```text
{"aborted":true,"calls":2,"exitCode":0}
✓ packages/agent-script/src/__probe__.test.ts > agent script retry cancellation > starts another agent attempt after the spawn signal is aborted during backoff
```

`AgentModuleSpawnOptions` exposes `signal?: AbortSignal` in `packages/agent-script/src/modules/agent.ts:34`, and `resolveSpawnInput()` retains it in the request passed to the injected spawner at `packages/agent-script/src/modules/agent.ts:321`. However, `spawn.retry()` delegates to local `runSpawnRetry()` at `packages/agent-script/src/modules/agent.ts:185`; that loop neither checks `input.signal.aborted` before subsequent attempts nor passes it into its plain `setTimeout`-based `sleep()` at `packages/agent-script/src/modules/agent.ts:250`. By contrast, the shared `@poe-code/agent-spawn` retry implementation explicitly checks and listens to its signal during backoff in `packages/agent-spawn/src/retry.ts:91` and `packages/agent-spawn/src/retry.ts:166`.

## Expected Behavior

`agent.spawn.retry()` should stop when its supplied abort signal becomes aborted, including while it is waiting between attempts. It should reject with an abort error and must not start any new spawn after cancellation has been requested.

## Impact

Cancelled harness runs can launch additional agent work after callers have timed out, aborted a workflow, or begun teardown. The extra invocation may spend model/tool resources, make edits, or report apparent success after the controlling operation has already been cancelled, undermining predictable cancellation and cleanup.
