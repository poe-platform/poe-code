import { createRequire } from "node:module";
import { fetchMcpResponse } from "./http.js";
import { readOAuthJsonObjectResponse } from "./tokens.js";
import { parseOAuthClientRegistration } from "./registration.js";
import { loopbackTarget, validateHostedOAuthRedirect } from "./loopback.js";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");

export async function registerOAuthClient(input) {
  if (new URL(input.redirectUri).protocol === "https:") validateHostedOAuthRedirect(input.redirectUri);
  else loopbackTarget({ redirectUri: input.redirectUri });
  const metadata = {};
  for (const key of ["clientName", "scope", "softwareId", "softwareVersion"]) {
    const descriptor = input.metadata === undefined ? undefined : Object.getOwnPropertyDescriptor(input.metadata, key);
    if (descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string") metadata[key] = descriptor.value;
  }
  const method = native.providerTokenMethod(JSON.stringify({ method: input.tokenEndpointAuthMethod }));
  if (Object.hasOwn(method, "error")) throw new Error(method.error);
  const registration = native.providerRegistrationBody(JSON.stringify(metadata), input.redirectUri);
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
