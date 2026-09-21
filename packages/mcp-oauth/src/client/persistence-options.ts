import type { CreateSecretStoreInput } from "auth-store";

/** Own scalar policies while retaining selected live host dependencies. */
export function snapshotOAuthPersistenceOptions(options: CreateSecretStoreInput): CreateSecretStoreInput {
  const file = options.fileStore, keychain = options.keychainStore, lock = keychain?.lock;
  return { ...options, backend: options.backend, env: options.env, platform: options.platform, backendEnvVar: options.backendEnvVar,
    ...(file === undefined ? {} : { fileStore: { ...file, fs: file.fs, filePath: file.filePath, salt: file.salt,
      defaultDirectory: file.defaultDirectory, defaultFileName: file.defaultFileName, throwOnInvalidDocument: file.throwOnInvalidDocument,
      getHomeDirectory: file.getHomeDirectory?.bind(file), getMachineIdentity: file.getMachineIdentity?.bind(file), getRandomBytes: file.getRandomBytes?.bind(file) } }),
    ...(keychain === undefined ? {} : { keychainStore: { ...keychain, service: keychain.service, account: keychain.account,
      runCommand: keychain.runCommand?.bind(keychain), ...(lock === undefined ? {} : { lock: { ...lock, fs: lock.fs, directory: lock.directory } }) } }) };
}
