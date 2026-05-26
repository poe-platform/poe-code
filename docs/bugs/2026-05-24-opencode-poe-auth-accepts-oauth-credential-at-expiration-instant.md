# OpenCode Poe auth accepts OAuth credential at expiration instant

## Summary

`opencode-poe-auth` loads an OAuth credential as valid when its `expires` timestamp is exactly equal to the current time. A credential is no longer valid at its expiration instant, so the plugin can hand OpenCode a Poe API key that has already expired instead of requiring reauthentication.

## Reproduction

From the repository root, run a disposable Vitest probe with `Date.now()` pinned to the stored OAuth credential's exact expiry timestamp:

```sh
cat > /tmp/opencode-poe-auth-expiry-boundary-probe.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import type { Hooks } from "@opencode-ai/plugin";
import PoeAuthPlugin from "./poe-auth-plugin.js";

type AuthHook = NonNullable<Hooks["auth"]>;

describe("PoeAuthPlugin expiry boundary", () => {
  it("loads an oauth key whose expiry timestamp is exactly now", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const hooks = await PoeAuthPlugin({} as never);
    const loader = (hooks.auth as AuthHook).loader!;
    const outcome = await loader(async () => ({
      type: "oauth",
      access: "sk-expired-now",
      refresh: "sk-expired-now",
      expires: 1_700_000_000_000
    }), {} as never).then(
      (value) => ({ resolved: value }),
      (error: unknown) => ({ rejected: error instanceof Error ? error.message : String(error) })
    );
    console.log(JSON.stringify({ outcome }));
    expect(outcome).toEqual({ resolved: { apiKey: "sk-expired-now" } });
  });
});
EOF
cp /tmp/opencode-poe-auth-expiry-boundary-probe.test.ts packages/opencode-poe-auth/src/__probe__.test.ts
trap 'rm -f packages/opencode-poe-auth/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run --config packages/opencode-poe-auth/vitest.config.ts packages/opencode-poe-auth/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The loader resolves successfully with an API key even though the current time equals the persisted expiration timestamp:

```text
{"outcome":{"resolved":{"apiKey":"sk-expired-now"}}}
✓ packages/opencode-poe-auth/src/__probe__.test.ts > PoeAuthPlugin expiry boundary > loads an oauth key whose expiry timestamp is exactly now
```

`packages/opencode-poe-auth/src/poe-auth-plugin.ts:65` through `packages/opencode-poe-auth/src/poe-auth-plugin.ts:69` reject an OAuth credential only when `auth.expires < Date.now()`, allowing the exact-expiry boundary through.

## Expected Behavior

An OAuth credential whose expiration timestamp is less than or equal to the current time should be treated as expired and should trigger the plugin's login-again error path.

## Impact

At the token-expiry boundary, OpenCode receives a credential that is already expired and can immediately issue a failing request. This creates avoidable authentication failures instead of prompting the user to sign in again before attempting API work.
