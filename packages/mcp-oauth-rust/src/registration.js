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
  identity.tokenEndpointAuthMethod = project(
    Object.hasOwn(value, "tokenEndpointAuthMethod") ? value.tokenEndpointAuthMethod : undefined
  );
  unwrap(identity);
  if (Object.hasOwn(value, "registration") && value.registration !== undefined)
    identity.registration = parseOAuthClientRegistration(value.registration);
  return unwrap(identity);
}
