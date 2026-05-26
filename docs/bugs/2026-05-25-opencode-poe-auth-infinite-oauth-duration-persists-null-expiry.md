# OpenCode Poe auth infinite OAuth duration persists null expiry

## Summary

The exported `opencode-poe-auth` OAuth callback accepts an OAuth response whose `expiresIn` value is `Infinity` and constructs an authentication result with `expires: Infinity`. When OpenCode persists that returned credential through ordinary JSON serialization, the expiration timestamp becomes `null`, so runtime and stored credential state disagree.

## Reproduction

Create a disposable Vitest probe at `packages/opencode-poe-auth/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createOAuthClient } from "poe-oauth";
import PoeAuthPlugin from "./poe-auth-plugin.js";

vi.mock("open", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("poe-oauth", () => ({ createOAuthClient: vi.fn() }));

describe("OpenCode OAuth infinite expiry duration", () => {
  it("returns Infinity that JSON persistence turns into null", async () => {
    vi.mocked(createOAuthClient).mockReturnValue({
      authorize: vi.fn(async () => ({
        authorizationUrl: "https://poe.com/oauth/authorize?client_id=test",
        waitForResult: vi.fn(async () => ({ apiKey: "sk-poe", expiresIn: Infinity }))
      }))
    });
    const hooks = await PoeAuthPlugin({} as never);
    const method = hooks.auth!.methods.find((entry) => entry.type === "oauth")!;
    if (method.type !== "oauth") throw new Error("Expected oauth");
    const grant = await method.authorize();
    if (grant.method !== "auto") throw new Error("Expected auto");
    const auth = await grant.callback();

    expect(auth).toMatchObject({ expires: Infinity });
    expect(JSON.parse(JSON.stringify(auth))).toMatchObject({ expires: null });
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/opencode-poe-auth/src/__probe__.test.ts --reporter verbose
rm -f packages/opencode-poe-auth/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/opencode-poe-auth/src/__probe__.test.ts > OpenCode OAuth infinite expiry duration > returns Infinity that JSON persistence turns into null
```

## Observed Behavior

The plugin callback resolves a success credential whose expiration is `Infinity`; serializing that credential through JSON produces the same credential with `"expires": null`.

`packages/opencode-poe-auth/src/poe-auth-plugin.ts:11` through `packages/opencode-poe-auth/src/poe-auth-plugin.ts:17` implement `getExpiry()` by treating only `null`/`undefined` specially and otherwise returning `Date.now() + expiresIn * 1000`. An infinite OAuth duration therefore remains `Infinity`. The browser-login callback exposes that value as the returned `expires` field at `packages/opencode-poe-auth/src/poe-auth-plugin.ts:37` through `packages/opencode-poe-auth/src/poe-auth-plugin.ts:46`, where JSON-backed credential persistence serializes non-finite numeric fields as `null`.

## Expected Behavior

OAuth response durations should be required to be finite valid values or deliberately mapped to a stable non-expiring representation before the plugin returns persistence-ready auth data. A returned credential should retain the same expiry meaning when serialized and loaded later.

## Impact

A malformed or unexpected OAuth server response can produce persisted OpenCode authentication with an expiry value different from the plugin's immediate result. Follow-up auth loading can misclassify expiration state or behave inconsistently across process restarts, leaving users with unreliable login validity and confusing reauthentication behavior.
