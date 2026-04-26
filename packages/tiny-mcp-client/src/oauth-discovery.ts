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
  url.hash = "";

  const resourcePath = url.pathname === "/" ? "" : url.pathname;
  url.pathname = `/.well-known/${suffix}${resourcePath}`;

  return url.toString();
}

export function resolveProtectedResourceMetadataUrl(
  resourceUrl: string | URL,
  resourceMetadataUrl?: string | URL
): string {
  if (resourceMetadataUrl !== undefined) {
    return new URL(
      typeof resourceMetadataUrl === "string" ? resourceMetadataUrl : resourceMetadataUrl.toString(),
      typeof resourceUrl === "string" ? resourceUrl : resourceUrl.toString()
    ).toString();
  }

  return resolveWellKnownMetadataUrl(resourceUrl, "oauth-protected-resource");
}

function normalizeAuthorizationServerIssuer(issuer: string | URL): string {
  const url = new URL(typeof issuer === "string" ? issuer : issuer.toString());
  url.hash = "";

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
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
    const memoryCachedResult = this.memoryCache.get(cacheKey);
    if (memoryCachedResult !== undefined) {
      return memoryCachedResult;
    }

    const sharedCachedResult = await this.cache?.get(cacheKey);
    if (sharedCachedResult !== null && sharedCachedResult !== undefined) {
      this.memoryCache.set(cacheKey, sharedCachedResult);
      return sharedCachedResult;
    }

    const resourceMetadataLocation = resolveProtectedResourceMetadataUrl(
      resourceUrl,
      resourceMetadataUrl
    );
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

function splitHeaderSegments(value: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inQuotes = false;
  let escaping = false;

  for (const character of value) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      current += character;
      escaping = true;
      continue;
    }

    if (character === "\"") {
      current += character;
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      segments.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

function trimLeadingWhitespace(value: string): string {
  let index = 0;
  while (index < value.length && (value[index] === " " || value[index] === "\t")) {
    index += 1;
  }
  return value.slice(index);
}

function splitChallengeToken(segment: string): { token: string; remainder: string } | null {
  const trimmedSegment = trimLeadingWhitespace(segment);
  if (trimmedSegment.length === 0) {
    return null;
  }

  let index = 0;
  while (index < trimmedSegment.length) {
    const character = trimmedSegment[index];
    if (character === " " || character === "\t") {
      break;
    }
    if (character === "=") {
      return null;
    }
    index += 1;
  }

  if (index === 0) {
    return null;
  }

  const token = trimmedSegment.slice(0, index);
  const remainder = trimLeadingWhitespace(trimmedSegment.slice(index));
  return { token, remainder };
}

function parseAuthParam(segment: string): [string, string] | null {
  const trimmedSegment = trimLeadingWhitespace(segment);
  const equalsIndex = trimmedSegment.indexOf("=");
  if (equalsIndex <= 0) {
    return null;
  }

  const name = trimmedSegment.slice(0, equalsIndex).trim();
  const rawValue = trimmedSegment.slice(equalsIndex + 1).trim();
  if (name.length === 0 || rawValue.length === 0) {
    return null;
  }

  if (rawValue[0] !== "\"") {
    return [name, rawValue];
  }

  let value = "";
  let escaping = false;
  for (let index = 1; index < rawValue.length; index += 1) {
    const character = rawValue[index];
    if (escaping) {
      value += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (character === "\"") {
      return [name, value];
    }

    value += character;
  }

  return null;
}

export function parseBearerWwwAuthenticateHeader(
  headerValue: string | null
): OAuthUnauthorizedChallenge | null {
  if (headerValue === null) {
    return null;
  }

  const segments = splitHeaderSegments(headerValue);
  const bearerSegments: string[] = [];
  let inBearerChallenge = false;

  for (const segment of segments) {
    const challengeToken = splitChallengeToken(segment);
    if (challengeToken !== null) {
      if (challengeToken.token.toLowerCase() === "bearer") {
        inBearerChallenge = true;
        if (challengeToken.remainder.length > 0) {
          bearerSegments.push(challengeToken.remainder);
        }
        continue;
      }

      if (inBearerChallenge) {
        break;
      }

      continue;
    }

    if (inBearerChallenge) {
      bearerSegments.push(segment);
    }
  }

  if (!inBearerChallenge) {
    return null;
  }

  const params: Record<string, string> = {};
  for (const segment of bearerSegments) {
    const parsedParam = parseAuthParam(segment);
    if (parsedParam === null) {
      continue;
    }

    params[parsedParam[0]] = parsedParam[1];
  }

  return {
    scheme: "Bearer",
    params,
    raw: headerValue,
  };
}
