# Poe OAuth accepts whitespace-only API key token response

## Summary

The exported `poe-oauth` client validates token responses by requiring `api_key` to be a string whose raw length is nonzero. A successful token response containing only spaces therefore resolves as an authenticated OAuth result, even though the returned bearer credential is blank after ordinary normalization and cannot identify an account.

## Reproduction

From the repository root, run a disposable Vitest probe that completes a loopback authorization exchange with a whitespace-only key:

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

describe("poe OAuth API-key validation", () => {
  it("accepts a whitespace-only API key from the token endpoint", async () => {
    const loopback = createServer();
    const client = createOAuthClient({
      clientId: "probe",
      createServer: () => loopback.server,
      openBrowser: async () => loopback.callback("/callback?code=ok"),
      fetch: vi.fn(async () => new Response(JSON.stringify({ api_key: "   ", api_key_expires_in: 3600 }), { status: 200 })) as any
    });
    const authorization = await client.authorize();
    const result = await authorization.waitForResult();
    console.log(JSON.stringify({ apiKey: result.apiKey, blank: result.apiKey.trim().length === 0 }));
    expect(result).toEqual({ apiKey: "   ", expiresIn: 3600 });
  });
});
EOF
trap 'rm -f packages/poe-oauth/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/poe-oauth/src/__probe__.test.ts --reporter verbose
nl -ba packages/poe-oauth/src/oauth-client.ts | sed -n '136,155p'
nl -ba packages/poe-oauth/README.md | sed -n '5,24p'
```

## Observed Behavior

The authorization flow succeeds and returns a credential that consists entirely of spaces:

```text
{"apiKey":"   ","blank":true}
✓ packages/poe-oauth/src/__probe__.test.ts > poe OAuth API-key validation > accepts a whitespace-only API key from the token endpoint
```

The README represents `waitForResult()` as returning the API key obtained through the OAuth flow in `packages/poe-oauth/README.md:5`. `exchangeCodeForApiKey()` only rejects an empty raw string at `packages/poe-oauth/src/oauth-client.ts:144`; it neither trims nor otherwise validates that the token response contains a usable credential before returning it as `apiKey`.

## Expected Behavior

A token response should be considered successful only when it supplies a nonblank API key. Whitespace-only values should be rejected as a malformed response rather than returned as an authenticated OAuth result.

## Impact

Malformed or compromised token endpoints can make login appear successful while persisting an unusable bearer value. Downstream commands subsequently fail authentication using a key that the OAuth layer already accepted, producing confusing login loops and false successful-connection states.
