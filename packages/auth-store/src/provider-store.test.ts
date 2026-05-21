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
      const secondGet = await store.get();

      expect(secondGet).toBe("legacy-credential");
      expect(legacy.get).toHaveBeenCalledTimes(1);
    });
  });
});
