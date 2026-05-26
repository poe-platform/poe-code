# OpenCode Poe auth accepts OAuth credential with nonnumeric expiry

## Summary

`opencode-poe-auth` loads an OAuth credential as valid when its persisted `expires` value is a nonnumeric string. Malformed persisted expiration metadata bypasses the plugin's expiry check, so OpenCode receives the stored Poe API key instead of rejecting the invalid credential and requiring authentication again.

## Reproduction

From the repository root, run this isolated passing probe with a string `expires` value that can arrive from malformed persisted JSON:

```sh
cat > /tmp/opencode-poe-auth-invalid-expiry-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import type { Hooks } from "@opencode-ai/plugin";
import PoeAuthPlugin from "./poe-auth-plugin.js";

type AuthHook = NonNullable<Hooks["auth"]>;

describe("PoeAuthPlugin invalid oauth expiry metadata", () => {
  it("loads an oauth key whose persisted expiry is not numeric", async () => {
    const hooks = await PoeAuthPlugin({} as never);
    const loader = (hooks.auth as AuthHook).loader!;
    const outcome = await loader(async () => ({
      type: "oauth",
      access: "sk-invalid-expiry",
      refresh: "sk-invalid-expiry",
      expires: "not-a-timestamp" as unknown as number
    }), {} as never).then(
      (value) => ({ resolved: value }),
      (error: unknown) => ({ rejected: error instanceof Error ? error.message : String(error) })
    );
    console.log(JSON.stringify({ outcome }));
    expect(outcome).toEqual({ resolved: { apiKey: "sk-invalid-expiry" } });
  });
});
EOF
cp /tmp/opencode-poe-auth-invalid-expiry-probe.test.ts packages/opencode-poe-auth/src/__probe__.test.ts
trap 'rm -f packages/opencode-poe-auth/src/__probe__.test.ts /tmp/opencode-poe-auth-invalid-expiry-probe.test.ts' EXIT
./node_modules/.bin/vitest run --config packages/opencode-poe-auth/vitest.config.ts packages/opencode-poe-auth/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The loader resolves successfully with the OAuth API key although its expiration metadata is not a numeric timestamp:

```text
{"outcome":{"resolved":{"apiKey":"sk-invalid-expiry"}}}
✓ packages/opencode-poe-auth/src/__probe__.test.ts > PoeAuthPlugin invalid oauth expiry metadata > loads an oauth key whose persisted expiry is not numeric
```

`packages/opencode-poe-auth/src/poe-auth-plugin.ts:65` compares `auth.expires < Date.now()`. JavaScript coerces `"not-a-timestamp"` to `NaN` for that comparison, and the result is false, allowing the credential through to `return { apiKey: auth.access }` at `packages/opencode-poe-auth/src/poe-auth-plugin.ts:69`.

## Expected Behavior

The plugin should reject OAuth auth entries whose persisted expiration value is not a valid numeric timestamp, rather than loading an API key whose freshness cannot be established.

## Impact

Corrupted or manually edited OpenCode auth state can bypass expiration enforcement and cause OpenCode to continue sending an unvalidated stored Poe key. This delays recovery to a later request failure and prevents the plugin from prompting for a fresh sign-in when the credential record is already invalid.
