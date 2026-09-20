import { generateCodeVerifier, generateCodeChallenge, fetchMcpResponse, readBoundedResponseText, OAuthError, isRetryableOAuthError } from "../dist/index.js";
const verifier: string = generateCodeVerifier();
const challenge: string = generateCodeChallenge(verifier);
void challenge;
const reply: Promise<Response> = fetchMcpResponse(fetch, new URL("https://example.test"), { method: "POST" });
const text: Promise<string> = readBoundedResponseText(new Response(null), 1024, new Set(), new AbortController().signal);
void reply;
void text;
const error: unknown = new OAuthError({ error: "server_error" }, 503);
if (isRetryableOAuthError(error)) { const retryable: boolean = error.retryable; void retryable; }
import { buildSuccessPage, extractCodeFromInput, createLoopbackAuthorizationSession, type LoopbackAuthorizationSession } from "../dist/index.js";
const page: string = buildSuccessPage({title:"Connected",body:"Return to the terminal"});
const code: string | null = extractCodeFromInput("code");
const loopback: Promise<LoopbackAuthorizationSession> = createLoopbackAuthorizationSession({callbackPath:"/oauth/callback",readLine:async()=>"code",openBrowser:async()=>undefined});
void page; void code; void loopback;
import { createAuthStoreSessionStore, canonicalizeResourceIndicator, type OAuthSessionStore } from "../dist/index.js";
const sessions: OAuthSessionStore = createAuthStoreSessionStore({backend:"file",fileStore:{salt:"example"}});
const resource: string = canonicalizeResourceIndicator(new URL("https://example.test/mcp#fragment"));
void sessions; void resource;
