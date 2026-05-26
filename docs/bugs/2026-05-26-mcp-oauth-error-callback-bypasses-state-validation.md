# MCP OAuth error callback bypasses state validation

## Summary

The public `@poe-code/mcp-oauth` loopback authorization session validates `state` for successful callback codes, but accepts any callback carrying an OAuth `error` parameter before checking the expected state. An unsolicited local request such as `?error=access_denied` can therefore abort a pending state-protected authorization flow without possessing its state value.

## Reproduction

Create a disposable Vitest probe at `packages/mcp-oauth/src/__probe__.test.ts`:

```ts
import http from "node:http";
import { describe, expect, it } from "vitest";
import { createLoopbackAuthorizationSession } from "./index.js";

async function request(url: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    http.get(url, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 500));
    }).on("error", reject);
  });
}

describe("OAuth error callback state binding", () => {
  it("lets an unsolicited error callback reject a state-protected pending authorization", async () => {
    const session = await createLoopbackAuthorizationSession();
    const pending = session.waitForCode("https://auth.example.test/authorize?state=expected-state");
    const rejected = expect(pending).rejects.toThrow(
      "OAuth authorization failed: access_denied — forged"
    );

    try {
      const status = await request(`${session.redirectUri}?error=access_denied&error_description=forged`);
      expect(status).toBe(400);
      await rejected;
    } finally {
      session.close();
    }
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/mcp-oauth/src/__probe__.test.ts --reporter verbose
rm -f packages/mcp-oauth/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/mcp-oauth/src/__probe__.test.ts > OAuth error callback state binding > lets an unsolicited error callback reject a state-protected pending authorization
```

## Observed Behavior

A pending authorization created with an expected `state=expected-state` is rejected with `OAuth authorization failed: access_denied — forged` after an HTTP request to the loopback redirect URI containing only `error=access_denied&error_description=forged`. The rejecting callback supplies no `state` parameter at all.

`packages/mcp-oauth/src/index.ts:7` through `packages/mcp-oauth/src/index.ts:11` publicly export `createLoopbackAuthorizationSession()`. In `packages/mcp-oauth/src/client/loopback-authorization.ts:60` through `packages/mcp-oauth/src/client/loopback-authorization.ts:85`, the request handler reads `error` first and immediately rejects the pending authorization when it is present. The callback validator at `packages/mcp-oauth/src/client/loopback-authorization.ts:153` through `packages/mcp-oauth/src/client/loopback-authorization.ts:188`, which checks expected state and issuer binding, is called only in the non-error branch at `packages/mcp-oauth/src/client/loopback-authorization.ts:87` through `packages/mcp-oauth/src/client/loopback-authorization.ts:100`.

## Expected Behavior

OAuth error responses received through the loopback callback should be bound to the pending authorization request with the same state validation applied to successful authorization responses. A callback that omits or mismatches an expected state should be rejected as invalid input without settling the legitimate authorization attempt.

## Impact

Any local process or browser navigation able to reach the loopback redirect listener can cancel an in-progress OAuth login without knowing its state token. This enables denial of authentication flows and can make legitimate approvals appear to be authorization-server denials, reducing the state parameter's intended request-binding protection.
