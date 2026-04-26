import type {
  OAuthAuthorizationServerMetadata,
  OAuthDiscoveryResult,
  OAuthMetadataFetch,
  OAuthProtectedResourceMetadata,
  OAuthUnauthorizedChallenge,
} from "mcp-oauth";

export type {
  OAuthAuthorizationServerMetadata,
  OAuthDiscoveryResult,
  OAuthMetadataFetch,
  OAuthProtectedResourceMetadata,
  OAuthUnauthorizedChallenge,
};

export interface OAuthDiscoveryCache {
  get(
    resourceUrl: string
  ): OAuthDiscoveryResult | null | undefined | Promise<OAuthDiscoveryResult | null | undefined>;
  set(resourceUrl: string, value: OAuthDiscoveryResult): void | Promise<void>;
}

export interface OAuthMetadataDiscoveryOptions {
  fetch?: OAuthMetadataFetch;
  cache?: OAuthDiscoveryCache;
}

export interface OAuthMetadataLookupOptions {
  resourceMetadataUrl?: string | URL;
}

function defaultOAuthMetadataFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function normalizeHostname(hostname: string): string {
  return hostname.endsWith(".") ? hostname.slice(0, -1).toLowerCase() : hostname.toLowerCase();
}

function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);

  return normalizedHostname === "localhost"
    || normalizedHostname === "::1"
    || normalizedHostname.startsWith("127.");
}

function assertSecureUrl(url: URL, label: string): void {
  if (url.protocol === "https:") {
    return;
  }

  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) {
    return;
  }

  throw new Error(`${label} must use https unless it targets a loopback host`);
}

function validateProtectedResourceMetadata(
  value: unknown,
  resourceUrl: string
): OAuthProtectedResourceMetadata {
  if (!isObjectRecord(value)) {
    throw new Error("Protected resource metadata must be a JSON object");
  }

  if (typeof value.resource !== "string" || value.resource.length === 0) {
    throw new Error("Protected resource metadata must include a resource string");
  }

  if (value.resource !== resourceUrl) {
    throw new Error(
      `Protected resource metadata resource mismatch: expected ${resourceUrl}, received ${value.resource}`
    );
  }

  if (!isStringArray(value.authorization_servers) || value.authorization_servers.length === 0) {
    throw new Error(
      "Protected resource metadata must include a non-empty authorization_servers array"
    );
  }

  return value as OAuthProtectedResourceMetadata;
}

function validateAuthorizationServerMetadata(
  value: unknown,
  issuer: string
): OAuthAuthorizationServerMetadata {
  if (!isObjectRecord(value)) {
    throw new Error("Authorization server metadata must be a JSON object");
  }

  if (typeof value.issuer !== "string" || value.issuer.length === 0) {
    throw new Error("Authorization server metadata must include issuer");
  }

  if (value.issuer !== issuer) {
    throw new Error(
      `Authorization server metadata issuer mismatch: expected ${issuer}, received ${value.issuer}`
    );
  }

  if (
    typeof value.authorization_endpoint !== "string" ||
    value.authorization_endpoint.length === 0
  ) {
    throw new Error("Authorization server metadata must include authorization_endpoint");
  }

  if (typeof value.token_endpoint !== "string" || value.token_endpoint.length === 0) {
    throw new Error("Authorization server metadata must include token_endpoint");
  }

  if (
    !isStringArray(value.response_types_supported) ||
    !value.response_types_supported.includes("code")
  ) {
    throw new Error(
      "Authorization server metadata must include response_types_supported containing code"
    );
  }

  if (
    !isStringArray(value.code_challenge_methods_supported) ||
    !value.code_challenge_methods_supported.includes("S256")
  ) {
    throw new Error(
      "Authorization server metadata must include code_challenge_methods_supported containing S256"
    );
  }

  return value as OAuthAuthorizationServerMetadata;
}

async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    const statusDescriptor = `${response.status} ${response.statusText}`.trim();
    throw new Error(`${label} request failed (${statusDescriptor})`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`${label} response must be valid JSON`);
  }
}

function resolveWellKnownMetadataUrl(inputUrl: string | URL, suffix: string): string {
  const url = new URL(typeof inputUrl === "string" ? inputUrl : inputUrl.toString());

  const resourcePath = url.pathname === "/" ? "" : url.pathname;
  url.pathname = `/.well-known/${suffix}${resourcePath}`;

  return url.toString();
}

export function resolveProtectedResourceMetadataUrl(
  resourceUrl: string | URL,
  resourceMetadataUrl?: string | URL
): string {
  const resource = new URL(typeof resourceUrl === "string" ? resourceUrl : resourceUrl.toString());
  assertSecureUrl(resource, "Protected resource URL");

  if (resourceMetadataUrl !== undefined) {
    const resolvedResourceMetadataUrl = new URL(
      typeof resourceMetadataUrl === "string" ? resourceMetadataUrl : resourceMetadataUrl.toString(),
      resource
    );
    assertSecureUrl(resolvedResourceMetadataUrl, "Protected resource metadata URL");
    return resolvedResourceMetadataUrl.toString();
  }

  const resolvedResourceMetadataUrl = new URL(
    resolveWellKnownMetadataUrl(resource, "oauth-protected-resource")
  );
  assertSecureUrl(resolvedResourceMetadataUrl, "Protected resource metadata URL");
  return resolvedResourceMetadataUrl.toString();
}

function normalizeAuthorizationServerIssuer(issuer: string | URL): string {
  const input = typeof issuer === "string" ? issuer : issuer.toString();
  const url = new URL(input);
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error("Authorization server issuer must not include query or fragment");
  }

  assertSecureUrl(url, "Authorization server issuer");

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.pathname === "/" ? url.origin : url.toString();
}

export function resolveAuthorizationServerMetadataUrl(issuer: string | URL): string {
  return resolveWellKnownMetadataUrl(
    normalizeAuthorizationServerIssuer(issuer),
    "oauth-authorization-server"
  );
}

export class OAuthMetadataDiscovery {
  private readonly fetchImpl: OAuthMetadataFetch;
  private readonly cache: OAuthDiscoveryCache | undefined;
  private readonly memoryCache = new Map<string, OAuthDiscoveryResult>();

  constructor({ fetch = defaultOAuthMetadataFetch, cache }: OAuthMetadataDiscoveryOptions = {}) {
    this.fetchImpl = fetch;
    this.cache = cache;
  }

  async discover(
    resourceUrl: string | URL,
    { resourceMetadataUrl }: OAuthMetadataLookupOptions = {}
  ): Promise<OAuthDiscoveryResult> {
    const cacheKey = typeof resourceUrl === "string" ? resourceUrl : resourceUrl.toString();
    const resourceMetadataLocation = resolveProtectedResourceMetadataUrl(
      resourceUrl,
      resourceMetadataUrl
    );
    const memoryCachedResult = this.memoryCache.get(cacheKey);
    if (
      memoryCachedResult !== undefined &&
      (resourceMetadataUrl === undefined
        || memoryCachedResult.resourceMetadataUrl === resourceMetadataLocation)
    ) {
      return memoryCachedResult;
    }

    const sharedCachedResult = await this.cache?.get(cacheKey);
    if (
      sharedCachedResult !== null &&
      sharedCachedResult !== undefined &&
      (resourceMetadataUrl === undefined
        || sharedCachedResult.resourceMetadataUrl === resourceMetadataLocation)
    ) {
      this.memoryCache.set(cacheKey, sharedCachedResult);
      return sharedCachedResult;
    }

    const resourceMetadataResponse = await this.fetchImpl(resourceMetadataLocation, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    const resourceMetadata = validateProtectedResourceMetadata(
      await readJsonResponse(resourceMetadataResponse, "Protected resource metadata"),
      cacheKey
    );

    const authorizationServerErrors: string[] = [];

    for (const authorizationServer of resourceMetadata.authorization_servers) {
      const normalizedAuthorizationServer = normalizeAuthorizationServerIssuer(
        authorizationServer
      );
      const authorizationServerMetadataUrl =
        resolveAuthorizationServerMetadataUrl(normalizedAuthorizationServer);

      try {
        const authorizationServerResponse = await this.fetchImpl(authorizationServerMetadataUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });
        const authorizationServerMetadata = validateAuthorizationServerMetadata(
          await readJsonResponse(
            authorizationServerResponse,
            "Authorization server metadata"
          ),
          normalizedAuthorizationServer
        );

        const result: OAuthDiscoveryResult = {
          resource: resourceMetadata.resource,
          resourceMetadataUrl: resourceMetadataLocation,
          resourceMetadata,
          authorizationServer: normalizedAuthorizationServer,
          authorizationServerMetadataUrl,
          authorizationServerMetadata,
        };

        this.memoryCache.set(cacheKey, result);
        await this.cache?.set(cacheKey, result);
        return result;
      } catch (error) {
        authorizationServerErrors.push(
          `${authorizationServerMetadataUrl}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    throw new Error(
      `Unable to load authorization server metadata for ${cacheKey}: ${authorizationServerErrors.join(
        "; "
      )}`
    );
  }
}

export async function discoverOAuthMetadata(
  resourceUrl: string | URL,
  options: OAuthMetadataDiscoveryOptions & OAuthMetadataLookupOptions = {}
): Promise<OAuthDiscoveryResult> {
  const discovery = new OAuthMetadataDiscovery(options);
  return discovery.discover(resourceUrl, options);
}

function skipOptionalWhitespace(value: string, start: number): number {
  let index = start;
  while (index < value.length && (value[index] === " " || value[index] === "\t")) {
    index += 1;
  }
  return index;
}

function readToken(value: string, start: number): { token: string; nextIndex: number } | null {
  let index = start;
  while (index < value.length) {
    const character = value[index];
    if (
      character === " "
      || character === "\t"
      || character === ","
      || character === "="
      || character === "\""
    ) {
      break;
    }
    index += 1;
  }

  if (index === start) {
    return null;
  }

  return {
    token: value.slice(start, index),
    nextIndex: index,
  };
}

function looksLikeAuthParam(value: string, start: number): boolean {
  const token = readToken(value, start);
  if (token === null) {
    return false;
  }

  return value[skipOptionalWhitespace(value, token.nextIndex)] === "=";
}

function isToken68Character(character: string): boolean {
  return (
    (character >= "a" && character <= "z")
    || (character >= "A" && character <= "Z")
    || (character >= "0" && character <= "9")
    || character === "-"
    || character === "."
    || character === "_"
    || character === "~"
    || character === "+"
    || character === "/"
  );
}

function readToken68(
  value: string,
  start: number
): { token68: string; nextIndex: number } | null {
  let nextIndex = start;
  while (nextIndex < value.length) {
    const character = value[nextIndex];
    if (character === "," || character === " " || character === "\t") {
      break;
    }
    nextIndex += 1;
  }

  const token68 = value.slice(start, nextIndex);
  if (token68.length === 0) {
    return null;
  }

  let index = 0;
  while (index < token68.length && isToken68Character(token68[index]!)) {
    index += 1;
  }

  if (index === 0) {
    return null;
  }

  while (index < token68.length && token68[index] === "=") {
    index += 1;
  }

  if (index !== token68.length) {
    return null;
  }

  return { token68, nextIndex };
}

function readQuotedString(
  value: string,
  start: number
): { parsedValue: string; nextIndex: number } | null {
  if (value[start] !== "\"") {
    return null;
  }

  let parsedValue = "";
  let index = start + 1;
  let escaping = false;

  while (index < value.length) {
    const character = value[index];
    if (escaping) {
      parsedValue += character;
      escaping = false;
      index += 1;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      index += 1;
      continue;
    }

    if (character === "\"") {
      return {
        parsedValue,
        nextIndex: index + 1,
      };
    }

    parsedValue += character;
    index += 1;
  }

  return null;
}

function parseAuthParam(
  value: string,
  start: number
): { name: string; value: string; nextIndex: number } | null {
  const token = readToken(value, start);
  if (token === null) {
    return null;
  }

  let index = skipOptionalWhitespace(value, token.nextIndex);
  if (value[index] !== "=") {
    return null;
  }

  index = skipOptionalWhitespace(value, index + 1);
  if (index >= value.length) {
    return null;
  }

  const quotedValue = readQuotedString(value, index);
  if (quotedValue !== null) {
    return {
      name: token.token,
      value: quotedValue.parsedValue,
      nextIndex: quotedValue.nextIndex,
    };
  }

  let nextIndex = index;
  while (nextIndex < value.length) {
    const character = value[nextIndex];
    if (character === "," || character === " " || character === "\t") {
      break;
    }
    nextIndex += 1;
  }

  return {
    name: token.token,
    value: value.slice(index, nextIndex),
    nextIndex,
  };
}

export function parseBearerWwwAuthenticateHeader(
  headerValue: string | null
): OAuthUnauthorizedChallenge | null {
  if (headerValue === null) {
    return null;
  }

  let index = 0;
  let firstBearerChallenge: OAuthUnauthorizedChallenge | null = null;

  while (index < headerValue.length) {
    index = skipOptionalWhitespace(headerValue, index);
    while (headerValue[index] === ",") {
      index = skipOptionalWhitespace(headerValue, index + 1);
    }

    const scheme = readToken(headerValue, index);
    if (scheme === null) {
      break;
    }

    index = skipOptionalWhitespace(headerValue, scheme.nextIndex);
    const params: Record<string, string> = {};

    if (index < headerValue.length && headerValue[index] !== ",") {
      const token68 = readToken68(headerValue, index);
      if (token68 !== null) {
        index = token68.nextIndex;
      } else if (looksLikeAuthParam(headerValue, index)) {
        while (index < headerValue.length) {
          const parsedParam = parseAuthParam(headerValue, index);
          if (parsedParam === null) {
            break;
          }

          params[parsedParam.name] = parsedParam.value;
          index = skipOptionalWhitespace(headerValue, parsedParam.nextIndex);

          if (headerValue[index] !== ",") {
            break;
          }

          const nextIndex = skipOptionalWhitespace(headerValue, index + 1);
          if (!looksLikeAuthParam(headerValue, nextIndex)) {
            index = nextIndex;
            break;
          }

          index = nextIndex;
        }
      }
    }

    if (scheme.token.toLowerCase() === "bearer") {
      const challenge: OAuthUnauthorizedChallenge = {
        scheme: "Bearer",
        params,
        raw: headerValue,
      };
      if (Object.keys(params).length > 0) {
        return challenge;
      }

      firstBearerChallenge ??= challenge;
    }

    if (headerValue[index] === ",") {
      index += 1;
    }
  }

  return firstBearerChallenge;
}
