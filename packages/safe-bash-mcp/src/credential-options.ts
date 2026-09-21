import type { RemoteMcpCredentialImportOptions } from "./credential-import.js";
import type { RemoteMcpCredentialResetOptions } from "./credential-reset.js";

type CredentialOptions = RemoteMcpCredentialResetOptions & Pick<RemoteMcpCredentialImportOptions,
  "fetch" | "oauthDiscoveryCache" | "requestTimeoutMs" | "maxImportBytes">;

/** Capture declared recovery policies and selected host handles at operation entry. */
export function snapshotRemoteMcpCredentialOptions<Options extends CredentialOptions>(options: Options): Options {
  return { ...options, binding: options.binding, signal: options.signal, fetch: options.fetch,
    oauthDiscoveryCache: options.oauthDiscoveryCache, requestTimeoutMs: options.requestTimeoutMs,
    timeoutMs: options.timeoutMs, maxImportBytes: options.maxImportBytes,
    maxConfigurationBytes: options.maxConfigurationBytes, maxTools: options.maxTools };
}
