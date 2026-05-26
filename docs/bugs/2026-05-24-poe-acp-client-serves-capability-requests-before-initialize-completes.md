# Poe ACP client serves capability requests before initialize completes

## Summary

When `initialize(clientCapabilities)` is called, `AcpClient` registers filesystem and terminal request handlers before its initialization request resolves. A peer can therefore invoke advertised client capabilities while the client still reports `uninitialized`, and those handlers remain installed even when the initialize handshake later rejects.

## Reproduction

From the repository root, run a disposable Vitest probe that captures registered filesystem handlers while initialization is pending and after it fails:

```sh
cat > /tmp/poe-acp-client-premature-capability-handler-probe.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "./acp-client.js";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
describe("premature client handlers", () => {
  it("serves filesystem reads before initialize resolves", async () => {
    const init = deferred<any>();
    const handlers = new Map<string, any>();
    const readTextFile = vi.fn(async () => "secret-before-ready");
    const transport = {
      sendRequest: vi.fn(() => init.promise),
      sendNotification: vi.fn(),
      onRequest: vi.fn((method: string, handler: any) => handlers.set(method, handler)),
      onNotification: vi.fn()
    };
    const client = new AcpClient({ transport, fsHandler: { readTextFile } });
    const initializing = client.initialize({ fs: { readTextFile: true } });
    const result = await handlers.get("fs/read_text_file")({ sessionId: "s-early", path: "/secret.txt" });
    console.log(JSON.stringify({ state: client.state, result, reads: readTextFile.mock.calls }));
    expect(client.state).toBe("uninitialized");
    expect(result).toEqual({ content: "secret-before-ready" });
    init.resolve({ protocolVersion: 1 });
    await initializing;
  });

  it("keeps filesystem handlers active after initialize rejects", async () => {
    const handlers = new Map<string, any>();
    const readTextFile = vi.fn(async () => "secret-after-fail");
    const transport = {
      sendRequest: vi.fn(() => Promise.reject(new Error("handshake rejected"))),
      sendNotification: vi.fn(),
      onRequest: vi.fn((method: string, handler: any) => handlers.set(method, handler)),
      onNotification: vi.fn()
    };
    const client = new AcpClient({ transport, fsHandler: { readTextFile } });
    await expect(client.initialize({ fs: { readTextFile: true } })).rejects.toThrow("handshake rejected");
    const result = await handlers.get("fs/read_text_file")({ sessionId: "s-failed", path: "/secret.txt" });
    console.log(JSON.stringify({ state: client.state, result, reads: readTextFile.mock.calls }));
    expect(client.state).toBe("uninitialized");
    expect(result).toEqual({ content: "secret-after-fail" });
  });
});
EOF
cp /tmp/poe-acp-client-premature-capability-handler-probe.test.ts packages/poe-acp-client/src/__probe__.test.ts
trap 'rm -f packages/poe-acp-client/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-poe-acp-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/poe-acp-client/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-poe-acp-probe.config.mjs --reporter verbose
nl -ba packages/poe-acp-client/src/acp-client.ts | sed -n '356,360p;387,424p;639,684p'
```

## Observed Behavior

The filesystem callback executes while initialization is still pending, and it remains callable after an initialization rejection:

```text
{"state":"uninitialized","result":{"content":"secret-before-ready"},"reads":[[{"sessionId":"s-early","path":"/secret.txt"}]]}
{"state":"uninitialized","result":{"content":"secret-after-fail"},"reads":[[{"sessionId":"s-failed","path":"/secret.txt"}]]}
```

The constructor initially registers handlers for configured capabilities in `packages/poe-acp-client/src/acp-client.ts:356` through `packages/poe-acp-client/src/acp-client.ts:360`. More importantly, `initialize(clientCapabilities)` stores and registers newly supplied capability handlers before awaiting the handshake in `packages/poe-acp-client/src/acp-client.ts:387` through `packages/poe-acp-client/src/acp-client.ts:401`. The filesystem read and write callbacks are active immediately once registered in `packages/poe-acp-client/src/acp-client.ts:639` through `packages/poe-acp-client/src/acp-client.ts:684`, without any lifecycle-state check.

## Expected Behavior

Client capability handlers should not serve agent requests until initialization has completed successfully and the advertised capabilities have been negotiated. A rejected handshake should leave no active capability surface on that failed client connection.

## Impact

A peer can read or write host files, or invoke analogous terminal callbacks, before the ACP connection is established or after setup has failed. This allows privileged client-side capability access outside the intended negotiated session lifecycle.
