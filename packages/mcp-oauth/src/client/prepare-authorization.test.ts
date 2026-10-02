import { expect, it, vi } from "vitest";
import * as api from "../index.browser.js";
import type { OAuthDiscoveryResult } from "./types.js";

const resource = "https://mcp.example/mcp";
const issuer = "https://auth.example";
function fixture() {
  const discovery: OAuthDiscoveryResult = {
    resource, resourceMetadataUrl: `${resource}/metadata`,
    resourceMetadata: { resource, authorization_servers: [issuer] },
    authorizationServer: issuer, authorizationServerMetadataUrl: `${issuer}/metadata`,
    authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
      response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] }
  };
  return { resource, redirectUri: "https://app.example/callback", client: { clientId: "client" },
    discover: vi.fn(async () => discovery), now: () => 1000, scope: "read", statePrefix: "native_" };
}

it("prepares a private transaction for a durable host without persisting or exchanging", async () => {
  const options = fixture();
  const { authorizationUrl, transaction } = await api.prepareRemoteMcpAuthorization(options);
  const url = new URL(authorizationUrl);
  expect(transaction.state).toMatch(/^native_[A-Za-z0-9_-]{43}$/);
  expect(url.searchParams.get("state")).toBe(transaction.state);
  expect(url.searchParams.get("code_challenge")).toBe(api.generateCodeChallenge(transaction.codeVerifier));
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("resource")).toBe(resource);
  expect(transaction.expiresAt).toBe(601000);
  expect(transaction.session.client.registrationOwnership).toBe("caller");
  expect(transaction.session.tokens).toBeUndefined();
  expect(options.discover).toHaveBeenCalledOnce();
  expect(authorizationUrl).not.toContain(transaction.codeVerifier);
});

it("snapshots routing prefix and client before asynchronous discovery", async () => {
  const options = fixture();
  const discover = options.discover;
  options.discover = vi.fn(async () => {
    options.client.clientId = "changed";
    options.statePrefix = "changed_";
    return discover();
  });
  const prepared = await api.prepareRemoteMcpAuthorization(options);
  expect(prepared.transaction.state.startsWith("native_")).toBe(true);
  expect(prepared.transaction.session.client.clientId).toBe("client");
});

it.each(["bad prefix", "bad?", "a".repeat(33)])("rejects invalid routing prefix %s before discovery", async statePrefix => {
  const options = { ...fixture(), statePrefix };
  await expect(api.prepareRemoteMcpAuthorization(options)).rejects.toThrow(/^Unable to prepare MCP authorization$/);
  expect(options.discover).not.toHaveBeenCalled();
});

it("keeps begin's durable create contract and safe public result", async () => {
  const create = vi.fn(async (_transaction: api.RemoteMcpAuthorizationTransaction) => {});
  const result = await api.beginRemoteMcpAuthorization({ ...fixture(), store: { create, consume: vi.fn(), commit: vi.fn() } });
  expect(create).toHaveBeenCalledOnce();
  expect(new URL(result.authorizationUrl).searchParams.get("state")).toBe(create.mock.calls[0][0].state);
  expect(Object.keys(result).sort()).toEqual(["authorizationUrl", "expiresAt"]);
});


it.each(["client_secret_basic", "client_secret_post"] as const)("prepares %s consent without reading the exchange secret", async tokenEndpointAuthMethod => {
  const options = { ...fixture(), client: { clientId: "client", tokenEndpointAuthMethod } };
  const { authorizationUrl, transaction } = await api.prepareRemoteMcpAuthorization(options);
  expect(new URL(authorizationUrl).searchParams.get("client_id")).toBe("client");
  expect(transaction.session.client.tokenEndpointAuthMethod).toBe(tokenEndpointAuthMethod);
  expect(transaction.session.client.clientSecret).toBeUndefined();
  expect(options.discover).toHaveBeenCalledOnce();
});
