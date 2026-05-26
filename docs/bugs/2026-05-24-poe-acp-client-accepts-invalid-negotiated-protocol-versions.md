# Poe ACP client accepts invalid negotiated protocol versions

## Summary

`AcpClient.initialize()` trusts the agent's `protocolVersion` response and computes `Math.min(clientVersion, response.protocolVersion)` without runtime validation. A malformed string response produces `NaN`, and a negative numeric response produces a negative negotiated version; in both cases the client enters `ready` state and reports initialization success.

## Reproduction

From the repository root, run a disposable Vitest probe that supplies malformed initialization responses through an injected transport:

```sh
cat > /tmp/poe-acp-client-malformed-initialize-probe.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "./acp-client.js";
function transportFor(result: unknown) {
  return {
    sendRequest: vi.fn(async () => result),
    sendNotification: vi.fn(),
    onRequest: vi.fn(),
    onNotification: vi.fn()
  };
}
describe("malformed initialization", () => {
  it("enters ready state with NaN negotiated version from malformed server response", async () => {
    const client = new AcpClient({ transport: transportFor({ protocolVersion: "not-a-version" }) as any, protocolVersion: 1 });
    const response = await client.initialize();
    console.log(JSON.stringify({ state: client.state, negotiated: String(client.negotiatedProtocolVersion), response: String(response.protocolVersion) }));
    expect(client.state).toBe("ready");
    expect(Number.isNaN(client.negotiatedProtocolVersion)).toBe(true);
  });
  it("enters ready state with negative negotiated version from server response", async () => {
    const client = new AcpClient({ transport: transportFor({ protocolVersion: -7 }) as any, protocolVersion: 1 });
    const response = await client.initialize();
    console.log(JSON.stringify({ state: client.state, negotiated: client.negotiatedProtocolVersion, response: response.protocolVersion }));
    expect(client.state).toBe("ready");
    expect(client.negotiatedProtocolVersion).toBe(-7);
  });
});
EOF
cp /tmp/poe-acp-client-malformed-initialize-probe.test.ts packages/poe-acp-client/src/__probe__.test.ts
trap 'rm -f packages/poe-acp-client/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-poe-acp-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/poe-acp-client/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-poe-acp-probe.config.mjs --reporter verbose
nl -ba packages/poe-acp-client/src/acp-client.ts | sed -n '387,424p'
nl -ba packages/poe-acp-client/src/types.ts | sed -n '301,301p;488,498p'
```

## Observed Behavior

The client reports successful readiness with invalid negotiated version values:

```text
{"state":"ready","negotiated":"NaN","response":"NaN"}
{"state":"ready","negotiated":-7,"response":-7}
```

`ProtocolVersion` is only a TypeScript numeric alias in `packages/poe-acp-client/src/types.ts:301` and `packages/poe-acp-client/src/types.ts:488` through `packages/poe-acp-client/src/types.ts:498`. At runtime, `initialize()` directly applies `Math.min(...)` to the response version in `packages/poe-acp-client/src/acp-client.ts:397` through `packages/poe-acp-client/src/acp-client.ts:406`, stores it, and enters `ready` state in `packages/poe-acp-client/src/acp-client.ts:408` through `packages/poe-acp-client/src/acp-client.ts:423` without checking finite integer/version validity.

## Expected Behavior

The client should reject initialization responses whose protocol version is missing, non-numeric, non-finite, negative, or otherwise unsupported, and it should not enter ready state after an invalid handshake.

## Impact

Malformed or hostile ACP agents can make clients proceed in an impossible protocol state. Subsequent behavior is no longer reliably versioned, and callers receive a successful ready client instead of an actionable negotiation failure.
