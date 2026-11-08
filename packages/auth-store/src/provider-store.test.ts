import { describe, expect, it, vi } from "vitest";
import { key, MigratingSecretStore } from "./provider-store.js";
import type { SecretStore } from "./types.js";

function createMockStore(initial: string | null = null): SecretStore {
  let value = initial;
  return {
    get: vi.fn(async () => value),
    set: vi.fn(async (v: string) => { value = v; }),
    delete: vi.fn(async () => { value = null; })
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("key", () => {
  it("returns provider:<id> string", () => {
    expect(key("poe")).toBe("provider:poe");
    expect(key("anthropic")).toBe("provider:anthropic");
  });
});

describe("MigratingSecretStore", () => {
  describe("direct path", () => {
    it("returns value from primary store when it exists", async () => {
      const primary = createMockStore("existing-value");
      const legacy = createMockStore("legacy-value");
      const store = new MigratingSecretStore(primary, legacy);

      expect(await store.get()).toBe("existing-value");
      expect(legacy.get).not.toHaveBeenCalled();
    });

    it("delegates set to primary store", async () => {
      const primary = createMockStore();
      const store = new MigratingSecretStore(primary, null);

      await store.set("new-value");
      expect(primary.set).toHaveBeenCalledWith("new-value");
      expect(await store.get()).toBe("new-value");
    });

    it("mirrors set to the legacy store when one is present", async () => {
      const primary = createMockStore();
      const legacy = createMockStore();
      const store = new MigratingSecretStore(primary, legacy);

      await store.set("new-value");

      expect(primary.set).toHaveBeenCalledWith("new-value");
      expect(legacy.set).toHaveBeenCalledWith("new-value");
    });

    it("keeps concurrent mirrored writes in last-write order", async () => {
      const firstLegacyWrite = deferred();
      const primary = createMockStore();
      let legacyValue: string | null = null;
      const legacy: SecretStore = {
        get: vi.fn(async () => legacyValue),
        set: vi.fn(async (value: string) => {
          if (value === "first") {
            await firstLegacyWrite.promise;
          }
          legacyValue = value;
        }),
        delete: vi.fn(async () => { legacyValue = null; })
      };
      const store = new MigratingSecretStore(primary, legacy);

      const firstWrite = store.set("first");
      await vi.waitFor(() => expect(legacy.set).toHaveBeenCalledWith("first"));
      const secondWrite = store.set("second");
      firstLegacyWrite.resolve();
      await Promise.all([firstWrite, secondWrite]);

      await expect(primary.get()).resolves.toBe("second");
      await expect(legacy.get()).resolves.toBe("second");
    });

    it("rolls back primary changes when mirroring a set fails", async () => {
      const primary = createMockStore("old-value");
      let legacyValue: string | null = "old-value";
      const legacy: SecretStore = {
        get: vi.fn(async () => legacyValue),
        set: vi.fn()
          .mockImplementationOnce(async (value: string) => {
            legacyValue = value;
            throw new Error("legacy unavailable");
          })
          .mockImplementation(async (value: string) => { legacyValue = value; }),
        delete: vi.fn(async () => { legacyValue = null; })
      };
      const store = new MigratingSecretStore(primary, legacy);

      await expect(store.set("new-value")).rejects.toThrow("legacy unavailable");

      await expect(primary.get()).resolves.toBe("old-value");
      await expect(legacy.get()).resolves.toBe("old-value");
    });

    it("delegates delete to primary store", async () => {
      const primary = createMockStore("something");
      const store = new MigratingSecretStore(primary, null);

      await store.delete();
      expect(primary.delete).toHaveBeenCalled();
    });

    it("mirrors delete to the legacy store when one is present", async () => {
      const primary = createMockStore("primary");
      const legacy = createMockStore("legacy");
      const store = new MigratingSecretStore(primary, legacy);

      await store.delete();

      expect(primary.delete).toHaveBeenCalled();
      expect(legacy.delete).toHaveBeenCalled();
    });

    it("restores credentials when deleting the legacy mirror fails", async () => {
      const primary = createMockStore("primary");
      const legacy = createMockStore("legacy");
      vi.mocked(legacy.delete).mockRejectedValueOnce(new Error("legacy delete failed"));
      const store = new MigratingSecretStore(primary, legacy);

      await expect(store.delete()).rejects.toThrow("legacy delete failed");

      await expect(store.get()).resolves.toBe("primary");
      await expect(legacy.get()).resolves.toBe("legacy");
    });
  });

  describe("migration path", () => {
    it("falls back to legacy store when primary is empty", async () => {
      const primary = createMockStore(null);
      const legacy = createMockStore("legacy-credential");
      const store = new MigratingSecretStore(primary, legacy);

      expect(await store.get()).toBe("legacy-credential");
    });

    it("stores migrated value in primary store", async () => {
      const primary = createMockStore(null);
      const legacy = createMockStore("legacy-credential");
      const store = new MigratingSecretStore(primary, legacy);

      await store.get();

      expect(primary.set).toHaveBeenCalledWith("legacy-credential");
    });

    it("reads legacy credentials without migration in read-only mode", async () => {
      const primary = createMockStore(null);
      const legacy = createMockStore("legacy-credential");
      const store = new MigratingSecretStore(primary, legacy);

      await expect(store.get({ readOnly: true })).resolves.toBe("legacy-credential");

      expect(primary.set).not.toHaveBeenCalled();
    });

    it("returns readable legacy credentials when migration persistence fails", async () => {
      const primary = createMockStore(null);
      const legacy = createMockStore("legacy-credential");
      vi.mocked(primary.set).mockRejectedValueOnce(new Error("primary unavailable"));
      const store = new MigratingSecretStore(primary, legacy);

      await expect(store.get()).resolves.toBe("legacy-credential");
    });

    it("does not overwrite a newer primary credential during migration", async () => {
      const readLegacy = deferred();
      const primary = createMockStore(null);
      const legacy = createMockStore("legacy-credential");
      vi.mocked(legacy.get).mockImplementationOnce(async () => {
        await readLegacy.promise;
        return "legacy-credential";
      });
      const store = new MigratingSecretStore(primary, legacy);

      const read = store.get();
      await vi.waitFor(() => expect(legacy.get).toHaveBeenCalled());
      const write = store.set("new-credential");
      readLegacy.resolve();
      await Promise.all([read, write]);

      await expect(primary.get()).resolves.toBe("new-credential");
    });

    it.each([
      { readOnly: false, setBeforeDelete: false },
      { readOnly: false, setBeforeDelete: true },
      { readOnly: true, setBeforeDelete: false },
      { readOnly: true, setBeforeDelete: true }
    ])("does not resurrect deleted credentials (readOnly=$readOnly, setBeforeDelete=$setBeforeDelete)", async ({ readOnly, setBeforeDelete }) => {
      const legacyReadCaptured = deferred();
      const releaseLegacyRead = deferred();
      const primary = createMockStore(null);
      const legacy = createMockStore("legacy-credential");
      const getLegacy = legacy.get;
      vi.mocked(legacy.get).mockImplementationOnce(async () => {
        const capturedValue = await getLegacy();
        legacyReadCaptured.resolve();
        await releaseLegacyRead.promise;
        return capturedValue;
      });
      const store = new MigratingSecretStore(primary, legacy);

      const read = store.get({ readOnly });
      await legacyReadCaptured.promise;
      try {
        if (setBeforeDelete) {
          await store.set("new-credential");
        }
        await store.delete();
        await expect(primary.get()).resolves.toBeNull();
        await expect(legacy.get()).resolves.toBeNull();
        vi.mocked(primary.set).mockClear();
        vi.mocked(legacy.set).mockClear();
        vi.mocked(primary.delete).mockClear();
        vi.mocked(legacy.delete).mockClear();
      } finally {
        releaseLegacyRead.resolve();
        await read;
      }

      await expect(primary.get()).resolves.toBeNull();
      await expect(legacy.get()).resolves.toBeNull();
      await expect(store.get()).resolves.toBeNull();
      await expect(new MigratingSecretStore(primary, legacy).get()).resolves.toBeNull();
      expect(primary.set).not.toHaveBeenCalled();
      expect(legacy.set).not.toHaveBeenCalled();
      expect(primary.delete).not.toHaveBeenCalled();
      expect(legacy.delete).not.toHaveBeenCalled();
    });

    it("returns readable legacy credentials when migration revalidation fails", async () => {
      const primary = createMockStore(null);
      const legacy = createMockStore("legacy-credential");
      vi.mocked(legacy.get)
        .mockResolvedValueOnce("legacy-credential")
        .mockRejectedValueOnce(new Error("legacy unavailable"));
      const store = new MigratingSecretStore(primary, legacy);

      await expect(store.get()).resolves.toBe("legacy-credential");

      expect(primary.set).not.toHaveBeenCalled();
      await expect(primary.get()).resolves.toBeNull();
    });

    it("returns null when both primary and legacy are empty", async () => {
      const primary = createMockStore(null);
      const legacy = createMockStore(null);
      const store = new MigratingSecretStore(primary, legacy);

      expect(await store.get()).toBeNull();
      expect(primary.set).not.toHaveBeenCalled();
    });

    it("returns null when no legacy store is provided", async () => {
      const primary = createMockStore(null);
      const store = new MigratingSecretStore(primary, null);

      expect(await store.get()).toBeNull();
    });

    it("subsequent get returns from primary after migration", async () => {
      const primary = createMockStore(null);
      const legacy = createMockStore("legacy-credential");
      const store = new MigratingSecretStore(primary, legacy);

      await store.get();
      vi.mocked(legacy.get).mockClear();
      const secondGet = await store.get();

      expect(secondGet).toBe("legacy-credential");
      expect(legacy.get).not.toHaveBeenCalled();
    });
  });
});
