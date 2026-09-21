import { describe, expect, it } from "vitest";
import { initRemoteMcpConfiguration, parseRemoteMcpConfiguration } from "./index.js";

const tool = { name: "find", inputSchema: { type: "object", properties: { query: { type: "string" } } }, annotations: { readOnlyHint: true } };
const server = { name: "catalog", url: "https://catalog.example/mcp", tools: [tool] };

describe("remote MCP initialization and declarative configuration", () => {
  it.each(["static", "dynamic"] as const)("retains a caller-selected OAuth client name for %s registration", clientMode => {
    const { configuration, envTemplate } = initRemoteMcpConfiguration([{ ...server, auth: { type: "oauth", clientMode, clientName: "Host Application" } }]);
    expect(configuration.servers[0].auth).toMatchObject({ clientName: "Host Application" });
    expect(parseRemoteMcpConfiguration(JSON.stringify(configuration))).toEqual(configuration);
    expect(envTemplate).not.toContain("Host Application");
  });

  it.each(["", "   ", 42])("rejects an unusable OAuth client name: %j", clientName => {
    expect(() => initRemoteMcpConfiguration([{ ...server, auth: { type: "oauth", clientMode: "dynamic", clientName } } as never])).toThrow("clientName");
  });

  it("preserves authoritative schemas and leaves absent schemas available for discovery", () => {
    const result = initRemoteMcpConfiguration([server, { name: "empty", url: server.url, tools: [] }, { name: "unknown", url: server.url }]);
    expect(result.configuration).toEqual({ version: 1, servers: [server, { name: "empty", url: server.url, tools: [] }, { name: "unknown", url: server.url }] });
    expect(result.envTemplate).toBe("");
    expect(parseRemoteMcpConfiguration(JSON.stringify(result.configuration))).toEqual(result.configuration);
  });

  it("provides all OAuth credential references and explanatory empty dotenv entries", () => {
    const result = initRemoteMcpConfiguration([{ ...server, auth: { type: "oauth", clientMode: "static" } }]);
    expect(result.configuration.servers[0].auth).toEqual({ type: "oauth", clientMode: "static", credentials: {
      clientId: { env: "MCP_CATALOG_CLIENT_ID" }, clientSecret: { env: "MCP_CATALOG_CLIENT_SECRET" },
      scope: { env: "MCP_CATALOG_SCOPE" }, redirectUri: { env: "MCP_CATALOG_REDIRECT_URI" },
      accessToken: { env: "MCP_CATALOG_ACCESS_TOKEN" }, refreshToken: { env: "MCP_CATALOG_REFRESH_TOKEN" },
      expiresAt: { env: "MCP_CATALOG_EXPIRES_AT" }, expiresIn: { env: "MCP_CATALOG_EXPIRES_IN" },
      issuedAt: { env: "MCP_CATALOG_ISSUED_AT" }
    } });
    for (const suffix of ["CLIENT_ID", "CLIENT_SECRET", "SCOPE", "REDIRECT_URI", "ACCESS_TOKEN", "REFRESH_TOKEN", "EXPIRES_AT", "EXPIRES_IN", "ISSUED_AT"])
      expect(result.envTemplate).toContain(`MCP_CATALOG_${suffix}=\n`);
    expect(result.envTemplate).toContain("Unix epoch milliseconds");
    expect(result.envTemplate).toContain("registered callback");
    expect(result.envTemplate).not.toContain("client-secret-value");
  });

  it("supports generic app credential names and keeps public defaults in configuration", () => {
    const result = initRemoteMcpConfiguration([{ ...server, auth: {
      type: "oauth", clientMode: "static", env: { clientId: "GOOGLE_APP_ID", clientSecret: "GOOGLE_APP_SECRET" },
      scope: "read offline_access", redirectUri: "http://localhost:39119/oauth/callback?app=one"
    } }]);
    expect(result.configuration.servers[0].auth).toMatchObject({ credentials: {
      clientId: { env: "GOOGLE_APP_ID" }, clientSecret: { env: "GOOGLE_APP_SECRET" },
      scope: { env: "MCP_CATALOG_SCOPE", fallback: "read offline_access" },
      redirectUri: { env: "MCP_CATALOG_REDIRECT_URI", fallback: "http://localhost:39119/oauth/callback?app=one" }
    } });
    expect(result.envTemplate).toContain("GOOGLE_APP_ID=\n");
    expect(result.envTemplate).not.toContain("read offline_access");
    expect(parseRemoteMcpConfiguration(result.configuration)).toEqual(result.configuration);
  });

  it("requires an explicit OAuth registration mode rather than silently choosing a client", () => {
    expect(() => initRemoteMcpConfiguration([{ ...server, auth: { type: "oauth" } }])).toThrow("clientMode");
  });

  it("supports bearer tokens and arbitrary header environment references", () => {
    const result = initRemoteMcpConfiguration([{ ...server, auth: { type: "bearer" }, headers: { "X-Api-Key": { env: "CATALOG_API_KEY" } } }]);
    expect(result.configuration.servers[0]).toMatchObject({ auth: { type: "bearer", token: { env: "MCP_CATALOG_ACCESS_TOKEN" } },
      headers: { "X-Api-Key": { env: "CATALOG_API_KEY" } } });
    expect(result.envTemplate).toContain("CATALOG_API_KEY=\n");
    expect(result.envTemplate).toContain("MCP_CATALOG_ACCESS_TOKEN=\n");
  });

  it.each(["${env:TOKEN}", "${TOKEN}", "${TOKEN:-fallback}", "$env:TOKEN"])("rejects string interpolation syntax as a credential reference: %s", env => {
    expect(() => initRemoteMcpConfiguration([{ ...server, auth: { type: "bearer", env } }])).toThrow("environment variable name");
    expect(() => initRemoteMcpConfiguration([{ ...server, headers: { "X-Key": { env } } }])).toThrow("environment variable name");
    const configuration = initRemoteMcpConfiguration([{ ...server, headers: { "X-Key": { env: "TOKEN" } } }]).configuration;
    configuration.servers[0].headers!["X-Key"].env = env;
    expect(() => parseRemoteMcpConfiguration(configuration)).toThrow("environment variable name");
  });

  it("rejects literal header placeholders instead of treating them as credential values", () => {
    expect(() => initRemoteMcpConfiguration([{ ...server, headers: { "X-Key": "${env:TOKEN}" } }])).toThrow();
    expect(() => parseRemoteMcpConfiguration({ version: 1, servers: [{ ...server, headers: { "X-Key": "${env:TOKEN}" } }] })).toThrow();
  });

  it("derives stable noncolliding environment names for colliding server stems regardless of order", () => {
    const servers = ["catalog-1", "catalog_1", "catalog_1_2", "世界"].map(name => ({ ...server, name, auth: { type: "bearer" as const } }));
    const first = initRemoteMcpConfiguration(servers);
    const second = initRemoteMcpConfiguration([...servers].reverse());
    const mapping = (configuration: typeof first.configuration) => Object.fromEntries(configuration.servers.map(server => [server.name, server.auth]));
    expect(mapping(first.configuration)).toEqual(mapping(second.configuration));
    const names = first.configuration.servers.map(server => server.auth!.token.env);
    expect(new Set(names).size).toBe(4);
    expect(names).toContain("MCP_CATALOG_1_ACCESS_TOKEN");
    expect(names).toContain("MCP_CATALOG_1_3_ACCESS_TOKEN");
    expect(names).toContain("MCP_CATALOG_1_2_ACCESS_TOKEN");
  });

  it("avoids accidental aliasing with an explicitly referenced credential", () => {
    const result = initRemoteMcpConfiguration([{ ...server, auth: { type: "bearer" } }, {
      ...server, name: "explicit", auth: { type: "bearer", env: "MCP_CATALOG_ACCESS_TOKEN" }
    }]);
    expect(result.configuration.servers.map(server => server.auth!.token.env)).toEqual(["MCP_CATALOG_2_ACCESS_TOKEN", "MCP_CATALOG_ACCESS_TOKEN"]);
  });

  it("deduplicates intentionally shared explicit environment references in the template", () => {
    const result = initRemoteMcpConfiguration([{ ...server, auth: { type: "bearer", env: "SHARED_TOKEN" } }, {
      ...server, name: "second", auth: { type: "bearer", env: "SHARED_TOKEN" }
    }]);
    expect(result.envTemplate.split("SHARED_TOKEN=\n")).toHaveLength(2);
  });

  it("isolates returned configuration from caller and parser mutations", () => {
    const input = structuredClone(server);
    const result = initRemoteMcpConfiguration([input]);
    input.tools[0].inputSchema.properties.query.type = "integer";
    expect(result.configuration.servers[0].tools![0].inputSchema).toMatchObject({ properties: { query: { type: "string" } } });
    const parsed = parseRemoteMcpConfiguration(result.configuration);
    parsed.servers[0].tools![0].inputSchema.type = "array";
    expect(result.configuration.servers[0].tools![0].inputSchema.type).toBe("object");
  });

  it.each(["bad name", "path/name", "", "nul\0name"])("rejects command names that cannot be invoked: %j", name => {
    expect(() => initRemoteMcpConfiguration([{ ...server, name }])).toThrow("command name");
  });

  it.each(["file:///tmp/mcp", "stdio:tool", "https://user:password@example.test/mcp", "https://example.test/mcp#fragment"])("rejects unsafe/nonremote URL %s", url => {
    expect(() => initRemoteMcpConfiguration([{ ...server, url }])).toThrow();
  });

  it.each(["1KEY", "KEY-NAME", "KEY=oops", "KEY\nINJECT", "", "世界"])("rejects unsafe environment reference %j", env => {
    expect(() => initRemoteMcpConfiguration([{ ...server, auth: { type: "bearer", env } }])).toThrow("environment");
  });

  it("rejects literal credentials and unknown configuration options rather than serializing them", () => {
    for (const input of [
      { ...server, headers: { Authorization: "Bearer secret-value" } },
      { ...server, oauth: { client: { clientId: "secret-value" } } },
      { ...server, auth: { type: "oauth", clientMode: "static", clientSecret: "secret-value" } },
      { ...server, auth: { type: "bearer", env: "TOKEN", token: "secret-value" } }
    ]) expect(() => initRemoteMcpConfiguration([input])).toThrow();
  });

  it.each([
    { "Bad Header": { env: "KEY" } },
    { "X-Key": { env: "KEY" }, "x-key": { env: "OTHER_KEY" } }
  ])("rejects invalid or case-colliding HTTP headers", headers => {
    expect(() => initRemoteMcpConfiguration([{ ...server, headers }])).toThrow();
  });

  it.each(["Authorization", "authorization", "AUTHORIZATION"])("rejects %s combined with managed authentication", header => {
    expect(() => initRemoteMcpConfiguration([{ ...server, headers: { [header]: { env: "STATIC_AUTH" } }, auth: { type: "bearer" } }])).toThrow("Authorization");
    expect(() => initRemoteMcpConfiguration([{ ...server, headers: { [header]: { env: "STATIC_AUTH" } }, auth: { type: "oauth", clientMode: "static" } }])).toThrow("Authorization");
  });

  it("rejects secret fallback values in parsed configuration", () => {
    const result = initRemoteMcpConfiguration([{ ...server, auth: { type: "bearer" } }]);
    result.configuration.servers[0].auth!.token.fallback = "secret-value";
    expect(() => parseRemoteMcpConfiguration(result.configuration)).toThrow();
  });

  it("validates version, complete registry and known transport values", () => {
    for (const value of [null, [], {}, { version: 2, servers: [] }, { version: 1, servers: [server, server] },
      { version: 1, servers: [{ ...server, transport: "stdio" }] }, { version: 1, servers: [{ ...server, tools: [tool, tool] }] }])
      expect(() => parseRemoteMcpConfiguration(value)).toThrow();
  });

  it("rejects malformed JSON and bounded configuration input", () => {
    expect(() => parseRemoteMcpConfiguration('{"version":')).toThrow();
    expect(() => parseRemoteMcpConfiguration(JSON.stringify({ version: 1, servers: [server] }), { maxConfigurationBytes: 10 })).toThrow("byte limit");
    expect(() => initRemoteMcpConfiguration([server], { maxConfigurationBytes: 10 })).toThrow("byte limit");
    expect(() => initRemoteMcpConfiguration([server], { maxConfigurationBytes: 0 })).toThrow("positive");
  });
  it("accepts a bounded registry with thousands of supplied schemas consistently as JSON or objects", () => {
    const tools = Array.from({ length: 2_000 }, (_, index) => ({ ...tool, name: `tool_${index}` }));
    const result = initRemoteMcpConfiguration([{ ...server, tools }]);
    expect(result.configuration.servers[0].tools).toHaveLength(2_000);
    expect(parseRemoteMcpConfiguration(JSON.stringify(result.configuration))).toEqual(parseRemoteMcpConfiguration(result.configuration));
  });

});
