import { generateCodeVerifier, generateCodeChallenge, fetchMcpResponse, readBoundedResponseText, OAuthError, isRetryableOAuthError } from "../src/index.js";
const verifier: string = generateCodeVerifier();
const challenge: string = generateCodeChallenge(verifier);
void challenge;
const reply: Promise<Response> = fetchMcpResponse(fetch, new URL("https://example.test"), { method: "POST" });
const text: Promise<string> = readBoundedResponseText(new Response(null), 1024, new Set(), new AbortController().signal);
void reply;
void text;
const error: unknown = new OAuthError({ error: "server_error" }, 503);
if (isRetryableOAuthError(error)) { const retryable: boolean = error.retryable; void retryable; }
