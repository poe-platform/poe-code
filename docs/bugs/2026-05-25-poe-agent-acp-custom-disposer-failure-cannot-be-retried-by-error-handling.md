# Poe agent ACP custom disposer failure cannot be retried by error handling

## Summary

`runAcpCore()` accepts a custom `disposeRun` cleanup callback, but wraps it with a local `disposed` flag that is set before the callback succeeds. When a normal completed run reaches disposal and that custom cleanup rejects transiently, the ACP error path calls cleanup again but the wrapper silently skips the retry.

## Reproduction

Create the disposable probe `packages/poe-agent/src/runtime/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runAcpCore, type AcpModel } from "./acp-core.js";
import { createRunContext } from "./run-context.js";
import type { AcpEvent, AcpHost } from "./types.js";

async function collect(events: AsyncIterable<AcpEvent>): Promise<AcpEvent[]> {
  const collected: AcpEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe("ACP custom disposer retry", () => {
  it("does not retry a transient custom disposal failure during error handling", async () => {
    const disposeRun = vi.fn()
      .mockRejectedValueOnce(new Error("cleanup temporarily failed"))
      .mockResolvedValueOnce(undefined);
    const model: AcpModel = {
      complete: async () => ({
        events: {
          async *[Symbol.asyncIterator]() {
            yield { type: "text", text: "done" } as const;
            yield { type: "stop", reason: "end_turn" } as const;
          },
        },
      }),
    };
    const host: AcpHost = {
      handle: vi.fn(),
      fork: vi.fn(),
      spawn: vi.fn(),
    };

    const events = await collect(runAcpCore({
      prompt: "finish",
      runContext: createRunContext(),
      host,
      model,
      disposeRun,
    }));

    expect(events.at(-1)?.type).toBe("session.error");
    expect(disposeRun).toHaveBeenCalledTimes(1);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-agent/src/runtime/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/poe-agent/src/runtime/__probe__.test.ts > ACP custom disposer retry > does not retry a transient custom disposal failure during error handling
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

ACP core builds its wrapper around the injected `options.disposeRun` and sets `disposed = true` before awaiting that callback at `packages/poe-agent/src/runtime/acp-core.ts:208` through `packages/poe-agent/src/runtime/acp-core.ts:217`. A successful model run first calls `await disposeRun()` on its completion path at `packages/poe-agent/src/runtime/acp-core.ts:269`; when this rejects, execution enters the error handler, which attempts `await disposeRun()` again at `packages/poe-agent/src/runtime/acp-core.ts:295` through `packages/poe-agent/src/runtime/acp-core.ts:301`. The retry is skipped because the flag is already set. In the probe, the custom disposer would succeed on a second call, but it is invoked only once and the run emits `session.error`.

## Expected Behavior

The ACP lifecycle should not mark a custom cleanup callback completed until it succeeds. If completion-path disposal fails and error handling explicitly retries disposal, the second attempt should invoke the caller-provided cleanup again or preserve a retriable failure state.

## Impact

Hosts that provide ACP-specific disposal for transports, child sessions, or external process resources cannot recover from transient cleanup failures even though ACP core enters a cleanup retry path. The run reports an error while required resources may remain alive, increasing leakage risk during normal successful task completion followed by temporary teardown failure.
