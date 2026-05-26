# Auth store legacy read race overwrites concurrently saved primary credential

## Summary

`MigratingSecretStore.get()` performs fallback migration as a read-primary, read-legacy, then write-primary sequence with no concurrency protection. If another operation saves a fresh primary credential after the initial missing-primary read but before the fallback legacy read resolves, the in-flight `get()` writes stale legacy data into the primary store and overwrites the newly saved credential.

## Reproduction

From the repository root, run a disposable Vitest probe that pauses the legacy read while another operation writes a new primary credential:

```sh
cat > packages/auth-store/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { MigratingSecretStore } from "./provider-store.js";
import type { SecretStore } from "./types.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("legacy migration concurrent login repro", () => {
  it("overwrites a newly stored credential with stale legacy data", async () => {
    let primaryValue: string | null = null;
    let legacyValue: string | null = "old-token";
    const legacyRead = deferred<string | null>();
    const primary = {
      get: vi.fn(async () => primaryValue),
      set: vi.fn(async (value: string) => { primaryValue = value; }),
      delete: vi.fn(async () => { primaryValue = null; }),
    } satisfies SecretStore;
    const legacy = {
      get: vi.fn(async () => legacyRead.promise),
      set: vi.fn(async (value: string) => { legacyValue = value; }),
      delete: vi.fn(async () => { legacyValue = null; }),
    } satisfies SecretStore;
    const store = new MigratingSecretStore(primary, legacy);

    const pendingRead = store.get();
    await vi.waitFor(() => expect(legacy.get).toHaveBeenCalledTimes(1));
    await primary.set("new-token");
    legacyRead.resolve("old-token");

    await expect(pendingRead).resolves.toBe("old-token");
    console.log(JSON.stringify({ primaryValue, legacyValue }));
    expect(primaryValue).toBe("old-token");
    expect(legacyValue).toBe("old-token");
  });
});
EOF
npm exec -- vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
rm -f packages/auth-store/src/__probe__.test.ts
nl -ba packages/auth-store/src/provider-store.ts | sed -n '7,35p'
```

## Observed Behavior

After the caller stores `"new-token"` in the primary store while the fallback read is in progress, completing the legacy read rewrites primary storage back to `"old-token"`:

```text
{"primaryValue":"old-token","legacyValue":"old-token"}
✓ packages/auth-store/src/__probe__.test.ts > legacy migration concurrent login repro > overwrites a newly stored credential with stale legacy data
```

`get()` reads primary state first, then obtains the legacy credential and writes it into the primary store without rechecking current primary state in `packages/auth-store/src/provider-store.ts:13` through `packages/auth-store/src/provider-store.ts:24`. The public write method separately writes a fresh primary value at `packages/auth-store/src/provider-store.ts:26` through `packages/auth-store/src/provider-store.ts:29`. An in-flight read migration can therefore commit after a newer primary write and replace it with stale fallback content.

## Expected Behavior

Fallback migration should not overwrite a primary credential that appeared after the read began. Before persisting legacy data, the store should detect a concurrent current value or otherwise serialize migration and explicit credential writes so the newer credential wins.

## Impact

A background status/read request racing with login, token refresh, or credential rotation can silently restore an obsolete secret after the new credential was successfully stored. Subsequent authentication uses stale credentials, potentially failing requests or continuing to use a token the user intended to replace.
