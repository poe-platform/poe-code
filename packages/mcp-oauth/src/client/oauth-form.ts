import { normalizeOAuthTokenEndpointAuthMethod } from "./token-auth-method.js";
import type { OAuthTokenEndpointAuthMethod } from "./types.js";

export function createOAuthFormRequest(input: {
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod?: OAuthTokenEndpointAuthMethod;
  params: Record<string, string>;
}): { body: URLSearchParams; headers: Headers } {
  const method = normalizeOAuthTokenEndpointAuthMethod(input.tokenEndpointAuthMethod) ??
    (input.clientSecret === undefined ? "none" : "client_secret_post");
  if (method !== "none" && (input.clientSecret === undefined || input.clientSecret.trim() === ""))
    throw new Error("OAuth token endpoint authentication requires a client secret");
  const body = new URLSearchParams(input.params);
  const headers = new Headers({ Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" });
  if (method === "client_secret_basic") {
    const encoded = new URLSearchParams({ credential: input.clientId }).toString().slice("credential=".length);
    const encodedSecret = new URLSearchParams({ credential: input.clientSecret! }).toString().slice("credential=".length);
    headers.set("Authorization", `Basic ${btoa(`${encoded}:${encodedSecret}`)}`);
  } else {
    body.set("client_id", input.clientId);
    if (method === "client_secret_post") body.set("client_secret", input.clientSecret!);
  }

  return { body, headers };
}
