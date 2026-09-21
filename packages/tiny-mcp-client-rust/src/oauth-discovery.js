import { createRequire } from "node:module";
import { canonicalizeResourceIndicator } from "./oauth/resource.js";
import { fetchMcpResponse, readBoundedResponseText } from "./oauth/http.js";
const native = createRequire(import.meta.url)("./tiny-mcp-client-rust.node");
const metadataErrorBrand = Symbol.for("poe-platform.tiny-mcp-client.OAuthMetadataError");
export class OAuthMetadataError extends Error {
  static is(value) {
    return value instanceof Error && Object.getOwnPropertyDescriptor(value, metadataErrorBrand)?.value === true;
  }
  constructor(phase, message, status) {
    super(message);
    this.name = "OAuthMetadataError";
    this.phase = phase;
    this.status = status;
    Object.defineProperty(this, metadataErrorBrand, { value: true });
  }
}

function admitUrl(url, label, issuer = false) {
  try {
    native.checkDiscoveryUrl({ protocol: url.protocol, hostname: url.hostname,
      credentials: url.username !== "" || url.password !== "", fragment: url.href.includes("#"), query: url.href.includes("?") }, label, issuer);
  } catch (error) { throw new Error(error.message); }
}

function metadataPolicy(command, input, expected, normalized) {
  let outcome;
  try { outcome = native.discoveryMetadataPolicy(command, input, expected, normalized); }
  catch (error) { throw new Error(error.message); }
  if (Object.hasOwn(outcome, "error")) {
    if (command === "resource_bound" && outcome.error.startsWith("Protected resource metadata resource mismatch")
      || command === "resource" && outcome.error === "Protected resource metadata resource must not include fragment") {
      throw new OAuthMetadataError("protected-resource", outcome.error);
    }
    if (command === "issuer" && outcome.error.startsWith("Authorization server metadata issuer mismatch")) {
      throw new OAuthMetadataError("authorization-server", outcome.error);
    }
    throw new Error(outcome.error);
  }
  return outcome.value;
}

function issuerLocations(issuer) {
  const input = typeof issuer === "string" ? issuer : issuer.toString();
  const url = new URL(input);
  admitUrl(url, "Authorization server issuer", true);
  const locations = native.discoveryMetadataPaths(url.pathname, true).map(path => {
    const location = new URL(url);
    location.pathname = path;
    return location.toString();
  });
  return { issuer: input, locations };
}

export function resolveAuthorizationServerMetadataUrl(issuer) {
  return issuerLocations(issuer).locations[0];
}

export function resolveProtectedResourceMetadataUrl(resourceUrl, resourceMetadataUrl) {
  const resource = new URL(typeof resourceUrl === "string" ? resourceUrl : resourceUrl.toString());
  admitUrl(resource, "Protected resource URL");
  let location;
  if (resourceMetadataUrl !== undefined) {
    location = new URL(typeof resourceMetadataUrl === "string" ? resourceMetadataUrl : resourceMetadataUrl.toString(), resource);
  } else {
    location = new URL(resource);
    location.pathname = native.discoveryMetadataPaths(resource.pathname, false)[0];
  }
  admitUrl(location, "Protected resource metadata URL");
  return location.toString();
}

function protectedMetadata(value, resource) {
  const advertisedResource = metadataPolicy("resource", value);
  const normalizedResource = canonicalizeResourceIndicator(advertisedResource);
  metadataPolicy("resource_bound", value, resource, normalizedResource);
  return { ...value, resource: normalizedResource };
}

function authorizationMetadata(value, issuer) {
  metadataPolicy("issuer", value, issuer);
  const endpoints = metadataPolicy("endpoints", value);
  for (const [index, field] of ["authorization_endpoint", "token_endpoint", "registration_endpoint"].entries()) {
    if (index >= endpoints.length) break;
    let endpoint;
    try {
      if (typeof endpoints[index] !== "string") throw new Error();
      endpoint = new URL(endpoints[index]);
    } catch { throw new Error(`Authorization server metadata ${field} must be an absolute URL`); }
    admitUrl(endpoint, `Authorization server metadata ${field}`);
  }
  metadataPolicy("arrays", value);
  return value;
}

async function fetchMetadata(fetchImpl, location, label, parentSignal) {
  parentSignal?.throwIfAborted();
  const deadline = AbortSignal.timeout(10_000);
  const signal = parentSignal === undefined ? deadline : AbortSignal.any([deadline, parentSignal]);
  const response = await fetchMcpResponse(fetchImpl ?? globalThis.fetch, location, {
    method: "GET", headers: { Accept: "application/json" }, signal
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new OAuthMetadataError(label === "Protected resource metadata" ? "protected-resource" : "authorization-server", `${label} request failed (${`${response.status} ${response.statusText}`.trim()})`, response.status);
  }
  const text = await readBoundedResponseText(response, 1024 * 1024, undefined, signal);
  try { return JSON.parse(text); }
  catch { throw new Error(`${label} response must be valid JSON`); }
}

function cachedDiscovery(value, resource) {
  const [resourceMetadataUrl, advertisedIssuer, authorizationServerMetadataUrl] = metadataPolicy("cache_shape", value, resource);
  const resourceMetadata = protectedMetadata(value.resourceMetadata, resource);
  admitUrl(new URL(resourceMetadataUrl), "Cached OAuth discovery metadata location");
  const { issuer, locations } = issuerLocations(advertisedIssuer);
  metadataPolicy("cache_issuer", resourceMetadata, issuer);
  metadataPolicy("cache_location", { locations }, authorizationServerMetadataUrl);
  const authorizationServerMetadata = authorizationMetadata(value.authorizationServerMetadata, issuer);
  return structuredClone({ resource, resourceMetadataUrl, resourceMetadata, authorizationServer: issuer,
    authorizationServerMetadataUrl, authorizationServerMetadata });
}

async function waitForCache(operation, signal) {
  if (signal === undefined) return operation;
  let abort;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(operation).then(resolve, reject);
      if (signal.aborted) abort();
    });
  } finally { signal.removeEventListener("abort", abort); }
}

export class OAuthMetadataDiscovery {
  #fetch;
  #cache;
  #index = new native.NativeDiscoveryCache();
  #snapshots = new Map();
  constructor({ fetch, cache } = {}) {
    this.#fetch = fetch;
    this.#cache = cache;
  }
  #retain(resource, result) {
    const snapshot = structuredClone(result);
    const [slot, previous] = this.#index.insert(resource);
    if (previous !== null) this.#snapshots.delete(previous);
    this.#snapshots.set(slot, snapshot);
  }
  async discover(resourceUrl, { resourceMetadataUrl, signal } = {}) {
    signal?.throwIfAborted();
    const resource = canonicalizeResourceIndicator(resourceUrl);
    const firstLocation = resolveProtectedResourceMetadataUrl(resourceUrl, resourceMetadataUrl);
    const memorySlot = this.#index.get(resource);
    if (memorySlot !== null && memorySlot !== undefined && resourceMetadataUrl === undefined) {
      return structuredClone(this.#snapshots.get(memorySlot));
    }
    const shared = resourceMetadataUrl === undefined ? await waitForCache(this.#cache?.get(resource), signal) : undefined;
    signal?.throwIfAborted();
    if (shared !== null && shared !== undefined && resourceMetadataUrl === undefined) {
      try {
        const result = cachedDiscovery(shared, resource);
        this.#retain(resource, result);
        return result;
      } catch { await waitForCache(this.#cache?.delete?.(resource), signal); }
    }
    const resourceLocations = new Set([firstLocation]);
    if (resourceMetadataUrl === undefined) resourceLocations.add(new URL("/.well-known/oauth-protected-resource", resource).toString());
    let resourceMetadata;
    let resourceMetadataLocation;
    let lastError;
    for (const location of resourceLocations) {
      try {
        resourceMetadata = protectedMetadata(await fetchMetadata(this.#fetch, location, "Protected resource metadata", signal), resource);
        resourceMetadataLocation = location;
        break;
      } catch (error) { signal?.throwIfAborted(); lastError = error; }
    }
    if (resourceMetadata === undefined) throw lastError;
    const errors = [];
    for (const advertisedIssuer of resourceMetadata.authorization_servers) {
      const { issuer, locations } = issuerLocations(advertisedIssuer);
      for (const location of locations) {
        try {
          const metadata = authorizationMetadata(await fetchMetadata(this.#fetch, location, "Authorization server metadata", signal), issuer);
          const result = { resource: resourceMetadata.resource, resourceMetadataUrl: resourceMetadataLocation,
            resourceMetadata, authorizationServer: issuer, authorizationServerMetadataUrl: location,
            authorizationServerMetadata: metadata };
          this.#retain(resource, result);
          await waitForCache(this.#cache?.set(resource, structuredClone(result)), signal);
          return result;
        } catch (error) { signal?.throwIfAborted(); errors.push(`${location}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    throw new OAuthMetadataError("authorization-server", `Unable to load authorization server metadata for ${resource}: ${errors.join("; ")}`);
  }
}

export async function discoverOAuthMetadata(resourceUrl, options = {}) {
  const discovery = new OAuthMetadataDiscovery(options);
  return discovery.discover(resourceUrl, options);
}

export function parseBearerWwwAuthenticateHeader(headerValue) {
  if (headerValue === null) return null;
  const entries = native.parseBearerChallenge(headerValue);
  if (entries === null) return null;
  const params = Object.create(null);
  for (const [name, value] of entries) {
    const parameterName = name.toLowerCase();
    if (Object.hasOwn(params, parameterName)) throw new Error("Bearer challenge must not repeat authentication parameters");
    params[parameterName] = value;
  }
  return { scheme: "Bearer", params, raw: headerValue };
}
