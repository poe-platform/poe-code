# Auth store legacy delete failure remigrates a deleted credential

## Summary

`auth-store`'s exported `MigratingSecretStore` deletes the primary credential before attempting to delete its legacy mirror. If the legacy delete fails, the operation rejects after the primary copy is gone but the legacy copy remains. A subsequent `get()` then treats that remaining legacy credential as migration input and restores it into the primary store, undoing the attempted deletion.

## Reproduction

Add the following temporary probe as `packages/auth-store/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { MigratingSecretStore } from "./provider-store.js";
import type { SecretStore } from "./types.js";

describe("legacy credential delete failure", () => {
  it("remigrates a credential after primary deletion succeeds but legacy deletion fails", async () => {
    let primaryValue: string | null = "secret";
    let legacyValue: string | null = "secret";
    const primary: SecretStore = {
      get: vi.fn(async () => primaryValue),
      set: vi.fn(async (value) => { primaryValue = value; }),
      delete: vi.fn(async () => { primaryValue = null; })
    };
    const legacy: SecretStore = {
      get: vi.fn(async () => legacyValue),
      set: vi.fn(async (value) => { legacyValue = value; }),
      delete: vi.fn(async () => { throw new Error("legacy store unavailable"); })
    };
    const store = new MigratingSecretStore(primary, legacy);

    await expect(store.delete()).rejects.toThrow("legacy store unavailable");
    const afterFailure = await store.get();
    console.log(JSON.stringify({ primaryValue, legacyValue, afterFailure }));
    expect(afterFailure).toBe("secret");
    expect(primaryValue).toBe("secret");
  });
});
```

Run the probe and then remove it:

```sh
./node_modules/.bin/vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
rm -f packages/auth-store/src/__probe__.test.ts
```

The reproduction passes and shows the supposedly deleted credential returning to the primary store:

```text
{"primaryValue":"secret","legacyValue":"secret","afterFailure":"secret"}
✓ packages/auth-store/src/__probe__.test.ts > legacy credential delete failure > remigrates a credential after primary deletion succeeds but legacy deletion fails
```

## Observed Behavior

`MigratingSecretStore.delete()` awaits `this.store.delete()` and then awaits `this.legacyStore?.delete()` without rollback or a tombstone. In the reproduction, primary deletion succeeds and legacy deletion rejects. The next `get()` sees an empty primary store, reads the surviving legacy value, and executes `this.store.set(legacyValue)`, restoring the credential that deletion attempted to remove.

## Expected Behavior

Once credential removal has been requested, a secondary-store cleanup failure must not permit later reads to restore the secret into active credential storage. Deletion should be atomic across mirrored stores or record a deletion state that blocks remigration until cleanup is repaired.

## Impact

Logout and provider credential removal workflows can fail closed on screen while leaving credentials capable of becoming active again on the next read. A transient legacy-store failure therefore defeats credential revocation, unexpectedly restoring authentication material and undermining user expectations that a failed cleanup does not silently log them back in.
