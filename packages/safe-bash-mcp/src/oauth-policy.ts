import { snapshotOAuthPersistenceOptions, type DefaultOAuthClientProviderOptions } from "mcp-oauth";
import type { ConfigurationBindingOptions } from "./runtime-configuration.js";

export function snapshotOAuthBindingOptions(oauth: NonNullable<ConfigurationBindingOptions["oauth"]>): NonNullable<ConfigurationBindingOptions["oauth"]> {
  return { ...oauth, allowInteractive: oauth.allowInteractive, sessionLockTimeoutMs: oauth.sessionLockTimeoutMs,
    now: oauth.now?.bind(oauth), sessionStore: oauth.sessionStore?.bind(oauth), reset: oauth.reset?.bind(oauth), importSession: oauth.importSession?.bind(oauth),
    ...(oauth.browser === undefined ? {} : { browser: snapshotOAuthBrowserOptions(oauth.browser) }),
    ...(oauth.authStore === undefined ? {} : { authStore: snapshotOAuthPersistenceOptions(oauth.authStore) }) };
}

export function snapshotOAuthBrowserOptions(browser: DefaultOAuthClientProviderOptions["browser"]): DefaultOAuthClientProviderOptions["browser"] {
  return { ...browser, openBrowser: browser.openBrowser?.bind(browser), readLine: browser.readLine?.bind(browser), createServer: browser.createServer?.bind(browser),
    redirectUri: browser.redirectUri, signal: browser.signal, timeoutMs: browser.timeoutMs,
    ...(browser.landingPage === undefined ? {} : { landingPage: { ...browser.landingPage, title: browser.landingPage.title, body: browser.landingPage.body } }) };
}

export { snapshotOAuthPersistenceOptions } from "mcp-oauth";
