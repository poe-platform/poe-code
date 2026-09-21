import { createResourceBoundOAuthStores } from "mcp-oauth";
import { parseRemoteMcpConfiguration, type ConfigurationOptions, type RemoteMcpServerConfiguration } from "./configuration.js";
import type { ConfigurationBindingOptions } from "./runtime-configuration.js";

export interface RemoteMcpCredentialResetOptions extends ConfigurationOptions {
  readonly binding?: Pick<ConfigurationBindingOptions, "oauth"> & { readonly env?: ConfigurationBindingOptions["env"] };
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export interface RemoteMcpCredentialResetResult {
  readonly name: string;
  readonly url: string;
  readonly reset: true;
}

/** Retire a named OAuth identity without resolving credentials or reading its old document. */
export async function resetRemoteMcpAuthentication(
  value: RemoteMcpServerConfiguration,
  options: RemoteMcpCredentialResetOptions = {}
): Promise<RemoteMcpCredentialResetResult> {
  options.signal?.throwIfAborted();
  const [server] = parseRemoteMcpConfiguration({ version: 1, servers: [value] }, options).servers;
  if (server.auth?.type !== "oauth") throw new Error("Only managed OAuth credentials can be reset; update bearer/header environment values at the host");
  const oauth = options.binding?.oauth;
  const timeoutMs = options.timeoutMs ?? oauth?.sessionLockTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new Error("Credential reset timeoutMs must be a positive supported timer interval");
  if (oauth?.reset !== undefined) await oauth.reset(server, { signal: options.signal, timeoutMs });
  else {
    if (oauth?.sessionStore !== undefined) throw new Error("Host-owned OAuth persistence requires an explicit reset hook");
    await createResourceBoundOAuthStores(oauth?.authStore ?? {}, server.auth.persistenceNamespace, server.name)
      .reset(server.url, { signal: options.signal, timeoutMs });
  }
  options.signal?.throwIfAborted();
  return { name: server.name, url: server.url, reset: true };
}
