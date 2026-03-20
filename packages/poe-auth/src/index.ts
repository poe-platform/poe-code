export { createAuthStore } from "./create-auth-store.js";
export { checkAuth } from "./check-auth.js";
export { getToken } from "./get-token.js";
export { isValidApiKeyFormat, normalizeApiKey, stripBracketedPaste } from "./api-key-validation.js";
export { login } from "./login.js";
export { logout } from "./logout.js";
export { createOAuthClient } from "./oauth-client.js";
export type { AuthIdentity } from "./check-auth.js";
export type { LoginOptions } from "./login.js";
export type {
  OAuthClient,
  OAuthClientConfig,
  OAuthResult,
  OAuthAuthorization
} from "./oauth-client.js";
export { EncryptedFileAuthStore } from "./encrypted-file-auth-store.js";
export { KeychainAuthStore } from "./keychain-auth-store.js";
export type {
  AuthStore,
  AuthBackend,
  AuthStoreWarningLogger,
  CreateAuthStoreInput,
  CreateAuthStoreResult,
  LegacyCredentialsMigrationFileSystem,
  LegacyCredentialsMigrationInput
} from "./types.js";
export type {
  MachineIdentity,
  EncryptedFileAuthStoreInput,
  EncryptedFileAuthStoreFileSystem
} from "./encrypted-file-auth-store.js";
export type {
  KeychainAuthStoreInput,
  KeychainCommandRunner,
  KeychainCommandResult
} from "./keychain-auth-store.js";
