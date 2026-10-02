import { fetchMcpResponse } from "../http-fetch.js";
import { readBoundedResponseText } from "../http-response.js";
import { createOAuthFormRequest } from "./oauth-form.js";
import { readOAuthJsonObjectResponse } from "./token-endpoint.js";
import type { OAuthMetadataFetch, OAuthTokenEndpointAuthMethod } from "./types.js";

/** RFC 7009 revocation; no retries or host persistence changes. */
export async function revokeOAuthToken(input: {
  revocationEndpoint: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod?: OAuthTokenEndpointAuthMethod;
  token: string;
  tokenTypeHint?: "access_token" | "refresh_token";
  fetch: OAuthMetadataFetch;
  signal?: AbortSignal;
}): Promise<void> {
  if (typeof input.token !== "string" || input.token.trim() === "")
    throw new Error("OAuth revocation requires a token");
  const { body, headers } = createOAuthFormRequest({
    ...input,
    params: { token: input.token, ...(input.tokenTypeHint === undefined ? {} : { token_type_hint: input.tokenTypeHint }) }
  });
  input.signal?.throwIfAborted();
  const deadline = AbortSignal.timeout(30_000);
  const signal = input.signal === undefined ? deadline : AbortSignal.any([input.signal, deadline]);
  const response = await fetchMcpResponse(input.fetch, input.revocationEndpoint, {
    method: "POST", headers, body: body.toString(), signal
  });
  if (!response.ok) await readOAuthJsonObjectResponse(response, signal);
  // RFC 7009 intentionally permits an empty body, including for an invalid token.
  await readBoundedResponseText(response, 1024 * 1024, undefined, signal);
}
