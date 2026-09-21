import { discoverOAuthMetadata, type Implementation, type McpClient, type ServerCapabilities } from "tiny-mcp-client";
import { parseRemoteMcpConfiguration, type RemoteMcpServerConfiguration } from "./configuration.js";
import { bindRemoteMcpConfiguration, type ConfigurationBindingOptions } from "./runtime-configuration.js";
import { remoteLimits, withRemoteMcpClient } from "./remote.js";
import type { SchemaFetchOptions } from "./schema.js";

export interface RemoteMcpAuthorizationRequest {
  readonly authorizationUrl: string;
  readonly redirectUri: string;
}
export interface RemoteMcpAuthenticationOptions extends SchemaFetchOptions {
  readonly binding: ConfigurationBindingOptions;
  /** Defaults to headless URL delivery. Browser launch requires an explicit false. */
  readonly noBrowser?: boolean;
  readonly onAuthorizationUrl?: (request: RemoteMcpAuthorizationRequest) => void | Promise<void>;
}
export interface RemoteMcpAuthenticationResult {
  readonly name: string;
  readonly url: string;
  readonly serverInfo?: Implementation;
  readonly capabilities?: ServerCapabilities;
  readonly instructions?: string;
}

/** Establish access explicitly, without listing tools or invoking any tool. */
export async function authenticateRemoteMcpServer(
  value: RemoteMcpServerConfiguration,
  options: RemoteMcpAuthenticationOptions
): Promise<RemoteMcpAuthenticationResult> {
  options.signal?.throwIfAborted();
  const limits = remoteLimits({ ...options, requestTimeoutMs: options.requestTimeoutMs ?? 120_000 });
  if (limits.requestTimeoutMs > 2_147_483_647) throw new Error("Authentication requestTimeoutMs must be a positive supported timer interval");
  const deadline = AbortSignal.timeout(limits.requestTimeoutMs);
  const signal = options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline]);
  const configuration = parseRemoteMcpConfiguration({ version: 1, servers: [value] }, options.binding);
  const browser = options.binding.oauth?.browser;
  const opener = browser?.openBrowser;
  const observer = options.onAuthorizationUrl;
  const noBrowser = options.noBrowser ?? true;
  const [bound] = bindRemoteMcpConfiguration(configuration, {
    ...options.binding,
    oauth: {
      ...options.binding.oauth, allowInteractive: true,
      browser: {
        ...browser,
        async openBrowser(authorizationUrl) {
          signal.throwIfAborted(); browser?.signal?.throwIfAborted();
          if (noBrowser && observer === undefined) throw new Error("Headless OAuth requires an onAuthorizationUrl callback");
          if (!noBrowser && opener === undefined) throw new Error("Host browser opener is not configured");
          const redirectUri = new URL(authorizationUrl).searchParams.get("redirect_uri");
          if (redirectUri === null) throw new Error("OAuth authorization URL is missing its redirect URI");
          await observer?.({ authorizationUrl, redirectUri });
          signal.throwIfAborted(); browser?.signal?.throwIfAborted();
          if (!noBrowser) await opener!(authorizationUrl);
        }
      }
    }
  });
  const { tools: ignoredTools, ...server } = bound;
  const settings = { ...options, requestTimeoutMs: limits.requestTimeoutMs, signal };
  const provider = server.oauth?.provider;
  const requestUrl = new URL(server.url);
  const fetch = options.fetch ?? globalThis.fetch;
  // Recover known pending sessions before transport authorization, which is
  // intentionally noninteractive. Unknown grants still use real HTTP challenges.
  await provider?.authenticate?.({ requestUrl, fetch, signal });
  const summary = (client: McpClient): RemoteMcpAuthenticationResult => ({ name: server.name, url: server.url,
    ...(client.serverInfo === null ? {} : { serverInfo: client.serverInfo }),
    ...(client.serverCapabilities === null ? {} : { capabilities: client.serverCapabilities }),
    ...(client.instructions === undefined ? {} : { instructions: client.instructions }) });
  let establishedGrant = false;
  const result = await withRemoteMcpClient(server, settings, async client => {
    if (provider !== undefined) {
      const tokens = await provider.authorizeRequest?.({ requestUrl, headers: new Headers(), fetch, signal });
      if (tokens === undefined) {
        if (provider.authenticate === undefined) throw new Error("OAuth provider does not support explicit authentication");
        const authenticated = await provider.authenticate({ requestUrl, fetch, signal,
          discover: () => discoverOAuthMetadata(requestUrl, { fetch, cache: options.oauthDiscoveryCache, signal }) });
        if (authenticated === undefined) throw new Error("OAuth authentication did not establish a usable grant");
        establishedGrant = true;
      }
    }
    return summary(client);
  });
  // Public initialization may precede consent. Verify the newly obtained grant
  // with a fresh initialized connection, without discovering or calling tools.
  return establishedGrant ? withRemoteMcpClient(server, settings, async client => summary(client)) : result;
}
