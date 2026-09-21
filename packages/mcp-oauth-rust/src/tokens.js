import { createRequire } from "node:module";
import { fetchMcpResponse, readBoundedResponseText } from "./http.js";
import { canonicalizeResourceIndicator } from "./resource.js";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");

export class OAuthError extends Error {
  constructor(shape, status, outcomeKnown = true) {
    const description = Object.hasOwn(shape, "error_description") ? shape.error_description : undefined;
    const uri = Object.hasOwn(shape, "error_uri") ? shape.error_uri : undefined;
    super(description ?? (outcomeKnown ? shape.error : `OAuth HTTP response did not contain a valid error (HTTP ${status})`));
    this.name = "OAuthError";
    this.error = shape.error;
    this.errorDescription = description;
    this.errorUri = uri;
    this.error_description = description;
    this.error_uri = uri;
    this.status = status;
    this.outcomeKnown = outcomeKnown;
    this.retryable = native.isRetryableTokenError(this.error, status);
    this.terminal = !this.retryable;
  }
}
export function isRetryableOAuthError(error) {
  return error instanceof OAuthError && native.isRetryableTokenError(error.error, error.status);
}
export async function readOAuthJsonObjectResponse(response, signal) {
  let text;
  try {
    text = await readBoundedResponseText(response, 1024 * 1024, undefined, signal);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof Error && error.message.startsWith("HTTP response exceeds ")) throw error;
    if (response.ok) throw new Error("OAuth response must be a JSON object");
    text = "";
  }
  let result;
  try {
    result = native.readTokenResponse(text, response.ok, response.status);
  } catch (error) {
    throw new Error(error.message);
  }
  if (Object.hasOwn(result, "error")) {
    const shape = result.error;
    throw new OAuthError(
      {
        error: shape.error,
        error_description: Object.hasOwn(shape, "error_description")
          ? shape.error_description
          : undefined,
        error_uri: Object.hasOwn(shape, "error_uri") ? shape.error_uri : undefined
      },
      response.status,
      shape.outcomeKnown
    );
  }
  return result.payload;
}
export async function exchangeAuthorizationCode(input) {
  return requestTokens(input, {
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri
  });
}
export async function refreshAccessToken(input) {
  return requestTokens(input, { grant_type: "refresh_token", refresh_token: input.refreshToken });
}
async function requestTokens(input, grant) {
  const resource = canonicalizeResourceIndicator(input.resource);
  let plan;
  try {
    plan = native.tokenAuthPlan(
      JSON.stringify({ ...grant, resource }),
      input.clientId,
      input.clientSecret,
      input.tokenEndpointAuthMethod
    );
  } catch (error) {
    throw new Error(error.message);
  }
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  if (Object.hasOwn(plan, "authorization")) headers.set("Authorization", plan.authorization);
  input.signal?.throwIfAborted();
  const deadline = AbortSignal.timeout(30_000),
    signal = input.signal === undefined ? deadline : AbortSignal.any([input.signal, deadline]);
  const response = await fetchMcpResponse(input.fetch, input.tokenEndpoint, {
    method: "POST",
    headers,
    body: plan.body,
    signal
  });
  const payload = await readOAuthJsonObjectResponse(response, signal);
  let fields;
  try {
    fields = new native.NativeTokenFields(JSON.stringify(payload));
  } catch (error) {
    throw new Error(error.message);
  }
  const now = fields.needsClock ? input.now() : undefined;
  let result;
  try {
    result = fields.complete(now);
  } catch (error) {
    throw new Error(error.message);
  }
  return {
    accessToken: result.accessToken,
    refreshToken: Object.hasOwn(result, "refreshToken") ? result.refreshToken : undefined,
    tokenType: result.tokenType,
    expiresAt: result.expiresAt,
    scope: Object.hasOwn(result, "scope") ? result.scope : undefined
  };
}
