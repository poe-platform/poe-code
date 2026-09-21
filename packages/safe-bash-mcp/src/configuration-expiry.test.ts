import { expect, it, vi } from "vitest";
import { bindRemoteMcpConfiguration, initRemoteMcpConfiguration, parseRemoteMcpConfiguration } from "./index.js";
const resource = "https://catalog.example/mcp";
function initialized() {
  return initRemoteMcpConfiguration([{ name: "catalog", url: resource, tools: [], auth: { type: "oauth", clientMode: "static", env: { clientId: "ID" } } }]);
}
it("provides optional relative lifetime and issuance references with empty guidance", () => {
  const result = initialized();
  expect(result.configuration.servers[0].auth).toMatchObject({ credentials: {
    expiresIn: { env: "MCP_CATALOG_EXPIRES_IN" }, issuedAt: { env: "MCP_CATALOG_ISSUED_AT" } } });
  expect(result.envTemplate).toContain("MCP_CATALOG_EXPIRES_IN=\n");
  expect(result.envTemplate).toContain("MCP_CATALOG_ISSUED_AT=\n");
});
it("preserves older configurations without optional timing references", () => {
  const configuration = structuredClone(initialized().configuration);
  const auth = configuration.servers[0].auth!;
  if (auth.type !== "oauth") throw Error("unexpected fixture");
  delete (auth.credentials as unknown as Record<string, unknown>).expiresIn;
  delete (auth.credentials as unknown as Record<string, unknown>).issuedAt;
  expect(parseRemoteMcpConfiguration(configuration)).toEqual(configuration);
});
it.each([
  [{ MCP_CATALOG_EXPIRES_IN: "3600" }, 1000, 3_601_000],
  [{ MCP_CATALOG_EXPIRES_IN: "3600", MCP_CATALOG_ISSUED_AT: "1000" }, 3_301_000, 3_601_000],
  [{ MCP_CATALOG_EXPIRES_IN: "3600", MCP_CATALOG_EXPIRES_AT: "301000" }, 1000, 301_000]
] as const)("binds relative and delayed imports once with absolute precedence: %#", async (timing, now, expected) => {
  let current = now;
  const sessionStore = { load: async () => null, save: async () => {}, clear: async () => {} };
  const [bound] = bindRemoteMcpConfiguration(initialized().configuration, { env: { ID: "original", MCP_CATALOG_ACCESS_TOKEN: "private-token", ...timing },
    oauth: { now: () => current, sessionStore: () => sessionStore } });
  current += 1;
  const fetch = vi.fn(async () => { throw Error("unexpected network"); });
  const grant = await bound.oauth!.provider.authorizeRequest!({ requestUrl: new URL(resource), headers: new Headers(), fetch });
  expect(grant).toMatchObject({ expiresAt: expected });
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  { MCP_CATALOG_EXPIRES_IN: "-1" }, { MCP_CATALOG_EXPIRES_IN: "1.5" }, { MCP_CATALOG_EXPIRES_IN: "1e3" },
  { MCP_CATALOG_EXPIRES_IN: "8640000000000" }, { MCP_CATALOG_ISSUED_AT: "1000" },
  { MCP_CATALOG_EXPIRES_IN: "3600", MCP_CATALOG_ISSUED_AT: "private-invalid-issuance" }
])("completes timing preflight before asking a host for stores: %#", timing => {
  const store = vi.fn(() => ({ load: async () => null, save: async () => {}, clear: async () => {} }));
  expect(() => bindRemoteMcpConfiguration(initialized().configuration, { env: { ID: "original", MCP_CATALOG_ACCESS_TOKEN: "private-token", ...timing },
    oauth: { now: () => 1000, sessionStore: store } })).toThrow("OAuth");
  expect(store).not.toHaveBeenCalled();
});
