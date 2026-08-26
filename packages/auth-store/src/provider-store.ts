import type { SecretStore } from "./types.js";

export function key(providerId: string): string {
  return `provider:${providerId}`;
}

export class MigratingSecretStore implements SecretStore {
  private pendingMutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: SecretStore,
    private readonly legacyStore: SecretStore | null = null
  ) {}

  async get(options: { readOnly?: boolean } = {}): Promise<string | null> {
    const value = await this.store.get();
    if (value !== null || !this.legacyStore) {
      return value;
    }

    const legacyValue = await this.legacyStore.get();
    if (legacyValue !== null && !options.readOnly) {
      await this.mutate(async () => {
        if (await this.store.get() === null) {
          try {
            if (await this.legacyStore?.get() !== legacyValue) {
              return;
            }
            await this.store.set(legacyValue);
          } catch {
            return;
          }
        }
      });
    }
    return legacyValue;
  }

  async set(value: string): Promise<void> {
    await this.mutate(async () => {
      const previousValue = await this.store.get();
      const previousLegacyValue = await this.legacyStore?.get() ?? null;
      await this.store.set(value);
      try {
        await this.legacyStore?.set(value);
      } catch (error) {
        await restore(this.store, previousValue);
        if (this.legacyStore) {
          await restore(this.legacyStore, previousLegacyValue);
        }
        throw error;
      }
    });
  }

  async delete(): Promise<void> {
    await this.mutate(async () => {
      const previousValue = await this.store.get();
      const previousLegacyValue = await this.legacyStore?.get() ?? null;
      await this.store.delete();
      try {
        await this.legacyStore?.delete();
      } catch (error) {
        await restore(this.store, previousValue);
        if (this.legacyStore) {
          await restore(this.legacyStore, previousLegacyValue);
        }
        throw error;
      }
    });
  }

  private async mutate(action: () => Promise<void>): Promise<void> {
    const operation = this.pendingMutation.then(action, action);
    this.pendingMutation = operation.catch(() => undefined);
    await operation;
  }
}

async function restore(store: SecretStore, value: string | null): Promise<void> {
  if (value === null) {
    await store.delete();
    return;
  }

  await store.set(value);
}
