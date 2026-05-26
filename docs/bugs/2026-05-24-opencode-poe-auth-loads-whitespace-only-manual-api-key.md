# OpenCode Poe auth loads whitespace-only manual API key

## Summary

`opencode-poe-auth` advertises manual Poe API-key entry, but its auth loader forwards manually stored credentials without validating that the key contains a non-whitespace value. A stored manual credential of only spaces is treated as successful authentication and passed to OpenCode as `apiKey`.

## Reproduction

From the repository root, run this disposable Vitest probe that invokes the plugin's public auth loader with the shape produced for manual API-key credentials:

```sh
cat > packages/opencode-poe-auth/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import type { Hooks } from "@opencode-ai/plugin";
import PoeAuthPlugin from "./poe-auth-plugin.js";

type AuthHook = NonNullable<Hooks["auth"]>;

describe("PoeAuthPlugin manual API-key validation", () => {
  it("loads a whitespace-only manually stored API key", async () => {
    const hooks = await PoeAuthPlugin({} as never);
    const loader = (hooks.auth as AuthHook).loader!;
    const loaded = await loader(async () => ({ type: "api", key: "   " }), {} as never);
    console.log(JSON.stringify({ apiKey: loaded.apiKey, blank: loaded.apiKey?.trim() === "" }));
    expect(loaded).toEqual({ apiKey: "   " });
  });
});
EOF
trap 'rm -f packages/opencode-poe-auth/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run --config packages/opencode-poe-auth/vitest.config.ts packages/opencode-poe-auth/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The loader resolves with a credential that has no usable API-key content:

```text
{"apiKey":"   ","blank":true}
✓ packages/opencode-poe-auth/src/__probe__.test.ts > PoeAuthPlugin manual API-key validation > loads a whitespace-only manually stored API key
```

The package exposes a `Manually enter API Key` method at `packages/opencode-poe-auth/src/poe-auth-plugin.ts:71`. When OpenCode later loads an `api` auth record, the implementation immediately returns `{ apiKey: auth.key }` at `packages/opencode-poe-auth/src/poe-auth-plugin.ts:54` without trimming or rejecting empty input. This is separate from the OAuth token-response validation failure because it occurs on the plugin's manual credential storage/load path and does not involve `poe-oauth`.

## Expected Behavior

Manual API-key credentials should be validated before they are returned to OpenCode. Empty or whitespace-only stored keys should be rejected with an authentication error requiring the user to enter a usable Poe API key again.

## Impact

Users can complete or retain a manual OpenCode authentication state that is unusable from the outset. OpenCode then issues Poe requests with a blank credential and reports downstream authorization failures instead of catching the invalid local credential at load time and prompting for correction.
