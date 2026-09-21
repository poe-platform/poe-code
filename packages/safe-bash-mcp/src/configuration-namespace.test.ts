import { expect, it, vi } from "vitest";
import { initRemoteMcpConfiguration, bindRemoteMcpConfiguration } from "./index.js";

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
