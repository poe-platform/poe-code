# Poe ACP client concurrent initialize sends duplicate handshakes

## Summary

`AcpClient.initialize()` is documented and guarded as a one-time lifecycle operation, but the guard checks only `lifecycleState` before awaiting the transport response. Because state remains `uninitialized` while the first initialize request is pending, a second concurrent call sends another `initialize` JSON-RPC request and both calls resolve successfully.

## Reproduction

From the repository root, run a disposable Vitest probe with a transport that leaves two initialization responses pending until both requests have been observed:

```sh
cat > /tmp/poe-acp-client-concurrent-initialize-probe.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "./acp-client.js";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
describe("initialize race", () => {
  it("sends two initialize requests while the first is pending", async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    let call = 0;
    const transport = {
      sendRequest: vi.fn(() => (++call === 1 ? first.promise : second.promise)),
      sendNotification: vi.fn(),
      onRequest: vi.fn(),
      onNotification: vi.fn()
    };
    const client = new AcpClient({ transport });
    const firstInit = client.initialize();
    const secondInit = client.initialize();
    console.log(`initialize_calls=${transport.sendRequest.mock.calls.length}`);
    first.resolve({ protocolVersion: 1 });
    second.resolve({ protocolVersion: 1 });
    await Promise.all([firstInit, secondInit]);
    expect(transport.sendRequest.mock.calls.map(([method]) => method)).toEqual(["initialize", "initialize"]);
    expect(client.state).toBe("ready");
  });
});
EOF
cp /tmp/poe-acp-client-concurrent-initialize-probe.test.ts packages/poe-acp-client/src/__probe__.test.ts
trap 'rm -f packages/poe-acp-client/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-poe-acp-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/poe-acp-client/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-poe-acp-probe.config.mjs --reporter verbose
nl -ba packages/poe-acp-client/src/acp-client.ts | sed -n '305,309p;387,424p'
```

## Observed Behavior

Both concurrent calls transmit initialization handshakes and resolve:

```text
initialize_calls=2
✓ packages/poe-acp-client/src/__probe__.test.ts > initialize race > sends two initialize requests while the first is pending
```

The one-time guard checks `lifecycleState` in `packages/poe-acp-client/src/acp-client.ts:387` through `packages/poe-acp-client/src/acp-client.ts:390`, but the state declared in `packages/poe-acp-client/src/acp-client.ts:305` is not updated until after `await this.transport.sendRequest("initialize", ...)` completes in `packages/poe-acp-client/src/acp-client.ts:397` through `packages/poe-acp-client/src/acp-client.ts:414`.

## Expected Behavior

The first in-flight `initialize()` call should reserve the lifecycle transition immediately so any concurrent second invocation rejects with the one-time initialization error without emitting another protocol handshake.

## Impact

Concurrent setup code can send duplicate ACP initialization requests to an agent that expects exactly one handshake. The duplicate requests can initialize inconsistent capabilities, trigger server protocol failures, or leave client and agent lifecycle state out of sync.
