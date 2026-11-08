import { expect, it, vi } from "vitest";
import * as oauth from "mcp-oauth";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import { createRemoteMcpManagementCommand, importRemoteMcpAuthentication, initRemoteMcpConfiguration, resetRemoteMcpAuthentication, type RemoteMcpCredentialImportOptions } from "./index.js";

const resource = "https://catalog.example/mcp", issuer = "https://auth.example";
const entry = { name: "catalog", url: resource, tools: [], auth: { type: "oauth" as const, clientMode: "dynamic" as const } };
const server = initRemoteMcpConfiguration([entry]).configuration.servers[0];
const payload = { tokens: { access_token: "original-grant", token_type: "Bearer" }, clientInfo: { client_id: "original-app" } };
const cases = (["sdk", "management"] as const).flatMap(route => [
  ...(["signal", "binding", "timeoutMs", "maxConfigurationBytes", "maxTools"] as const).map(field => ({ route, operation: "reset" as const, field })),
  ...(["signal", "binding", "fetch", "oauthDiscoveryCache", "requestTimeoutMs", "timeoutMs", "maxImportBytes", "maxConfigurationBytes", "maxTools"] as const).map(field => ({ route, operation: "import" as const, field }))
]);
it.each(cases)("retains hidden credential $field through $route $operation", async ({ route, operation, field }) => {
  const ambientStore = vi.spyOn(oauth, "createResourceBoundOAuthStores").mockImplementation(() => { throw new Error("Ambient native persistence selected"); });
  const ambientFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Ambient fetch selected"));
  const reset = vi.fn(async () => {}), importSession = vi.fn(async () => {}), set = vi.fn(async () => {});
  const fetch = vi.fn(async (target: string | URL) => Response.json(String(target).includes("oauth-protected-resource")
    ? { resource, authorization_servers: [issuer] }
    : { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] }));
  const reason = new Error("original credential cancellation");
  const options: RemoteMcpCredentialImportOptions = { binding: { env: {}, oauth: { reset, importSession } }, fetch,
    signal: field === "signal" ? AbortSignal.abort(reason) : undefined,
    oauthDiscoveryCache: { get: async () => null, set }, requestTimeoutMs: field === "requestTimeoutMs" ? 0 : 1000,
    timeoutMs: field === "timeoutMs" ? 0 : 1000, maxImportBytes: field === "maxImportBytes" ? 1 : 4096,
    maxConfigurationBytes: field === "maxConfigurationBytes" ? 0 : 8192, maxTools: field === "maxTools" ? 0 : 100 };
  Object.defineProperty(options, field, { enumerable: false });
  const run = async () => {
    if (route === "sdk") return operation === "reset" ? resetRemoteMcpAuthentication(server, options) : importRemoteMcpAuthentication(server, payload, options);
    const fs = createMemoryFileSystem(); await fs.writeFile("/grant.json", new TextEncoder().encode(JSON.stringify(payload)));
    const shell = new Shell({ fs, commands: new CommandRegistry([createRemoteMcpManagementCommand([entry], operation === "reset" ? { reset: options } : { credentialImport: options })]) });
    try { const result = await shell.exec(operation === "reset" ? "mcp reset catalog --json" : "mcp import catalog --file /grant.json --json"); if (result.exitCode) throw new Error(result.stderr); return result; }
    finally { await shell.dispose(); }
  };
  try {
    const expected = ["binding", "fetch", "oauthDiscoveryCache"].includes(field) ? undefined : field === "signal" ? reason.message : field === "maxImportBytes" ? (route === "sdk" ? "import payload" : "maxBytes") : field;
    if (expected === undefined) { await run(); expect(operation === "reset" ? reset : importSession).toHaveBeenCalledOnce(); if (field === "oauthDiscoveryCache") expect(set).toHaveBeenCalledOnce(); }
    else { await expect(run()).rejects.toThrow(expected); expect(reset).not.toHaveBeenCalled(); expect(importSession).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); }
    expect(ambientStore).not.toHaveBeenCalled(); expect(ambientFetch).not.toHaveBeenCalled();
  } finally { ambientStore.mockRestore(); ambientFetch.mockRestore(); }
});
