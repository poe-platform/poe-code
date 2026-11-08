import { SafeFsSecretStore, MigratingSecretStore, key } from "auth-store-rust/portable";
import type { SafeFsSecretStoreInput, SecretStore, SecretStoreLockOptions } from "auth-store-rust/portable";
import type { SafeFsSecretStoreInput as ReferenceInput, SecretStore as ReferenceStore } from "auth-store/portable";
declare const input: SafeFsSecretStoreInput;
declare const referenceInput: ReferenceInput;
const a: ReferenceInput = input;
const b: SafeFsSecretStoreInput = referenceInput;
const store: SecretStore = new SafeFsSecretStore(input);
const reference: ReferenceStore = store;
const own: SecretStore = reference;
const migrated: SecretStore = new MigratingSecretStore(store, reference);
const lock: SecretStoreLockOptions = { signal: new AbortController().signal, timeoutMs: 10 };
const value: Promise<string | null> = migrated.get({ readOnly: true });
const provider: string = key("poe");
// @ts-expect-error encryption keys are host-managed CryptoKeys
new SafeFsSecretStore({ ...input, key: "secret" });
// @ts-expect-error portable stores do not synthesize a filesystem transaction lock
new SafeFsSecretStore(input).withLock(async () => 1);
// @ts-expect-error secrets are strings
store.set(7);
void [a, b, own, lock, value, provider];
