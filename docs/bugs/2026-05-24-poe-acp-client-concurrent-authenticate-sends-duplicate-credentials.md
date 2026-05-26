# Poe ACP client concurrent authenticate sends duplicate credentials

## Summary

After initialization reports an authentication method, `AcpClient.authenticate()` accepts authentication calls while state is `initialized` and moves to `ready` only after awaiting a successful response. Two concurrent calls with the same auth method therefore send two authentication requests before either completes, duplicating credential submission.

## Reproduction

From the repository root, run a disposable Vitest probe that holds both authentication replies pending after an initialization response requiring authentication:

```sh
cat > /tmp/poe-acp-client-concurrent-authenticate-probe.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "./acp-client.js";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
describe("authentication race", () => {
  it("sends two authenticate requests while the first is pending", async () => {
    const firstAuth = deferred<any>();
    const secondAuth = deferred<any>();
    let authCall = 0;
    const transport = {
      sendRequest: vi.fn((method: string) => {
        if (method === "initialize") {
          return Promise.resolve({ protocolVersion: 1, authMethods: [{ id: "token", name: "Token" }] });
        }
        authCall += 1;
        return authCall === 1 ? firstAuth.promise : secondAuth.promise;
      }),
      sendNotification: vi.fn(),
      onRequest: vi.fn(),
      onNotification: vi.fn()
    };
    const client = new AcpClient({ transport });
    await client.initialize();
    const first = client.authenticate("token");
    const second = client.authenticate("token");
    console.log(`authenticate_calls=${transport.sendRequest.mock.calls.filter(([method]) => method === "authenticate").length}`);
    firstAuth.resolve({});
    secondAuth.resolve({});
    await Promise.all([first, second]);
    expect(transport.sendRequest.mock.calls.map(([method]) => method)).toEqual(["initialize", "authenticate", "authenticate"]);
    expect(client.state).toBe("ready");
  });
});
EOF
cp /tmp/poe-acp-client-concurrent-authenticate-probe.test.ts packages/poe-acp-client/src/__probe__.test.ts
trap 'rm -f packages/poe-acp-client/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-poe-acp-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/poe-acp-client/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-poe-acp-probe.config.mjs --reporter verbose
nl -ba packages/poe-acp-client/src/acp-client.ts | sed -n '305,309p;413,445p'
```

## Observed Behavior

Two credential-bearing authentication requests are transmitted before either reply resolves:

```text
authenticate_calls=2
✓ packages/poe-acp-client/src/__probe__.test.ts > authentication race > sends two authenticate requests while the first is pending
```

Initialization leaves the lifecycle state at `initialized` when authentication is required in `packages/poe-acp-client/src/acp-client.ts:413` through `packages/poe-acp-client/src/acp-client.ts:414`. `authenticate()` checks that state and issues `sendRequest("authenticate", ...)` in `packages/poe-acp-client/src/acp-client.ts:426` through `packages/poe-acp-client/src/acp-client.ts:441`, but sets `lifecycleState = "ready"` only after awaiting the response in `packages/poe-acp-client/src/acp-client.ts:443`.

## Expected Behavior

An in-flight authentication attempt should reserve the authentication transition so additional calls reject or await the existing attempt instead of transmitting credentials again.

## Impact

Parallel clients, retries, or accidental double invocation can submit authentication material multiple times, potentially consuming one-time authentication tokens, triggering lockout/rate-limit behavior, or producing conflicting session authorization state.
