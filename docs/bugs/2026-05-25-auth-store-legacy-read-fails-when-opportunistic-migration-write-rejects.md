# Auth store legacy read fails when opportunistic migration write rejects

## Summary

`auth-store`'s exported `MigratingSecretStore.get()` uses a readable legacy credential as fallback only after synchronously persisting it into the primary store. If that opportunistic migration write rejects, the read rejects even though the requested credential remains present and readable in the legacy store. A storage migration problem therefore turns an otherwise available secret lookup into an authentication outage.

## Reproduction

From the repository root, run a disposable Vitest probe whose primary store is readable but rejects writes while its legacy store still contains a valid credential:

```sh
cat > packages/auth-store/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { MigratingSecretStore } from "./provider-store.js";
import type { SecretStore } from "./types.js";

describe("legacy credential migration write failure repro", () => {
  it("rejects a usable legacy credential when primary persistence fails", async () => {
    const primary = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => { throw new Error("primary read-only"); }),
      delete: vi.fn(async () => undefined),
    } satisfies SecretStore;
    const legacy = {
      get: vi.fn(async () => "legacy-token"),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    } satisfies SecretStore;
    const store = new MigratingSecretStore(primary, legacy);

    await expect(store.get()).rejects.toThrow("primary read-only");
    console.log(JSON.stringify({
      legacyValue: await legacy.get(),
      primarySetCalls: primary.set.mock.calls.length,
    }));

    expect(primary.set).toHaveBeenCalledWith("legacy-token");
    expect(await legacy.get()).toBe("legacy-token");
  });
});
EOF
npm exec -- vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
rm -f packages/auth-store/src/__probe__.test.ts
nl -ba packages/auth-store/src/provider-store.ts | sed -n '1,45p'
```

## Observed Behavior

The credential remains available in the legacy store, but `get()` rejects because copying it into the primary store fails:

```text
{"legacyValue":"legacy-token","primarySetCalls":1}
✓ packages/auth-store/src/__probe__.test.ts > legacy credential migration write failure repro > rejects a usable legacy credential when primary persistence fails
```

`MigratingSecretStore.get()` first reads the primary store, then reads the fallback legacy store when the primary value is absent in `packages/auth-store/src/provider-store.ts:13` through `packages/auth-store/src/provider-store.ts:20`. When it obtains a non-null legacy value, it awaits `this.store.set(legacyValue)` before returning it in `packages/auth-store/src/provider-store.ts:21` through `packages/auth-store/src/provider-store.ts:25`. A write failure therefore aborts the read result despite leaving the valid legacy source untouched.

## Expected Behavior

Reading an existing legacy credential should return that credential even if best-effort migration into the primary store cannot currently be persisted, or the migration failure should be surfaced separately without making the fallback credential unusable.

## Impact

A read-only primary credential location, transient filesystem/keychain write error, or migration permission issue prevents authentication even when a valid legacy credential is still readable. Commands that only need to consume the secret fail unnecessarily until the migration destination becomes writable or the credential is manually relocated.
