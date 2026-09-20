import { createRequire } from "node:module";
import { createCredentialStoreBindings } from "./runtime.js";
const native = createRequire(import.meta.url)("./auth-store-rust.node");
export const { createSecretStore, EncryptedFileStore, KeychainStore, key, MigratingSecretStore } =
  createCredentialStoreBindings(native);
