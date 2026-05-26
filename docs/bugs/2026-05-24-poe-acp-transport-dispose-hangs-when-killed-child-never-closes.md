# Poe ACP transport dispose hangs when killed child never closes

## Summary

`AcpTransport.dispose()` kills a still-running ACP child process and resolves its `closed` promise only when a later process `close` event arrives. If the child accepts the kill request but hangs or ignores termination, `transport.closed` never resolves; `AcpClient.dispose()` awaits that same promise and also hangs indefinitely.

## Reproduction

From the repository root, run a disposable Vitest probe with a fake child process whose `kill()` reports success but does not emit `close` until manually released:

```sh
cat > /tmp/poe-acp-transport-dispose-hang-probe.test.ts <<'EOF'
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { AcpTransport } from "./acp-transport.js";
import { AcpClient } from "./acp-client.js";
function childThatIgnoresKill() {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn(() => true);
  return child;
}
describe("ACP transport disposal", () => {
  it("leaves transport.closed and client.dispose pending when killed child never closes", async () => {
    const child = childThatIgnoresKill();
    const transport = new AcpTransport({ command: "agent", spawn: () => child });
    const client = new AcpClient({ transport });
    let transportSettled = false;
    let clientSettled = false;
    transport.closed.then(() => { transportSettled = true; });
    const disposed = client.dispose().then(() => { clientSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    console.log(JSON.stringify({ killCalls: child.kill.mock.calls.length, transportSettled, clientSettled }));
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(transportSettled).toBe(false);
    expect(clientSettled).toBe(false);
    child.emit("close", null, "SIGTERM");
    await disposed;
  });
});
EOF
cp /tmp/poe-acp-transport-dispose-hang-probe.test.ts packages/poe-acp-client/src/__probe__.test.ts
trap 'rm -f packages/poe-acp-client/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-poe-acp-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/poe-acp-client/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-poe-acp-probe.config.mjs --reporter verbose
nl -ba packages/poe-acp-client/src/acp-transport.ts | sed -n '125,147p;294,331p'
nl -ba packages/poe-acp-client/src/acp-client.ts | sed -n '603,625p'
```

## Observed Behavior

After `client.dispose()` invokes the child's successful `kill()`, neither the transport close promise nor client disposal promise settles until the probe manually emits `close`:

```text
{"killCalls":1,"transportSettled":false,"clientSettled":false}
✓ packages/poe-acp-client/src/__probe__.test.ts > ACP transport disposal > leaves transport.closed and client.dispose pending when killed child never closes
```

`AcpTransport` exposes its `closed` promise in `packages/poe-acp-client/src/acp-transport.ts:125` through `packages/poe-acp-client/src/acp-transport.ts:147`. During disposal, it calls `child.kill()` and returns without closing when the kill call returns true in `packages/poe-acp-client/src/acp-transport.ts:294` through `packages/poe-acp-client/src/acp-transport.ts:315`; only a later close path resolves the promise in `packages/poe-acp-client/src/acp-transport.ts:317` through `packages/poe-acp-client/src/acp-transport.ts:331`. `AcpClient.dispose()` awaits that promise in `packages/poe-acp-client/src/acp-client.ts:603` through `packages/poe-acp-client/src/acp-client.ts:625`.

## Expected Behavior

Disposal should have a bounded termination strategy: after requesting shutdown, it should escalate or settle with a clear timeout/failure rather than waiting forever for a non-cooperative ACP child process.

## Impact

Applications cancelling or shutting down ACP sessions can hang permanently when an agent process fails to terminate after a kill request. This can block CLI exit, orchestration cleanup, test teardown, and any higher-level cancellation flow awaiting client disposal.
