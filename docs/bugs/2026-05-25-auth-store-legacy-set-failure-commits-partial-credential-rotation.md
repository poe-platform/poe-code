# Auth store legacy set failure commits partial credential rotation

## Summary

`auth-store`'s exported `MigratingSecretStore` writes a replacement credential to the primary store before mirroring it into legacy storage. If the legacy mirror write fails, `set()` rejects after the primary credential has already changed. The primary store immediately authenticates with the new secret while the legacy mirror retains the old one, so a reported failed rotation leaves credential state partially committed.

## Reproduction

Add the following temporary probe as `packages/auth-store/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { MigratingSecretStore } from "./provider-store.js";
import type { SecretStore } from "./types.js";

describe("legacy credential mirror set failure", () => {
  it("commits a rotated primary secret while the legacy mirror keeps the old value", async () => {
    let primaryValue: string | null = "old-secret";
    let legacyValue: string | null = "old-secret";
    const primary: SecretStore = {
      get: vi.fn(async () => primaryValue),
      set: vi.fn(async (value) => { primaryValue = value; }),
      delete: vi.fn(async () => { primaryValue = null; })
    };
    const legacy: SecretStore = {
      get: vi.fn(async () => legacyValue),
      set: vi.fn(async () => { throw new Error("legacy store unavailable"); }),
      delete: vi.fn(async () => { legacyValue = null; })
    };
    const store = new MigratingSecretStore(primary, legacy);

    await expect(store.set("new-secret")).rejects.toThrow("legacy store unavailable");

    console.log(JSON.stringify({ primaryValue, legacyValue, readableValue: await store.get() }));
    expect(primaryValue).toBe("new-secret");
    expect(legacyValue).toBe("old-secret");
    await expect(store.get()).resolves.toBe("new-secret");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
rm packages/auth-store/src/__probe__.test.ts
nl -ba packages/auth-store/src/provider-store.ts | sed -n '7,34p'
nl -ba packages/auth-store/src/provider-store.test.ts | sed -n '32,50p'
```

The reproduction passes and logs split credential state after the rejected update:

```text
{"primaryValue":"new-secret","legacyValue":"old-secret","readableValue":"new-secret"}
✓ packages/auth-store/src/__probe__.test.ts > legacy credential mirror set failure > commits a rotated primary secret while the legacy mirror keeps the old value
```

## Observed Behavior

`MigratingSecretStore.set()` awaits `this.store.set(value)` and only afterward awaits `this.legacyStore?.set(value)` in `packages/auth-store/src/provider-store.ts:26` through `packages/auth-store/src/provider-store.ts:29`. In the reproduction, the primary update succeeds and the legacy mirror rejects. Despite the returned failure, subsequent reads return the already-activated new primary secret, while direct legacy access would still expose the obsolete credential. Existing tests verify only the all-success mirror path in `packages/auth-store/src/provider-store.test.ts:41` through `packages/auth-store/src/provider-store.test.ts:50`.

## Expected Behavior

Credential rotation across mirrored stores should either commit consistently to both stores or leave the previously active credential state intact when any required mirror update fails. A rejected `set()` operation must not silently activate a new primary secret while preserving a different legacy secret.

## Impact

Login, token rotation, and migration workflows can report that persisting a new credential failed while future authentication already uses that new credential. Meanwhile the old credential remains in legacy storage, increasing credential exposure and creating unpredictable rollback or migration behavior. Callers cannot safely decide whether to retry, revoke, or notify users based on the failed result.
