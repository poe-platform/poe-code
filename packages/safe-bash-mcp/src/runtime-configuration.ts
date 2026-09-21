import { createDefaultOAuthClientProvider, type DefaultOAuthClientProviderOptions, type OAuthClientProvider,
  type OAuthSessionStore } from "mcp-oauth";
import { parseRemoteMcpConfiguration, type ConfigurationOptions, type EnvironmentReference,
  type PublicEnvironmentReference, type RemoteMcpServerConfiguration } from "./configuration.js";
import type { RemoteMcpServer } from "./schema.js";

export interface ConfigurationBindingOptions extends ConfigurationOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly maxCredentialBytes?: number;
  readonly oauth?: {
    readonly allowInteractive?: boolean;
    readonly sessionLockTimeoutMs?: number;
    readonly browser?: Omit<DefaultOAuthClientProviderOptions["browser"], "redirectUri">;
    readonly sessionStore?: (server: RemoteMcpServerConfiguration) => OAuthSessionStore;
    /** Host-owned reset must retire credentials and suppress stale initial imports durably. */
    readonly reset?: (server: RemoteMcpServerConfiguration, options: { signal?: AbortSignal; timeoutMs: number }) => Promise<void>;
    readonly authStore?: DefaultOAuthClientProviderOptions["authStore"];
    readonly now?: () => number;
  };
}
export interface BoundRemoteMcpServer extends Omit<RemoteMcpServer, "oauth"> {
  readonly oauth?: { readonly provider: OAuthClientProvider };
}

/** Resolve explicit environment references into runtime-only credentials without network or artifact writes. */
export function bindRemoteMcpConfiguration(value: unknown, options: ConfigurationBindingOptions): BoundRemoteMcpServer[] {
  const configuration = parseRemoteMcpConfiguration(value, options);
  const limit = options.maxCredentialBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("maxCredentialBytes must be a positive safe integer");
  if (typeof options.env !== "object" || options.env === null) throw new Error("MCP credential environment must be an object");
  let credentialBytes = 0;
  const values = new Map<string, string | undefined>();
  const read = (reference: EnvironmentReference, required = false): string | undefined => {
    if (!values.has(reference.env)) {
      const descriptor = Object.getOwnPropertyDescriptor(options.env, reference.env);
      if (descriptor !== undefined && (!("value" in descriptor) || (descriptor.value !== undefined && typeof descriptor.value !== "string")))
        throw new Error(`Invalid MCP credential environment value for ${reference.env}`);
      const value = descriptor?.value as string | undefined;
      credentialBytes += value === undefined ? 0 : Buffer.byteLength(value, "utf8");
      if (credentialBytes > limit) throw new Error("MCP credential environment byte limit exceeded");
      values.set(reference.env, value === "" ? undefined : value);
    }
    const value = values.get(reference.env);
    if (required && (value === undefined || value.trim() === "")) throw new Error(`Missing required MCP environment variable ${reference.env}`);
    return value;
  };
  const publicValue = (reference: PublicEnvironmentReference): string | undefined => read(reference) ?? reference.fallback;
  const readTiming = (reference: EnvironmentReference | undefined): number | undefined => {
    if (reference === undefined) return undefined;
    const value = read(reference);
    if (value === undefined) return undefined;
    const number = Number(value);
    if (value.length === 0 || [...value].some(char => char < "0" || char > "9") || !Number.isSafeInteger(number) || number > 8_640_000_000_000_000)
      throw new Error(`Invalid OAuth timing value in ${reference.env}`);
    return number;
  };
  // Complete value preflight before creating providers or asking the host for stores.
  const prepared = configuration.servers.map(configuration => {
    const { headers: references, auth, ...server } = configuration;
    const headers = new Headers();
    const setHeader = (name: string, value: string, source: string): void => {
      try { headers.set(name, value); }
      catch { throw new Error(`Invalid MCP header credential in environment variable ${source}`); }
    };
    for (const [name, reference] of Object.entries(references ?? {})) setHeader(name, read(reference, true)!, reference.env);
    let oauthOptions: DefaultOAuthClientProviderOptions | undefined;
    if (auth?.type === "bearer") setHeader("Authorization", `Bearer ${read(auth.token, true)!}`, auth.token.env);
    if (auth?.type === "oauth") {
      const refs = auth.credentials;
      const clientId = read(refs.clientId, auth.clientMode === "static");
      const clientSecret = read(refs.clientSecret);
      const scope = publicValue(refs.scope);
      const redirectUri = publicValue(refs.redirectUri);
      const accessToken = read(refs.accessToken);
      if (accessToken !== undefined) {
        try {
          if (accessToken.trim() === "") throw new Error("Empty OAuth access token");
          new Headers({ Authorization: `Bearer ${accessToken.trim()}` });
        } catch { throw new Error(`Invalid OAuth access token in ${refs.accessToken.env}`); }
      }
      const refreshToken = read(refs.refreshToken);
      const expiry = readTiming(refs.expiresAt);
      const lifetime = readTiming(refs.expiresIn);
      const issuedAt = readTiming(refs.issuedAt);
      if (scope !== undefined && [...scope].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126 || char === '"' || char === "\\"))
        throw new Error(`Invalid OAuth scope in ${refs.scope.env}`);
      if (accessToken === undefined && (refreshToken !== undefined || expiry !== undefined || lifetime !== undefined || issuedAt !== undefined))
        throw new Error("Imported OAuth refresh token or expiry requires an access token");
      if (issuedAt !== undefined && lifetime === undefined)
        throw new Error("Imported OAuth issuance time requires a relative lifetime");
      const expiresAt = expiry ?? (lifetime === undefined ? null : (issuedAt ?? (options.oauth?.now ?? Date.now)()) + lifetime * 1000);
      if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || Math.abs(expiresAt) > 8_640_000_000_000_000))
        throw new Error(`Invalid OAuth relative expiry in ${refs.expiresIn?.env ?? refs.expiresAt.env}`);
      if (accessToken !== undefined && (clientId === undefined || clientId.trim() === ""))
        throw new Error(`Imported OAuth grant requires the original client ID in ${refs.clientId.env}`);
      oauthOptions = {
        persistenceNamespace: auth.persistenceNamespace,
        resourceIdentity: options.oauth?.sessionStore === undefined ? server.name : undefined,
        client: auth.clientMode === "static"
          ? { mode: "static", clientId: clientId!, clientSecret, metadata: { scope }, tokenEndpointAuthMethod: auth.tokenEndpointAuthMethod }
          : { mode: "dynamic", clientId, clientSecret, metadata: { scope }, tokenEndpointAuthMethod: auth.tokenEndpointAuthMethod },
        allowInteractive: options.oauth?.allowInteractive ?? false,
        sessionLockTimeoutMs: options.oauth?.sessionLockTimeoutMs,
        browser: { ...options.oauth?.browser, redirectUri }, authStore: options.oauth?.authStore, now: options.oauth?.now,
        ...(accessToken === undefined ? {} : { initialGrant: { resource: server.url,
          tokens: { accessToken, refreshToken, expiresAt, tokenType: "Bearer" as const, scope } } })
      };
    }
    return { server: { ...server, ...(headers.keys().next().done ? {} : { headers }) }, configuration, oauthOptions };
  });
  return prepared.map(({ server, configuration, oauthOptions }) => oauthOptions === undefined ? server : {
    ...server, oauth: { provider: createDefaultOAuthClientProvider({ ...oauthOptions, sessionStore: options.oauth?.sessionStore?.(configuration) }) }
  });
}
