import { readBoundedResponseText } from "./http-response.js";
import type {
  OAuthAuthorizationServerMetadata,
  OAuthDiscoveryResult,
  OAuthMetadataFetch,
  OAuthProtectedResourceMetadata,
  OAuthUnauthorizedChallenge,
} from "mcp-oauth";
import { canonicalizeResourceIndicator, fetchMcpResponse } from "mcp-oauth";

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
  delete?(resourceUrl: string): void | Promise<void>;
}

export interface OAuthMetadataDiscoveryOptions {
  fetch?: OAuthMetadataFetch;
  cache?: OAuthDiscoveryCache;
}

export interface OAuthMetadataLookupOptions {
  resourceMetadataUrl?: string | URL;
  signal?: AbortSignal;
}

const metadataErrorBrand = Symbol.for("poe-platform.tiny-mcp-client.OAuthMetadataError");

export type OAuthMetadataFailureReason = "invalid-metadata" | "issuer-mismatch" | "pkce-unsupported"
  | "response-type-unsupported" | "invalid-endpoint" | "invalid-json" | "http-error" | "network-error";
export type OAuthMetadataFailureCategory = "validation" | "json" | "http" | "network";
export interface OAuthMetadataFailure {
  readonly phase: "protected-resource" | "authorization-server";
  readonly category: OAuthMetadataFailureCategory;
  readonly reason: OAuthMetadataFailureReason;
  readonly status?: number;
}

/** Typed metadata failure. Only phase/category/reason/status/failures are safe diagnostics. */
export class OAuthMetadataError extends Error {
  static is(value: unknown): value is OAuthMetadataError {
    return value instanceof Error && Object.getOwnPropertyDescriptor(value, metadataErrorBrand)?.value === true;
  }

  readonly category: OAuthMetadataFailureCategory;

  constructor(readonly phase: "protected-resource" | "authorization-server", message: string, readonly status?: number,
    readonly reason: OAuthMetadataFailureReason = status === undefined ? "invalid-metadata" : "http-error",
    readonly failures: readonly OAuthMetadataFailure[] = []) {
    super(message);
    this.name = "OAuthMetadataError";
    this.category = reason === "invalid-json" ? "json" : reason === "http-error" ? "http"
      : reason === "network-error" ? "network" : "validation";
    Object.defineProperty(this, metadataErrorBrand, { value: true });
  }
}

function metadataFailure(error: unknown, phase: OAuthMetadataError["phase"], reason: OAuthMetadataFailureReason): OAuthMetadataError {
  return OAuthMetadataError.is(error) ? error : new OAuthMetadataError(phase,
    error instanceof Error ? error.message : String(error), undefined, reason);
}

function aggregateMetadataFailures(phase: OAuthMetadataError["phase"], errors: OAuthMetadataError[], message: string): OAuthMetadataError {
  // A validated defect must survive later discovery-location misses. A successful fallback still wins.
  const primary = errors.find(error => error.category === "validation") ?? errors[0]!;
  const failures = errors.map(({ phase, category, reason, status }) => Object.freeze({ phase, category, reason, status }));
  return new OAuthMetadataError(phase, message, primary.status, primary.reason, Object.freeze(failures));
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
    || normalizedHostname === "[::1]"
    || (normalizedHostname.startsWith("127.") && normalizedHostname.split(".").length === 4
      && normalizedHostname.split(".").every(part => part.length > 0 && [...part].every(char => char >= "0" && char <= "9") && Number(part) <= 255));
}

function assertSecureUrl(url: URL, label: string): void {
  if (url.username !== "" || url.password !== "" || url.href.includes("#")) {
    throw new Error(`${label} must not include credentials or fragment`);
  }
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
  if (value.resource.includes("#")) {
    throw new OAuthMetadataError("protected-resource", "Protected resource metadata resource must not include fragment");
  }

  const normalizedResource = canonicalizeResourceIndicator(value.resource);

  if (normalizedResource !== resourceUrl) {
    throw new OAuthMetadataError("protected-resource",
      `Protected resource metadata resource mismatch: expected ${resourceUrl}, received ${value.resource}`
    );
  }

  if (!isStringArray(value.authorization_servers) || value.authorization_servers.length === 0) {
    throw new Error(
      "Protected resource metadata must include a non-empty authorization_servers array"
    );
  }

  return {
    ...value,
    resource: normalizedResource,
  } as OAuthProtectedResourceMetadata;
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
    throw new OAuthMetadataError("authorization-server",
      `Authorization server metadata issuer mismatch: expected ${issuer}, received ${value.issuer}`, undefined, "issuer-mismatch"
    );
  }

  if (
    typeof value.authorization_endpoint !== "string" ||
    value.authorization_endpoint.length === 0
  ) {
    throw new OAuthMetadataError("authorization-server", "Authorization server metadata must include authorization_endpoint", undefined, "invalid-endpoint");
  }

  if (typeof value.token_endpoint !== "string" || value.token_endpoint.length === 0) {
    throw new OAuthMetadataError("authorization-server", "Authorization server metadata must include token_endpoint", undefined, "invalid-endpoint");
  }

  for (const field of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
    if (field === "registration_endpoint" && value[field] === undefined) {
      continue;
    }
    let endpoint: URL;
    try {
      if (typeof value[field] !== "string") {
        throw new Error();
      }
      endpoint = new URL(value[field]);
      assertSecureUrl(endpoint, `Authorization server metadata ${field}`);
    } catch (error) {
      throw new OAuthMetadataError("authorization-server", `Authorization server metadata ${field} must be an absolute URL: ${error instanceof Error ? error.message : "invalid URL"}`, undefined, "invalid-endpoint");
    }
  }

  if (
    !isStringArray(value.response_types_supported) ||
    !value.response_types_supported.includes("code")
  ) {
    throw new OAuthMetadataError("authorization-server",
      "Authorization server metadata must include response_types_supported containing code", undefined, "response-type-unsupported"
    );
  }

  if (
    !isStringArray(value.code_challenge_methods_supported) ||
    !value.code_challenge_methods_supported.includes("S256")
  ) {
    throw new OAuthMetadataError("authorization-server",
      "Authorization server metadata must include code_challenge_methods_supported containing S256", undefined, "pkce-unsupported"
    );
  }

  return value as OAuthAuthorizationServerMetadata;
}

async function readJsonResponse(response: Response, phase: OAuthMetadataError["phase"], signal: AbortSignal): Promise<unknown> {
  const label = phase === "protected-resource" ? "Protected resource metadata" : "Authorization server metadata";
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    const statusDescriptor = `${response.status} ${response.statusText}`.trim();
    throw new OAuthMetadataError(phase, `${label} request failed (${statusDescriptor})`, response.status);
  }

  const text = await readBoundedResponseText(response, 1024 * 1024, undefined, signal);
  try {
    return JSON.parse(text);
  } catch {
    throw new OAuthMetadataError(phase, `${label} response must be valid JSON`, undefined, "invalid-json");
  }
}

async function fetchMetadata(fetch: OAuthMetadataFetch, location: string, phase: OAuthMetadataError["phase"], parentSignal?: AbortSignal): Promise<unknown> {
  parentSignal?.throwIfAborted();
  const deadline = AbortSignal.timeout(10_000);
  const signal = parentSignal === undefined ? deadline : AbortSignal.any([deadline, parentSignal]);
  try {
    const response = await fetchMcpResponse(fetch, location, {
      method: "GET", headers: { Accept: "application/json" }, signal
    });
    return await readJsonResponse(response, phase, signal);
  } catch (error) {
    parentSignal?.throwIfAborted();
    throw metadataFailure(error, phase, "network-error");
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

function validateAuthorizationServerIssuer(issuer: string | URL): string {
  const input = typeof issuer === "string" ? issuer : issuer.toString();
  const url = new URL(input);
  if (url.href.includes("?") || url.href.includes("#")) {
    throw new Error("Authorization server issuer must not include query or fragment");
  }

  assertSecureUrl(url, "Authorization server issuer");

  return input;
}

export function resolveAuthorizationServerMetadataUrl(issuer: string | URL): string {
  return resolveWellKnownMetadataUrl(
    validateAuthorizationServerIssuer(issuer),
    "oauth-authorization-server"
  );
}

function authorizationServerMetadataLocations(issuer: string): string[] {
  const locations = [
    resolveAuthorizationServerMetadataUrl(issuer),
    resolveWellKnownMetadataUrl(issuer, "openid-configuration")
  ];
  const issuerUrl = new URL(issuer);
  if (issuerUrl.pathname !== "/") {
    const path = issuerUrl.pathname.endsWith("/")
      ? issuerUrl.pathname.slice(0, -1)
      : issuerUrl.pathname;
    issuerUrl.pathname = `${path}/.well-known/openid-configuration`;
    locations.push(issuerUrl.toString());
  }
  return locations;
}

function validateCachedDiscovery(value: unknown, resource: string): OAuthDiscoveryResult {
  if (!isObjectRecord(value) || value.resource !== resource) {
    throw new Error("Cached OAuth discovery resource mismatch");
  }
  if (
    typeof value.resourceMetadataUrl !== "string" ||
    typeof value.authorizationServer !== "string" ||
    typeof value.authorizationServerMetadataUrl !== "string"
  ) {
    throw new Error("Cached OAuth discovery is missing identity fields");
  }
  const resourceMetadata = validateProtectedResourceMetadata(value.resourceMetadata, resource);
  const resourceMetadataLocation = new URL(value.resourceMetadataUrl);
  assertSecureUrl(resourceMetadataLocation, "Cached OAuth discovery metadata location");
  const issuer = validateAuthorizationServerIssuer(value.authorizationServer);
  if (!resourceMetadata.authorization_servers.includes(issuer)) {
    throw new Error("Cached OAuth discovery issuer was not advertised by the resource");
  }
  if (
    !authorizationServerMetadataLocations(issuer).includes(value.authorizationServerMetadataUrl)
  ) {
    throw new Error("Cached OAuth discovery metadata location does not match issuer");
  }
  const authorizationServerMetadata = validateAuthorizationServerMetadata(
    value.authorizationServerMetadata,
    issuer
  );
  return structuredClone({
    resource,
    resourceMetadataUrl: value.resourceMetadataUrl,
    resourceMetadata,
    authorizationServer: issuer,
    authorizationServerMetadataUrl: value.authorizationServerMetadataUrl,
    authorizationServerMetadata
  });
}

async function waitForCache<T>(operation: T | Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation;
  let abort!: () => void;
  try {
    return await new Promise<T>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(operation).then(resolve, reject);
      if (signal.aborted) abort();
    });
  } finally { signal.removeEventListener("abort", abort); }
}

export class OAuthMetadataDiscovery {
  private readonly fetchImpl: OAuthMetadataFetch;
  private readonly cache: OAuthDiscoveryCache | undefined;
  private readonly memoryCache = new Map<string, OAuthDiscoveryResult>();

  constructor({ fetch = defaultOAuthMetadataFetch, cache }: OAuthMetadataDiscoveryOptions = {}) {
    this.fetchImpl = fetch;
    this.cache = cache;
  }

  private async discoverProtectedResource(
    resource: string,
    resourceMetadataUrl?: string | URL,
    signal?: AbortSignal
  ): Promise<{ location: string; metadata: OAuthProtectedResourceMetadata }> {
    const locations = new Set([resolveProtectedResourceMetadataUrl(resource, resourceMetadataUrl)]);
    if (resourceMetadataUrl === undefined) {
      locations.add(new URL("/.well-known/oauth-protected-resource", resource).toString());
    }

    const errors: OAuthMetadataError[] = [];
    for (const location of locations) {
      try {
        const metadata = validateProtectedResourceMetadata(
          await fetchMetadata(this.fetchImpl, location, "protected-resource", signal),
          resource
        );
        return { location, metadata };
      } catch (error) {
        signal?.throwIfAborted();
        errors.push(metadataFailure(error, "protected-resource", "invalid-metadata"));
      }
    }
    throw aggregateMetadataFailures("protected-resource", errors, errors.at(-1)!.message);
  }

  async discover(
    resourceUrl: string | URL,
    { resourceMetadataUrl, signal }: OAuthMetadataLookupOptions = {}
  ): Promise<OAuthDiscoveryResult> {
    signal?.throwIfAborted();
    const cacheKey = canonicalizeResourceIndicator(resourceUrl);
    resolveProtectedResourceMetadataUrl(resourceUrl, resourceMetadataUrl);
    const memoryCachedResult = this.memoryCache.get(cacheKey);
    if (memoryCachedResult !== undefined && resourceMetadataUrl === undefined) {
      return structuredClone(memoryCachedResult);
    }

    const sharedCachedResult = resourceMetadataUrl === undefined ? await waitForCache(this.cache?.get(cacheKey), signal) : undefined;
    signal?.throwIfAborted();
    if (
      sharedCachedResult !== null &&
      sharedCachedResult !== undefined &&
      resourceMetadataUrl === undefined
    ) {
      try {
        const result = validateCachedDiscovery(sharedCachedResult, cacheKey);
        this.memoryCache.set(cacheKey, structuredClone(result));
        return result;
      } catch {
        await waitForCache(this.cache?.delete?.(cacheKey), signal);
      }
    }

    const { location: resourceMetadataLocation, metadata: resourceMetadata } =
      await this.discoverProtectedResource(cacheKey, resourceMetadataUrl, signal);

    const authorizationServerErrors: string[] = [];
    const failures: OAuthMetadataError[] = [];

    for (const authorizationServer of resourceMetadata.authorization_servers) {
      let normalizedAuthorizationServer: string;
      try { normalizedAuthorizationServer = validateAuthorizationServerIssuer(authorizationServer); }
      catch (error) {
        const failure = metadataFailure(error, "authorization-server", "invalid-metadata");
        failures.push(failure);
        authorizationServerErrors.push(failure.message);
        continue;
      }
      const metadataLocations = authorizationServerMetadataLocations(normalizedAuthorizationServer);

      for (const authorizationServerMetadataUrl of metadataLocations) {
        let authorizationServerMetadata: OAuthAuthorizationServerMetadata;
        try {
          authorizationServerMetadata = validateAuthorizationServerMetadata(
            await fetchMetadata(this.fetchImpl, authorizationServerMetadataUrl, "authorization-server", signal),
            normalizedAuthorizationServer
          );
        } catch (error) {
          signal?.throwIfAborted();
          failures.push(metadataFailure(error, "authorization-server", "invalid-metadata"));
          authorizationServerErrors.push(
            `${authorizationServerMetadataUrl}: ${error instanceof Error ? error.message : String(error)}`
          );
          continue;
        }

        const result: OAuthDiscoveryResult = {
          resource: resourceMetadata.resource,
          resourceMetadataUrl: resourceMetadataLocation,
          resourceMetadata,
          authorizationServer: normalizedAuthorizationServer,
          authorizationServerMetadataUrl,
          authorizationServerMetadata
        };

        await waitForCache(this.cache?.set(cacheKey, structuredClone(result)), signal);
        this.memoryCache.set(cacheKey, structuredClone(result));
        return result;
      }
    }

    throw aggregateMetadataFailures("authorization-server", failures,
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
    const params: Record<string, string> = Object.create(null) as Record<string, string>;

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

          const parameterName = parsedParam.name.toLowerCase();
          if (scheme.token.toLowerCase() === "bearer" && Object.hasOwn(params, parameterName)) {
            throw new Error("Bearer challenge must not repeat authentication parameters");
          }
          params[parameterName] = parsedParam.value;
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
