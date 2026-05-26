# MCP OAuth pasted denial URL reports missing code

## Summary

The public `@poe-code/mcp-oauth` loopback authorization session supports a manual `readLine()` fallback for users to paste a redirect URL, but that path ignores OAuth `error` and `error_description` callback parameters. Pasting a valid denial redirect such as `?error=access_denied&error_description=User%20declined` rejects as `OAuth callback missing authorization code` instead of reporting the actual authorization refusal.

## Reproduction

Create a disposable Vitest probe at `packages/mcp-oauth/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createLoopbackAuthorizationSession } from "./index.js";

describe("OAuth pasted denial URL", () => {
  it("reports a pasted authorization error URL as missing a code", async () => {
    const session = await createLoopbackAuthorizationSession({
      readLine: async () =>
        "http://127.0.0.1/callback?error=access_denied&error_description=User%20declined"
    });

    try {
      await expect(session.waitForCode("https://auth.example.test/authorize"))
        .rejects.toThrow("OAuth callback missing authorization code");
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
✓ packages/mcp-oauth/src/__probe__.test.ts > OAuth pasted denial URL > reports a pasted authorization error URL as missing a code
```

## Observed Behavior

When `readLine()` yields a redirect URL containing `error=access_denied&error_description=User%20declined`, `waitForCode()` rejects with `OAuth callback missing authorization code`. It does not report either the denial code or the provided human-readable description.

`packages/mcp-oauth/src/index.ts:8` through `packages/mcp-oauth/src/index.ts:12` publicly export `createLoopbackAuthorizationSession()`. The HTTP callback branch explicitly detects OAuth error responses and reports them at `packages/mcp-oauth/src/client/loopback-authorization.ts:78` through `packages/mcp-oauth/src/client/loopback-authorization.ts:84`. The manual-input branch at `packages/mcp-oauth/src/client/loopback-authorization.ts:104` through `packages/mcp-oauth/src/client/loopback-authorization.ts:121` instead passes only `code`, `state`, and `iss` into `validateAuthorizationCallbackParameters()`; `extractCallbackParametersFromInput()` at `packages/mcp-oauth/src/client/loopback-authorization.ts:136` through `packages/mcp-oauth/src/client/loopback-authorization.ts:157` does not retain OAuth error fields from the pasted URL. Because the pasted denial has no `code`, it is misclassified as a malformed callback.

## Expected Behavior

Manual pasted redirect URLs should preserve and surface OAuth denial responses with the same meaningful error behavior as browser-delivered callbacks, while applying appropriate state binding. A valid denial result must not be transformed into a missing-code parsing error merely because it arrived through the supported input fallback.

## Impact

When browser callback delivery fails or users deliberately paste the redirect URL, legitimate authorization denials become misleading parsing failures. Users and automation cannot distinguish an explicit refusal from a malformed paste or broken authorization server response, complicating diagnosis and obscuring human authorization outcomes.
