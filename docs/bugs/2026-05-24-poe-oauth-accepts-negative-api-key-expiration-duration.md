# Poe OAuth accepts negative API-key expiration duration

## Summary

The exported `poe-oauth` client accepts any numeric `api_key_expires_in` value from a successful token response, including a negative duration. A token endpoint response representing an API key that was already expired before receipt is returned as a successful OAuth result instead of being rejected as invalid server data.

## Reproduction

From the repository root, run a disposable Vitest probe that completes a loopback authorization exchange with a negative lifetime in the token response:

```sh
cat > packages/poe-oauth/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { createOAuthClient } from "./oauth-client.js";

function createServer() {
  const listeners = new Map<string, (...args: any[]) => void>();
  const server = {
    listen(_port: number, _host: string, callback: () => void) { callback(); return server; },
    address() { return { port: 43123 }; },
    on(event: string, callback: (...args: any[]) => void) { listeners.set(event, callback); return server; },
    close() {},
  } as any;
  return { server, callback(path: string) { listeners.get("request")?.({ url: path }, { writeHead() {}, end() {} }); } };
}

describe("poe OAuth expiry validation", () => {
  it("accepts a negative API-key lifetime from the token endpoint", async () => {
    const loopback = createServer();
    const client = createOAuthClient({
      clientId: "probe",
      createServer: () => loopback.server,
      openBrowser: async () => loopback.callback("/callback?code=ok"),
      fetch: vi.fn(async () => new Response(JSON.stringify({ api_key: "sk-probe", api_key_expires_in: -60 }), { status: 200 })) as any
    });
    const authorization = await client.authorize();
    const result = await authorization.waitForResult();
    console.log(JSON.stringify(result));
    expect(result).toEqual({ apiKey: "sk-probe", expiresIn: -60 });
  });
});
EOF
trap 'rm -f packages/poe-oauth/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/poe-oauth/src/__probe__.test.ts --reporter verbose
nl -ba packages/poe-oauth/src/oauth-client.ts | sed -n '119,156p'
nl -ba packages/poe-oauth/README.md | sed -n '5,27p'
```

## Observed Behavior

The OAuth flow resolves successfully with a negative expiration duration:

```text
{"apiKey":"sk-probe","expiresIn":-60}
✓ packages/poe-oauth/src/__probe__.test.ts > poe OAuth expiry validation > accepts a negative API-key lifetime from the token endpoint
```

The README presents `waitForResult()` as returning an issued API key and its expiration information in `packages/poe-oauth/README.md:5`. After a successful token response, `exchangeCodeForApiKey()` validates that `api_key` is a nonempty string but treats every numeric `api_key_expires_in` as valid in `packages/poe-oauth/src/oauth-client.ts:145`, without rejecting negative, non-finite, or otherwise unusable lifetimes.

## Expected Behavior

A successful OAuth result should not expose a newly issued API key with a negative time-to-expiry. The client should reject invalid negative lifetime values from the token endpoint, or normalize only valid non-negative expiration durations into its result contract.

## Impact

Malformed, incompatible, or compromised token endpoints can cause login to appear successful while returning credentials that callers immediately consider expired or persist with nonsensical lifetime metadata. Downstream integrations may save unusable credentials, enter repeated login loops, or report contradictory authentication state immediately after authorization.
