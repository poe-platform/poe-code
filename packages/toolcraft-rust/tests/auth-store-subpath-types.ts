import * as native from "toolcraft-rust/auth-store";
import * as reference from "toolcraft/auth-store";

type Public<T> = { [K in keyof T]: T[K] };
declare const input: native.CreateSecretStoreInput;
declare const originalInput: reference.CreateSecretStoreInput;
const inputForward: reference.CreateSecretStoreInput = input;
const inputReverse: native.CreateSecretStoreInput = originalInput;
const createForward: typeof reference.createSecretStore = native.createSecretStore;
const createReverse: typeof native.createSecretStore = reference.createSecretStore;
const resolveForward: typeof reference.resolveSecretStoreBackend = native.resolveSecretStoreBackend;
const resolveReverse: typeof native.resolveSecretStoreBackend = reference.resolveSecretStoreBackend;
declare const ownFile: Public<native.EncryptedFileStore>;
declare const originalFile: Public<reference.EncryptedFileStore>;
const fileForward: Public<reference.EncryptedFileStore> = ownFile;
const fileReverse: Public<native.EncryptedFileStore> = originalFile;
declare const ownKeychain: Public<native.KeychainStore>;
declare const originalKeychain: Public<reference.KeychainStore>;
const keychainForward: Public<reference.KeychainStore> = ownKeychain;
const keychainReverse: Public<native.KeychainStore> = originalKeychain;
declare const ownMigration: Public<native.MigratingSecretStore>;
declare const originalMigration: Public<reference.MigratingSecretStore>;
const migrationForward: Public<reference.MigratingSecretStore> = ownMigration;
const migrationReverse: Public<native.MigratingSecretStore> = originalMigration;
const secret: Promise<string | null> = ownMigration.get({ readOnly: true });
const lockResult: Promise<number> = ownFile.withLock(async () => 42, { timeoutMs: 0 });
// @ts-expect-error Backends form a closed public union.
native.createSecretStore({ backend: "unknown" });
// @ts-expect-error Secrets are strings.
ownFile.set(42);
void [
  inputForward,
  inputReverse,
  createForward,
  createReverse,
  resolveForward,
  resolveReverse,
  fileForward,
  fileReverse,
  keychainForward,
  keychainReverse,
  migrationForward,
  migrationReverse,
  secret,
  lockResult
];
