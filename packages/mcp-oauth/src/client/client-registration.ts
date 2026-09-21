import type { OAuthClientRegistration, StoredOAuthClient } from "./types.js";
import { normalizeOAuthScope } from "./scope.js";
import { normalizeOAuthTokenEndpointAuthMethod } from "./token-auth-method.js";

/** Validate and copy a bounded JSON DCR response without quoting credential input. */
export function parseOAuthClientRegistration(value: unknown): OAuthClientRegistration {
  const invalid = () => new Error("Invalid OAuth client registration metadata");
  let nodes = 0;
  function copy(input: unknown, depth: number): unknown {
    if (++nodes > 20_000 || depth > 64) throw invalid();
    if (input === null || typeof input === "boolean" || typeof input === "string") return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (typeof input !== "object" || input === null) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Array.isArray(input)) {
      const length = descriptors.length?.value as number;
      if (length > 20_000) throw invalid();
      const result: unknown[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) throw invalid();
        result.push(copy(descriptor.value, depth + 1));
      }
      return result;
    }
    if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) throw invalid();
    return Object.fromEntries(Object.entries(descriptors).filter(([, descriptor]) => descriptor.enumerable).map(([key, descriptor]) => {
      if (!Object.hasOwn(descriptor, "value")) throw invalid();
      return [key, copy(descriptor.value, depth + 1)];
    }));
  }
  let result: unknown;
  try { result = copy(value, 0); } catch { throw invalid(); }
  if (typeof result !== "object" || result === null || Array.isArray(result)) throw invalid();
  const record = result as Record<string, unknown>;
  if (!Object.hasOwn(record, "client_id") || typeof record.client_id !== "string" || record.client_id.trim() === "")
    throw new Error("OAuth client registration response missing client_id");
  for (const key of ["client_id", "client_secret", "token_endpoint_auth_method", "application_type", "client_name", "client_uri", "logo_uri", "scope",
    "tos_uri", "policy_uri", "jwks_uri", "software_id", "software_version", "software_statement", "registration_access_token", "registration_client_uri", "issuer"]) {
    if (Object.hasOwn(record, key) && record[key] !== null && typeof record[key] !== "string") throw invalid();
  }
  if (typeof record.client_secret === "string" && record.client_secret.trim() === "") throw invalid();
  for (const key of ["redirect_uris", "grant_types", "response_types", "contacts"]) {
    const entry = record[key];
    if (Object.hasOwn(record, key) && entry !== null && (!Array.isArray(entry) || entry.some(item => typeof item !== "string"))) throw invalid();
  }
  for (const key of ["client_id_issued_at", "client_secret_expires_at"]) {
    const entry = record[key];
    if (Object.hasOwn(record, key) && entry !== null && (typeof entry !== "number" || !Number.isSafeInteger(entry) || entry < 0)) throw invalid();
  }
  try { normalizeOAuthScope(Object.hasOwn(record, "scope") && record.scope !== null ? record.scope : undefined); } catch { throw invalid(); }
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > 64 * 1024) throw invalid();
  return record as OAuthClientRegistration;
}

export function normalizeStoredOAuthClient(value: unknown): StoredOAuthClient | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const clientId = Object.hasOwn(record, "clientId") ? record.clientId : undefined;
  const clientSecret = Object.hasOwn(record, "clientSecret") ? record.clientSecret : undefined;
  if (typeof clientId !== "string" || clientId.trim() === "" ||
    (clientSecret !== undefined && (typeof clientSecret !== "string" || clientSecret.trim() === ""))) return null;
  const client: StoredOAuthClient = { clientId: clientId.trim(), ...(clientSecret === undefined ? {} : { clientSecret: (clientSecret as string).trim() }) };
  const method = normalizeOAuthTokenEndpointAuthMethod(Object.hasOwn(record, "tokenEndpointAuthMethod") ? record.tokenEndpointAuthMethod : undefined);
  if (Object.hasOwn(record, "registration") && record.registration !== undefined) {
    const registration = parseOAuthClientRegistration(record.registration);
    const registeredSecret = Object.hasOwn(registration, "client_secret") ? registration.client_secret?.trim() : undefined;
    if (registration.client_id.trim() !== client.clientId || registeredSecret !== client.clientSecret)
      throw new Error("OAuth client registration does not match the client identity");
    client.registration = registration;
    const registrationMethod = normalizeOAuthTokenEndpointAuthMethod(Object.hasOwn(registration, "token_endpoint_auth_method") ? registration.token_endpoint_auth_method : undefined);
    if (method !== undefined && registrationMethod !== undefined && method !== registrationMethod)
      throw new Error("OAuth token endpoint authentication conflicts with the client registration");
    if (registrationMethod !== undefined) client.tokenEndpointAuthMethod = registrationMethod;
  }
  if (method !== undefined) client.tokenEndpointAuthMethod = method;
  return client;
}
