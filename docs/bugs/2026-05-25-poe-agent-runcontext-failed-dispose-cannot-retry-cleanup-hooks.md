# Poe agent RunContext failed dispose cannot retry cleanup hooks

## Summary

The exported Poe agent runtime `RunContext.dispose()` method marks a context disposed and discards all registered cleanup hooks even when one of those hooks rejects. A transient cleanup failure therefore rejects the first disposal attempt but makes every later `dispose()` call return successfully without retrying the failed hook. Runtime resources owned by a failed plugin or child-session cleanup can remain active with no recovery path through the context that owns them.

## Reproduction

Create a disposable Vitest probe with one dispose hook that rejects once and would succeed on retry:

```sh
cat > packages/poe-agent/src/runtime/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { createRunContext } from "./run-context.js";

describe("RunContext failed dispose retry", () => {
  it("never retries a dispose hook that failed once", async () => {
    const cleanup = vi.fn()
      .mockRejectedValueOnce(new Error("cleanup temporarily failed"))
      .mockResolvedValueOnce(undefined);
    const runContext = createRunContext();
    runContext.registerDisposeHook(cleanup);

    await expect(runContext.dispose()).rejects.toThrow("RunContext disposal failed.");
    await expect(runContext.dispose()).resolves.toBeUndefined();

    expect(cleanup).toHaveBeenCalledOnce();
  });
});
EOF
trap 'rm -f packages/poe-agent/src/runtime/__probe__.test.ts' EXIT
npm exec -- vitest run packages/poe-agent/src/runtime/__probe__.test.ts --reporter verbose
nl -ba packages/poe-agent/src/runtime/run-context.ts | sed -n '83,128p'
```

The probe passes and logs the initial hook failure:

```text
Dispose hook failed. Error: cleanup temporarily failed
✓ packages/poe-agent/src/runtime/__probe__.test.ts > RunContext failed dispose retry > never retries a dispose hook that failed once
```

## Observed Behavior

`dispose()` calls `#disposeInternal()` and awaits it at `packages/poe-agent/src/runtime/run-context.ts:83` through `packages/poe-agent/src/runtime/run-context.ts:96`. Its `finally` block then unconditionally sets `#disposed = true` and clears `#disposeHooks` at `packages/poe-agent/src/runtime/run-context.ts:96` through `packages/poe-agent/src/runtime/run-context.ts:100`, even when `#disposeInternal()` throws the aggregated cleanup error at `packages/poe-agent/src/runtime/run-context.ts:104` through `packages/poe-agent/src/runtime/run-context.ts:127`. In the probe, the first call rejects after the hook failure; the second call returns immediately through the `#disposed` check and never invokes the now-successful cleanup retry.

## Expected Behavior

If disposal reports that a required cleanup hook failed, the context should retain enough failed-hook state for callers to retry cleanup, or explicitly expose partially disposed resources and their recovery mechanism. It should not discard cleanup ownership while presenting later disposal attempts as successful no-ops.

## Impact

Transient teardown failures in plugins, MCP resources, linked abort listeners, or child-run cleanup can leak runtime resources after an agent session ends. Callers that retry disposal receive success despite the unrecovered failure, obscuring the leak and potentially leaving open sessions, listeners, or external resources active beyond the intended run lifetime.
