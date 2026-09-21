import { expect, it, vi } from "vitest";
import { initRemoteMcpConfiguration, bindRemoteMcpConfiguration, type InitRemoteMcpServer } from "./index.js";

vi.mock("mcp-oauth", async importOriginal => ({
  ...await importOriginal<typeof import("mcp-oauth")>(),
  createDefaultOAuthClientProvider: vi.fn(() => ({ handleUnauthorized: () => ({ action: "fail" }) }))
}));
import { createDefaultOAuthClientProvider } from "mcp-oauth";

it("preserves named persistence profiles through init/config/environment binding", () => {
  const initialized = initRemoteMcpConfiguration([{ name: "catalog", url: "https://catalog.example/mcp", tools: [],
    auth: { type: "oauth", clientMode: "static", persistenceNamespace: "personal", env: { clientId: "ID" } } }]);
  expect(initialized.configuration.servers[0].auth).toMatchObject({ persistenceNamespace: "personal" });
  bindRemoteMcpConfiguration(initialized.configuration, { env: { ID: "client" } });
  expect(createDefaultOAuthClientProvider).toHaveBeenCalledWith(expect.objectContaining({ persistenceNamespace: "personal" }));
  expect(initialized.envTemplate).not.toContain("personal");
});

it.each(["   ", "😀".repeat(257)])("rejects invalid namespaces during configuration preflight: %s", persistenceNamespace => {
  expect(() => initRemoteMcpConfiguration([{ name: "catalog", url: "https://catalog.example/mcp", tools: [],
    auth: { type: "oauth", clientMode: "dynamic", persistenceNamespace } }])).toThrow("namespace");
});

it.each(["static", "dynamic"] as const)("preserves public token authentication method through init and binding: %s", clientMode => {
  const initialized = initRemoteMcpConfiguration([{ name: "catalog", url: "https://catalog.example/mcp", tools: [],
    auth: { type: "oauth", clientMode, tokenEndpointAuthMethod: "client_secret_basic", env: { clientId: "ID", clientSecret: "SECRET" } } } as InitRemoteMcpServer]);
  expect(initialized.configuration.servers[0].auth).toMatchObject({ tokenEndpointAuthMethod: "client_secret_basic" });
  bindRemoteMcpConfiguration(initialized.configuration, { env: { ID: "client", SECRET: "private" } });
  expect(createDefaultOAuthClientProvider).toHaveBeenCalledWith(expect.objectContaining({ client: expect.objectContaining({ tokenEndpointAuthMethod: "client_secret_basic" }) }));
  expect(initialized.envTemplate).not.toContain("client_secret_basic");
});
