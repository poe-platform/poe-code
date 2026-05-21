import type { SecretStore } from "./types.js";

export function key(providerId: string): string {
  return `provider:${providerId}`;
}

export class MigratingSecretStore implements SecretStore {
  constructor(
    private readonly store: SecretStore,
    private readonly legacyStore: SecretStore | null = null
  ) {}

  async get(): Promise<string | null> {
    const value = await this.store.get();
    if (value !== null || !this.legacyStore) {
      return value;
    }

    const legacyValue = await this.legacyStore.get();
    if (legacyValue !== null) {
      await this.store.set(legacyValue);
    }
    return legacyValue;
  }

  async set(value: string): Promise<void> {
    await this.store.set(value);
    await this.legacyStore?.set(value);
  }

  async delete(): Promise<void> {
    await this.store.delete();
    await this.legacyStore?.delete();
  }
}
