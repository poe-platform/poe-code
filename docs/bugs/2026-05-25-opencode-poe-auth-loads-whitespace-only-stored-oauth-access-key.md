# OpenCode Poe auth loads whitespace-only stored OAuth access key

## Summary

`opencode-poe-auth` accepts a persisted OAuth auth record whose `access` credential contains only whitespace and returns it to OpenCode as a successful `apiKey`. The plugin validates only the OAuth expiry timestamp before loading the stored access value, so a corrupted or otherwise invalid stored OAuth credential bypasses authentication validation even when it has no usable key content.

## Reproduction

Create a disposable Vitest probe at `packages/opencode-poe-auth/src/__probe__.test.ts`:

```ts
import type { Hooks } from "@opencode-ai/plugin";
import { describe, expect, it } from "vitest";
import PoeAuthPlugin from "./poe-auth-plugin.js";

type AuthHook = NonNullable<Hooks["auth"]>;

describe("PoeAuthPlugin stored OAuth key validation", () => {
  it("loads a whitespace-only stored OAuth access key", async () => {
    const hooks = await PoeAuthPlugin({} as never);
    const loader = (hooks.auth as AuthHook).loader!;

    const loaded = await loader(
      async () => ({
        type: "oauth",
        access: "   ",
        refresh: "   ",
        expires: Date.now() + 60_000
      }),
      {} as never
    );

    expect(loaded).toEqual({ apiKey: "   " });
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run --config packages/opencode-poe-auth/vitest.config.ts packages/opencode-poe-auth/src/__probe__.test.ts --reporter verbose
rm packages/opencode-poe-auth/src/__probe__.test.ts
```

Result:

```text
✓ packages/opencode-poe-auth/src/__probe__.test.ts > PoeAuthPlugin stored OAuth key validation > loads a whitespace-only stored OAuth access key
```

## Observed Behavior

`PoeAuthPlugin()` retrieves a stored auth record and handles the OAuth variant in `packages/opencode-poe-auth/src/poe-auth-plugin.ts:54` through `packages/opencode-poe-auth/src/poe-auth-plugin.ts:69`. After checking only whether `auth.expires < Date.now()`, it immediately returns `{ apiKey: auth.access }`. In the probe, the stored OAuth record has a future expiration but `access: "   "`, and the loader resolves successfully with that whitespace-only credential.

This is a separate persistence/load boundary from the previously retained `docs/bugs/2026-05-24-poe-oauth-accepts-whitespace-only-api-key-token-response.md`, which concerns accepting invalid data while exchanging a token endpoint response, and from `docs/bugs/2026-05-24-opencode-poe-auth-loads-whitespace-only-manual-api-key.md`, which concerns the plugin's manual `type: "api"` credential path. Here an existing stored `type: "oauth"` record is treated as valid solely because its timestamp is not expired.

## Expected Behavior

The OpenCode authentication loader should validate that a stored OAuth access credential is a non-empty, non-whitespace API key before returning it. A malformed persisted OAuth record should cause reauthentication or a clear local credential error rather than successful loading.

## Impact

Corrupted storage, manual edits, migrations, or invalid previously persisted OAuth records can leave OpenCode apparently authenticated with a blank Poe credential. Subsequent requests fail downstream as authorization errors instead of the plugin identifying unusable local authentication state and directing the user to log in again.
