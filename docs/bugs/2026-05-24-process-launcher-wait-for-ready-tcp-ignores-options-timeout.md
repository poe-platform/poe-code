# Process launcher waitForReady TCP checks ignore the options timeout

## Summary

The exported `waitForReady()` API accepts `options.timeoutMs` for readiness operations, and log-pattern checks honor it. For TCP checks, the helper discards `options.timeoutMs` and reads timeout only from the `ReadyCheck` object itself. A caller using the shared options timeout gets a 30-second TCP wait instead of the requested bound unless it happens to duplicate timeout configuration inside the TCP check.

## Reproduction

From the repository root, attempt a TCP readiness check against a closed local port while providing a 5 ms operation timeout only through the public options object:

```sh
cat > /tmp/process-launcher-waitforready-tcp-options-timeout-ignored-probe.mjs <<'EOF'
import { waitForReady } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const controller = new AbortController();
const startedAt = Date.now();
const readiness = waitForReady(
  { kind: "tcp", host: "127.0.0.1", port: 1 },
  { signal: controller.signal, timeoutMs: 5 }
);
const result = await Promise.race([
  readiness.then((ready) => `resolved:${ready}:${Date.now() - startedAt}`),
  new Promise((resolve) => setTimeout(() => resolve(`pending:${Date.now() - startedAt}`), 30))
]);
controller.abort();
await readiness;
console.log("result=" + result);
EOF

node /tmp/process-launcher-waitforready-tcp-options-timeout-ignored-probe.mjs

nl -ba packages/process-launcher/src/health/health-check.ts | sed -n '9,116p'
nl -ba packages/process-launcher/src/types.ts | sed -n '13,15p'
```

## Observed Behavior

The TCP readiness promise is still pending well after the requested 5 ms timeout; the probe must abort it explicitly after observing that it exceeded 30 ms:

```text
result=pending:34
```

`packages/process-launcher/src/health/health-check.ts:9` through `packages/process-launcher/src/health/health-check.ts:21` accept `options.timeoutMs` uniformly and pass the complete options only to log checks. The TCP path calls `waitForTcp(check, options.signal)` and `packages/process-launcher/src/health/health-check.ts:69` through `packages/process-launcher/src/health/health-check.ts:78` derive the deadline solely from `check.timeoutMs`, ignoring the operation timeout option.

## Expected Behavior

The exported readiness timeout option should consistently bound both readiness mechanisms, or the API should not expose it as a general option. A TCP caller requesting a short timeout should not silently receive the default 30-second wait.

## Impact

Libraries and orchestration code using `waitForReady()` can hang far longer than configured during TCP startup failure. This delays error recovery, shutdown, and failover while the analogous log-pattern check obeys the same supplied option.
