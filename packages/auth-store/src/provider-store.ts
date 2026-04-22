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
    return this.store.set(value);
  }

  async delete(): Promise<void> {
    return this.store.delete();
  }
}
