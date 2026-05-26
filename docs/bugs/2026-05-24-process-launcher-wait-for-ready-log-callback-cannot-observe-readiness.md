# Process launcher waitForReady log callback cannot observe readiness

## Summary

The exported `waitForReady()` API types its `onLog` option as an ordinary log callback, but `log-pattern` readiness silently requires that function object also implement a private `subscribe()` method. Supplying a normal callback and invoking it with a matching readiness line never resolves readiness successfully; the operation times out and returns `false` even though the callback observed the required line.

## Reproduction

From the repository root, call the exported readiness helper with an ordinary callback function and then deliver its matching log line:

```sh
cat > /tmp/process-launcher-waitforready-log-callback-cannot-satisfy-probe.mjs <<'EOF'
import { waitForReady } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const observed = [];
const onLog = (line, stream) => observed.push(`${stream}:${line}`);
const resultPromise = waitForReady({ kind: "log-pattern", pattern: "READY" }, { onLog, timeoutMs: 5 });
onLog("READY", "stdout");
console.log("result=" + await resultPromise);
console.log("observed=" + JSON.stringify(observed));
EOF

node /tmp/process-launcher-waitforready-log-callback-cannot-satisfy-probe.mjs

nl -ba packages/process-launcher/src/health/health-check.ts | sed -n '9,67p'
nl -ba packages/process-launcher/src/types.ts | sed -n '13,15p'
```

## Observed Behavior

The callback receives the matching readiness line, but `waitForReady()` returns failure:

```text
result=false
observed=["stdout:READY"]
```

`packages/process-launcher/src/health/health-check.ts:9` through `packages/process-launcher/src/health/health-check.ts:15` publicly describe `onLog` as a function callback. For log-pattern checks, `packages/process-launcher/src/health/health-check.ts:24` through `packages/process-launcher/src/health/health-check.ts:67` cast it to an internal `SubscribableLog` and only react to calls routed through optional `subscribe()`. A caller using the exported type cannot satisfy readiness by invoking its callback normally.

## Expected Behavior

The public readiness API should expose a usable log-input contract: either an explicit subscribable/event source type or a direct method for feeding lines. A caller that supplies the documented callback-shaped option should not silently time out after observing a matching line.

## Impact

External consumers of the exported helper cannot implement log-pattern readiness using its declared API and may diagnose healthy services as unready. The functionality works only through an undisclosed internal function augmentation used by `createSupervisor()`.
