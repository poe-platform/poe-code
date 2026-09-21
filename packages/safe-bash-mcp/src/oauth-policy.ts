import type { DefaultOAuthClientProviderOptions } from "mcp-oauth";

export function snapshotOAuthBrowserOptions(browser: DefaultOAuthClientProviderOptions["browser"]): DefaultOAuthClientProviderOptions["browser"] {
  return { ...browser,
    ...(browser.landingPage === undefined ? {} : { landingPage: { ...browser.landingPage } }) };
}

export function snapshotOAuthPersistenceOptions(options: NonNullable<DefaultOAuthClientProviderOptions["authStore"]>): NonNullable<DefaultOAuthClientProviderOptions["authStore"]> {
  return { ...options,
    ...(options.fileStore === undefined ? {} : { fileStore: { ...options.fileStore } }),
    ...(options.keychainStore === undefined ? {} : { keychainStore: { ...options.keychainStore,
      ...(options.keychainStore.lock === undefined ? {} : { lock: { ...options.keychainStore.lock } }) } }) };
}
