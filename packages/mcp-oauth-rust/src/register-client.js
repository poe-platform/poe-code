import { createRequire } from "node:module";
import { fetchMcpResponse } from "./http.js";
import { readOAuthJsonObjectResponse } from "./tokens.js";
import { parseOAuthClientRegistration } from "./registration.js";
import { loopbackTarget, validateHostedOAuthRedirect } from "./loopback.js";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");

export async function registerOAuthClient(input) {
  if (input.redirectUri !== undefined && input.redirectUris !== undefined)
    throw new Error("Specify either redirectUri or redirectUris, not both");
  const redirects = input.redirectUris === undefined ? [input.redirectUri] : input.redirectUris;
  if (!Array.isArray(redirects) || redirects.length === 0 || redirects.length > 32)
    throw new Error("OAuth registration requires one to 32 redirect URIs");
  const redirectUris = [];
  const seen = new Set();
  for (const redirectUri of redirects) {
    if (typeof redirectUri !== "string" || redirectUri.length === 0)
      throw new Error("Invalid OAuth registration redirect URI");
    if (seen.has(redirectUri)) throw new Error("Duplicate OAuth registration redirect URI");
    if (new URL(redirectUri).protocol === "https:") validateHostedOAuthRedirect(redirectUri);
    else loopbackTarget({ redirectUri });
    seen.add(redirectUri);
    redirectUris.push(redirectUri);
  }
  const metadata = {};
  for (const key of ["clientName", "scope", "softwareId", "softwareVersion"]) {
    const descriptor = input.metadata === undefined ? undefined : Object.getOwnPropertyDescriptor(input.metadata, key);
    if (descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string") metadata[key] = descriptor.value;
  }
  const method = native.providerTokenMethod(JSON.stringify({ method: input.tokenEndpointAuthMethod }));
  if (Object.hasOwn(method, "error")) throw new Error(method.error);
  const registration = native.providerRegistrationBody(JSON.stringify(metadata), redirectUris[0]);
  registration.redirect_uris = redirectUris;
  registration.token_endpoint_auth_method = method.value ?? "none";
  const body = JSON.stringify(registration);
  if (new TextEncoder().encode(body).byteLength > 65_536) throw new Error("OAuth registration request is too large");
  input.signal?.throwIfAborted();
  const deadline = AbortSignal.timeout(30_000);
  const signal = input.signal === undefined ? deadline : AbortSignal.any([input.signal, deadline]);
  const response = await fetchMcpResponse(input.fetch, input.registrationEndpoint, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body, signal
  });
  return parseOAuthClientRegistration(await readOAuthJsonObjectResponse(response, signal));
}
