# Auth store concurrent credential writes leave legacy mirror stale

## Summary

`MigratingSecretStore.set()` writes the primary secret and then independently mirrors it into legacy storage without serializing concurrent calls. If an older write pauses while updating the legacy store and a newer write completes first, the older operation can resume afterward and overwrite only the legacy mirror with stale credentials. Both operations resolve successfully while primary and legacy stores disagree about the current secret.

## Reproduction

From the repository root, run a disposable Vitest probe that delays the legacy phase of an older write while a newer credential write completes:

```sh
cat > packages/auth-store/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { MigratingSecretStore } from "./provider-store.js";
import type { SecretStore } from "./types.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("concurrent mirrored set repro", () => {
  it("leaves legacy storage stale when an older write resumes last", async () => {
    let primaryValue: string | null = null;
    let legacyValue: string | null = null;
    const holdFirstLegacySet = deferred();
    const primary = {
      get: vi.fn(async () => primaryValue),
      set: vi.fn(async (value: string) => { primaryValue = value; }),
      delete: vi.fn(async () => { primaryValue = null; }),
    } satisfies SecretStore;
    const legacy = {
      get: vi.fn(async () => legacyValue),
      set: vi.fn(async (value: string) => {
        if (value === "old-token") await holdFirstLegacySet.promise;
        legacyValue = value;
      }),
      delete: vi.fn(async () => { legacyValue = null; }),
    } satisfies SecretStore;
    const store = new MigratingSecretStore(primary, legacy);

    const oldWrite = store.set("old-token");
    await vi.waitFor(() => expect(legacy.set).toHaveBeenCalledWith("old-token"));
    await store.set("new-token");
    holdFirstLegacySet.resolve();
    await oldWrite;

    console.log(JSON.stringify({ primaryValue, legacyValue }));
    expect(primaryValue).toBe("new-token");
    expect(legacyValue).toBe("old-token");
  });
});
EOF
npm exec -- vitest run packages/auth-store/src/__probe__.test.ts --reporter verbose
rm -f packages/auth-store/src/__probe__.test.ts
nl -ba packages/auth-store/src/provider-store.ts | sed -n '7,35p'
```

## Observed Behavior

After both credential writes resolve, primary storage contains the newer token while the legacy mirror has been rewritten to the older token:

```text
{"primaryValue":"new-token","legacyValue":"old-token"}
✓ packages/auth-store/src/__probe__.test.ts > concurrent mirrored set repro > leaves legacy storage stale when an older write resumes last
```

`MigratingSecretStore.set()` awaits the primary write and only afterward awaits the legacy write in `packages/auth-store/src/provider-store.ts:26` through `packages/auth-store/src/provider-store.ts:29`. There is no versioning or serialization across concurrent invocations. The newer operation can therefore complete both writes before an older paused legacy write resumes and overwrites the mirror alone.

## Expected Behavior

Concurrent credential updates should preserve last-write-wins ordering consistently across both primary and legacy storage. If a newer write has committed, an older in-flight mirror update must not overwrite one backend afterward.

## Impact

Concurrent login, refresh, or token-rotation operations can report success while leaving stale credentials in legacy storage. If primary storage is later unavailable, deleted, or migrated again, fallback behavior may resurrect the obsolete token and break authentication or undo a credential rotation.
