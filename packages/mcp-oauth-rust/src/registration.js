import { loopbackTarget } from "./loopback.js";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
export function parseOAuthClientRegistration(value) {
  let result;
  try {
    result = native.parseClientRegistration(value);
  } catch {
    throw new Error("Invalid OAuth client registration metadata");
  }
  if (Object.hasOwn(result, "error")) throw new Error(result.error);
  return result.value;
}

export function normalizeStoredOAuthClient(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const clientId = Object.hasOwn(value, "clientId") ? value.clientId : undefined;
  const clientSecret = Object.hasOwn(value, "clientSecret") ? value.clientSecret : undefined;
  const project = (input) =>
    input === undefined || input === null || typeof input === "string" ? input : false;
  const unwrap = (record) => {
    const result = native.normalizeStoredClient(JSON.stringify(record));
    if (Object.hasOwn(result, "error")) throw new Error(result.error);
    return result.value;
  };
  const identity = { clientId: project(clientId), clientSecret: project(clientSecret) };
  if (unwrap(identity) === null) return null;
  const redirect = Object.hasOwn(value, "requestedRedirectUri")
    ? value.requestedRedirectUri
    : undefined;
  if (redirect !== undefined) {
    try {
      if (typeof redirect !== "string") throw new Error("Invalid redirect identity");
      loopbackTarget({ redirectUri: redirect });
    } catch {
      throw new Error("Invalid stored OAuth registration redirect identity");
    }
    identity.requestedRedirectUri = redirect;
  }
  identity.tokenEndpointAuthMethod = project(
    Object.hasOwn(value, "tokenEndpointAuthMethod") ? value.tokenEndpointAuthMethod : undefined
  );
  unwrap(identity);
  if (Object.hasOwn(value, "registration") && value.registration !== undefined)
    identity.registration = parseOAuthClientRegistration(value.registration);
  identity.registrationOwnership = project(
    Object.hasOwn(value, "registrationOwnership") ? value.registrationOwnership : undefined
  );
  return unwrap(identity);
}

export function registrationMatchesRedirect(client, requestedUri, fresh = false) {
  if (client.requestedRedirectUri !== undefined)
    return client.requestedRedirectUri === requestedUri;
  const redirects = client.registration?.redirect_uris;
  if (redirects === undefined || redirects === null || redirects.length === 0) return true;
  return redirects.some((returnedUri) => {
    if (returnedUri === requestedUri) return true;
    if (!fresh) return false;
    let returned, requested;
    try {
      returned = new URL(returnedUri);
      requested = new URL(requestedUri);
    } catch {
      return false;
    }
    const returnedHost = returned.hostname,
      returnedNoPort = returned.port === "",
      requestedHost = requested.hostname;
    const requestedHttp = requested.protocol === "http:",
      returnedHttp = returned.protocol === "http:";
    returned.hostname = requestedHost;
    returned.port = requested.port;
    return native.registrationRedirectPairAllowed(
      requestedHttp,
      returnedHttp,
      requestedHost,
      returnedHost,
      returnedNoPort,
      returned.href === requested.href
    );
  });
}
