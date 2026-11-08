import { createRequire } from "node:module";
import { createCredentialLockBindings } from "../dist/credential-transaction-lock.js";
const native = createRequire(import.meta.url)("../dist/auth-store-rust.node");
export const withSecretStoreFileLock = createCredentialLockBindings(native);
