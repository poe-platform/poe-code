# OpenCode Poe auth negative OAuth duration returns expired success

## Summary

The exported `opencode-poe-auth` OAuth callback converts any numeric `expiresIn` returned from `poe-oauth` into an absolute expiry and returns a successful OpenCode credential. When the OAuth result contains a negative lifetime, the plugin emits `type: "success"` for a credential whose `expires` timestamp is already in the past.

## Reproduction

Create a disposable Vitest probe at `packages/opencode-poe-auth/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createOAuthClient } from "poe-oauth";

vi.mock("poe-oauth", () => ({ createOAuthClient: vi.fn() }));

import { PoeAuthPlugin } from "./poe-auth-plugin.js";

describe("OpenCode negative OAuth expiry duration", () => {
  it("does not return an already expired credential as successful login", async () => {
    vi.mocked(createOAuthClient).mockReturnValue({
      authorize: vi.fn(async () => ({
        authorizationUrl: "https://poe.example/authorize",
        waitForResult: vi.fn(async () => ({ apiKey: "sk-poe", expiresIn: -60 }))
      }))
    });
    const before = Date.now();
    const hooks = await PoeAuthPlugin({} as never);
    const method = hooks.auth!.methods.find((candidate) => candidate.type === "oauth")!;
    if (method.type !== "oauth") throw new Error("Expected OAuth method");
    const authorization = await method.authorize();
    const result = await authorization.callback();
    console.log(JSON.stringify({ result, before, expired: result.type === "success" && result.expires < before }));
    expect(result.type).not.toBe("success");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/opencode-poe-auth/src/__probe__.test.ts --reporter verbose
rm -f packages/opencode-poe-auth/src/__probe__.test.ts
```

The adapter announces success while returning a timestamp already sixty seconds expired:

```text
{"result":{"type":"success","access":"sk-poe","refresh":"sk-poe","expires":1779749407582},"before":1779749467582,"expired":true}
AssertionError: expected 'success' not to be 'success'
```

## Observed Behavior

`authorize()` in `packages/opencode-poe-auth/src/poe-auth-plugin.ts` awaits the OAuth result and returns a success auth record unconditionally. Its `getExpiry()` helper treats only `null` as special; all other values are converted with `Date.now() + expiresIn * 1000`. For `expiresIn: -60`, the returned `expires` value is already earlier than the time at which the success credential is created. Although the plugin loader later rejects expired persisted OAuth records, the login callback itself reports successful authentication with immediately unusable state.

## Expected Behavior

The OpenCode auth adapter should not publish a successful login result whose expiration timestamp is already past. It should reject invalid negative lifetimes received from its OAuth dependency, or otherwise prevent an expired credential from entering OpenCode's persistence and success flow.

## Impact

An unexpected or malformed OAuth result can make the browser-login UI report a successful Poe connection while saving a credential that is invalid at creation time. The next authenticated operation or reload fails with an expiry error, creating contradictory login state and avoidable reauthentication failures.
