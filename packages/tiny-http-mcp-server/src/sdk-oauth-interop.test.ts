import "../vitest.setup.js";
/**
 * Official SDK OAuth interop coverage for the survey in
 * docs/plans/research/mcp-oauth-implementations.md.
 *
 * This test is validated against the installed @modelcontextprotocol/sdk 1.26.0
 * OAuthClientProvider surface. If that interface drifts again, pin the package
 * version that matches the survey before updating this spec.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  UnauthorizedError,
  type OAuthClientProvider
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { createMcpOAuthTestServer } from "tiny-http-mcp-oauth-test-server";
import { nodeFetch } from "./testing.js";

interface LoggedRequest {
  method: string;
  url: string;
}

interface LoopbackRedirectHandle {
  callbackUrls: string[];
  redirectUrl: string;
  close(): Promise<void>;
}

function createSdkClient(): Client {
  return new Client({
    name: "official-sdk-oauth-test-client",
    version: "1.0.0"
  });
}

async function listenLoopbackRedirectServer(): Promise<LoopbackRedirectHandle> {
  const callbackUrls: string[] = [];
  const server = http.createServer((request, response) => {
    callbackUrls.push(new URL(request.url ?? "/", "http://127.0.0.1").toString());
    response.statusCode = 200;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end("callback received");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected redirect server to bind to a TCP port");
  }

  const redirectUrl = new URL("http://127.0.0.1");
  redirectUrl.port = String((address as AddressInfo).port);
  redirectUrl.pathname = "/oauth/callback";

  return {
    callbackUrls,
    redirectUrl: redirectUrl.toString(),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error !== undefined ? reject(error) : resolve()));
        server.closeAllConnections();
      })
  };
}

function serializeBody(body: BodyInit | null | undefined): string | Uint8Array | undefined {
  if (body == null) return undefined;
  if (typeof body === "string" || body instanceof Uint8Array) return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new Error(`Unsupported test fetch body: ${(body as object).constructor.name}`);
}

async function loggedFetch(
  requests: LoggedRequest[],
  input: string | URL | Request,
  init: RequestInit = {}
): Promise<Response> {
  if (input instanceof Request) {
    const body =
      input.body === null || input.method === "GET" || input.method === "HEAD"
        ? undefined
        : await input.clone().text();
    requests.push({ method: input.method, url: input.url });
    return nodeFetch(input.url, { method: input.method, headers: input.headers, body, ...init });
  }

  requests.push({ method: init.method ?? "GET", url: String(input) });
  return nodeFetch(input, { ...init, body: serializeBody(init.body) });
}

class TestOAuthClientProvider implements OAuthClientProvider {
  private readonly tokenStore = new Map<string, OAuthTokens>();
  private clientInfo: OAuthClientInformationMixed | undefined;
  private currentCodeVerifier: string | undefined;
  private currentAuthorizationCode: string | undefined;
  private tamperNextAccessTokenOnSave = false;

  public authorizationRedirects = 0;
  public lastAuthorizationUrl: URL | undefined;

  public constructor(
    private readonly redirectHandle: LoopbackRedirectHandle,
    private readonly requests: LoggedRequest[]
  ) {}

  public get redirectUrl(): string {
    return this.redirectHandle.redirectUrl;
  }

  public get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectHandle.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_name: "official-sdk-oauth-test-client",
      scope: "mcp.read"
    };
  }

  public state(): string {
    return "sdk-oauth-state";
  }

  public clientInformation():
    | OAuthClientInformationMixed
    | undefined
    | Promise<OAuthClientInformationMixed | undefined> {
    return this.clientInfo;
  }

  public saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.clientInfo = clientInformation;
  }

  public tokens(): OAuthTokens | undefined {
    return this.tokenStore.get("default");
  }

  public saveTokens(tokens: OAuthTokens): void {
    const storedTokens = this.tamperNextAccessTokenOnSave
      ? {
          ...tokens,
          access_token: `tampered-${tokens.access_token}`
        }
      : tokens;

    this.tamperNextAccessTokenOnSave = false;
    this.tokenStore.set("default", storedTokens);
  }

  public async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.authorizationRedirects += 1;

    const approvalUrl = new URL(authorizationUrl);
    this.lastAuthorizationUrl = approvalUrl;

    const authorizationResponse = await loggedFetch(this.requests, approvalUrl);
    if (authorizationResponse.status !== 302) {
      throw new Error(
        `Expected authorization server redirect, got ${authorizationResponse.status}`
      );
    }

    const callbackUrl = authorizationResponse.headers.get("location");
    if (callbackUrl === null) {
      throw new Error("Expected authorization redirect location");
    }

    const callbackResponse = await loggedFetch(this.requests, callbackUrl);
    if (!callbackResponse.ok) {
      throw new Error(`Expected callback redirect to succeed, got ${callbackResponse.status}`);
    }

    const code = new URL(callbackUrl).searchParams.get("code");
    if (code === null) {
      throw new Error("Expected authorization code in callback redirect");
    }

    this.currentAuthorizationCode = code;
  }

  public saveCodeVerifier(codeVerifier: string): void {
    this.currentCodeVerifier = codeVerifier;
  }

  public codeVerifier(): string {
    if (this.currentCodeVerifier === undefined) {
      throw new Error("Expected code verifier to be set before token exchange");
    }

    return this.currentCodeVerifier;
  }

  public consumeAuthorizationCode(): string {
    if (this.currentAuthorizationCode === undefined) {
      throw new Error("Expected authorization code after redirect");
    }

    const code = this.currentAuthorizationCode;
    this.currentAuthorizationCode = undefined;
    return code;
  }

  public requireTokens(): OAuthTokens {
    const tokens = this.tokens();
    if (tokens === undefined) {
      throw new Error("Expected tokens to be stored");
    }

    return tokens;
  }

  public setTokens(tokens: OAuthTokens): void {
    this.tokenStore.set("default", tokens);
  }

  public tamperNextSavedAccessToken(): void {
    this.tamperNextAccessTokenOnSave = true;
  }
}

function isClientOAuthFlowRequest(url: string): boolean {
  const pathname = new URL(url).pathname;

  return (
    pathname.includes("/.well-known/oauth-authorization-server") ||
    pathname.endsWith("/register") ||
    pathname.endsWith("/authorize") ||
    pathname.endsWith("/token")
  );
}

describe("official SDK OAuth interop", () => {
  const cleanups = new Set<() => Promise<void>>();

  afterEach(async () => {
    for (const cleanup of [...cleanups].reverse()) {
      await cleanup();
    }

    cleanups.clear();
  });

  it("drives discovery, DCR, authorization, token exchange, reuse, and typed 401 errors through the official SDK", async () => {
    const requests: LoggedRequest[] = [];
    const redirectHandle = await listenLoopbackRedirectServer();
    cleanups.add(redirectHandle.close);

    const provider = new TestOAuthClientProvider(redirectHandle, requests);
    const fixture = createMcpOAuthTestServer({
      autoApprove: true,
      scopes: ["mcp.read"]
    });
    const handle = await fixture.listen({ port: 0, hostname: "127.0.0.1" });
    cleanups.add(handle.close);

    const authTransport = new StreamableHTTPClientTransport(new URL(handle.mcpUrl), {
      authProvider: provider,
      fetch: (input, init) => loggedFetch(requests, input, init)
    });
    cleanups.add(async () => {
      await authTransport.close();
    });

    const authClient = createSdkClient();

    await expect(authClient.connect(authTransport)).rejects.toBeInstanceOf(UnauthorizedError);

    expect(provider.authorizationRedirects).toBe(1);
    expect(provider.lastAuthorizationUrl?.pathname.endsWith("/authorize")).toBe(true);
    expect(redirectHandle.callbackUrls).toHaveLength(1);

    await authTransport.finishAuth(provider.consumeAuthorizationCode());

    expect(provider.clientInformation()).toMatchObject({
      client_id: expect.any(String)
    });
    expect(provider.tokens()).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      token_type: "Bearer"
    });

    const client = createSdkClient();
    const transport = new StreamableHTTPClientTransport(new URL(handle.mcpUrl), {
      authProvider: provider,
      fetch: (input, init) => loggedFetch(requests, input, init)
    });
    cleanups.add(async () => {
      await client.close();
    });

    await client.connect(transport);

    const firstResult = await client.callTool({
      name: "echo",
      arguments: {
        text: "official sdk"
      }
    });

    expect(firstResult).toEqual({
      content: [{ type: "text", text: "official sdk" }]
    });

    const authorizationServerUrl = new URL(handle.oauth.issuer);
    const authorizationMetadataUrl = new URL(
      `/.well-known/oauth-authorization-server${authorizationServerUrl.pathname}`,
      authorizationServerUrl.origin
    ).toString();
    const authorizationPathPrefix =
      authorizationServerUrl.pathname === "/" ? "" : authorizationServerUrl.pathname;
    const authorizePath = `${authorizationPathPrefix}/authorize`;

    const prmRequestIndex = requests.findIndex((request) => request.url === handle.prmUrl);
    const metadataRequestIndex = requests.findIndex(
      (request) => request.method === "GET" && request.url === authorizationMetadataUrl
    );
    const registerRequestIndex = requests.findIndex(
      (request) => request.method === "POST" && request.url === `${handle.oauth.issuer}/register`
    );
    const authorizeRequestIndex = requests.findIndex(
      (request) => request.method === "GET" && new URL(request.url).pathname === authorizePath
    );
    const tokenRequestIndex = requests.findIndex(
      (request) => request.method === "POST" && request.url === `${handle.oauth.issuer}/token`
    );

    expect(prmRequestIndex).toBeGreaterThanOrEqual(0);
    expect(metadataRequestIndex).toBeGreaterThan(prmRequestIndex);
    expect(registerRequestIndex).toBeGreaterThan(metadataRequestIndex);
    expect(authorizeRequestIndex).toBeGreaterThan(registerRequestIndex);
    expect(tokenRequestIndex).toBeGreaterThan(authorizeRequestIndex);

    const oauthFlowRequestsAfterFirstCall = handle.oauth.requestLog
      .map((request) => request.url)
      .filter(isClientOAuthFlowRequest);
    const secondResult = await client.callTool({
      name: "echo",
      arguments: {
        text: "cached token"
      }
    });

    expect(secondResult).toEqual({
      content: [{ type: "text", text: "cached token" }]
    });
    expect(
      handle.oauth.requestLog.map((request) => request.url).filter(isClientOAuthFlowRequest)
    ).toEqual(oauthFlowRequestsAfterFirstCall);
    expect(provider.authorizationRedirects).toBe(1);

    const savedTokens = provider.requireTokens();
    provider.setTokens({
      ...savedTokens,
      access_token: `tampered-${savedTokens.access_token}`
    });
    provider.tamperNextSavedAccessToken();

    await expect(
      client.callTool({
        name: "echo",
        arguments: {
          text: "tampered token"
        }
      })
    ).rejects.toMatchObject<Partial<StreamableHTTPError>>({
      code: 401,
      message: expect.stringContaining("successful authentication")
    });
  });
});
