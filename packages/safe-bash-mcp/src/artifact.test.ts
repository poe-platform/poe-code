import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import type { HttpTransportFetch, Tool } from "tiny-mcp-client";
import { generateRemoteMcpArtifact, initRemoteMcpConfiguration, parseRemoteMcpArtifact, remoteMcpArtifactPlugin } from "./index.js";

const tool: Tool = { name: "search_items", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  outputSchema: { type: "object", properties: { query: { type: "string" } } }, annotations: { readOnlyHint: true } };
const server = { name: "catalog", url: "https://catalog.example/mcp", protocolVersion: "2025-03-26" as const };

it("prints a complete selected tool schema from a recreated artifact without discovery", async () => {
  const generated = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([{ ...server, tools: [tool] }]).configuration);
  const fetch = vi.fn<HttpTransportFetch>();
  const shell = new Shell({ fs: createMemoryFileSystem() });
  try {
    await shell.use(await remoteMcpArtifactPlugin(generated.json, { binding: { env: {} }, commands: { fetch } }));
    const result = await shell.exec("catalog search_items --schema");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(tool);
    expect(result.stderr).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  } finally { await shell.dispose(); }
});

it("keeps an explicit empty registry authoritative despite unrelated environment configuration", async () => {
  const readAmbient = vi.fn(() => { throw new Error("unrelated environment must remain unread"); });
  const env = Object.defineProperties({}, Object.fromEntries([
    "HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "MCPORTER_CONFIG"
  ].map(name => [name, { enumerable: true, get: readAmbient }])));
  const fetch = vi.fn<HttpTransportFetch>();
  const { configuration } = initRemoteMcpConfiguration([]);
  const generated = await generateRemoteMcpArtifact(configuration, { binding: { env }, schema: { fetch } });
  expect(generated.artifact.configuration.servers).toEqual([]);
  expect(generated.artifact.schemas).toEqual([]);
  const shell = new Shell({ fs: createMemoryFileSystem() });
  try {
    await shell.use(await remoteMcpArtifactPlugin(generated.artifact, { binding: { env }, commands: { fetch } }));
    expect((await shell.exec("catalog --help")).exitCode).not.toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(readAmbient).not.toHaveBeenCalled();
  } finally { await shell.dispose(); }
});

function remote() {
  const requests: { method: string; params?: unknown }[] = [];
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    const request = JSON.parse(String(init?.body)); requests.push(request);
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = request.method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "catalog-server", version: "1" }, instructions: "Prefer reads" }
      : request.method === "tools/list" ? { tools: [tool] } : { content: [{ type: "text", text: "first" }, { type: "text", text: "second" }], structuredContent: request.params.arguments };
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  });
  return { fetch, requests };
}

it("surfaces archived discovered instructions in help after host recreation without discovery", async () => {
  const f = remote();
  const generated = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([server]).configuration, { schema: { fetch: f.fetch } });
  delete generated.artifact.configuration.servers[0].instructions;
  const { digest: ignoredDigest, ...payload } = generated.artifact;
  generated.artifact.digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  f.fetch.mockClear();
  const shell = new Shell({ fs: createMemoryFileSystem() });
  try {
    await shell.use(await remoteMcpArtifactPlugin(generated.artifact, { binding: { env: {} }, commands: { fetch: f.fetch } }));
    for (const source of ["catalog --help", "catalog search_items --help"]) {
      const result = await shell.exec(source);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Instructions:\nPrefer reads\n");
    }
    expect(f.fetch).not.toHaveBeenCalled();
  } finally { await shell.dispose(); }
});

it("preserves supplied instructions through init and generated artifacts", async () => {
  const { configuration } = initRemoteMcpConfiguration([{ ...server, tools: [tool], instructions: "Read first\nWrite second" }]);
  const f = remote();
  const generated = await generateRemoteMcpArtifact(configuration, { schema: { fetch: f.fetch } });
  expect(generated.artifact.configuration.servers[0].instructions).toBe("Read first\nWrite second");
  expect(generated.artifact.schemas[0].instructions).toBe("Read first\nWrite second");
  expect(f.fetch).not.toHaveBeenCalled();
});

it("generates credential-reference artifacts from supplied schemas without reading credentials or connecting", async () => {
  const { configuration } = initRemoteMcpConfiguration([{ ...server, tools: [tool], auth: { type: "bearer", env: "CATALOG_TOKEN" } }]);
  const fetch = vi.fn<HttpTransportFetch>(), env = { get CATALOG_TOKEN(): string { throw new Error("must not read secret"); } };
  const generated = await generateRemoteMcpArtifact(configuration, { binding: { env }, schema: { fetch } });
  expect(fetch).not.toHaveBeenCalled();
  expect(generated.artifact.configuration.servers[0].auth).toEqual({ type: "bearer", token: { env: "CATALOG_TOKEN" } });
  expect(generated.artifact.schemas[0].tools).toEqual([tool]);
  expect(parseRemoteMcpArtifact(generated.json)).toEqual(generated.artifact);
});

it("is reproducible across server/tool/schema key order while preserving semantic array order", async () => {
  const first = { ...tool, inputSchema: { ...tool.inputSchema, properties: { z: { enum: ["b", "a"] }, query: { type: "string" } } } };
  const second = { ...tool, inputSchema: { required: ["query"], properties: { query: { type: "string" }, z: { enum: ["b", "a"] } }, type: "object" } };
  const a = initRemoteMcpConfiguration([{ ...server, name: "zeta", tools: [] }, { ...server, tools: [{ ...first, name: "z-tool" }, first] }]).configuration;
  const b = initRemoteMcpConfiguration([{ ...server, tools: [second, { ...second, name: "z-tool" }] }, { ...server, name: "zeta", tools: [] }]).configuration;
  const left = await generateRemoteMcpArtifact(a), right = await generateRemoteMcpArtifact(b);
  expect(left.json).toBe(right.json); expect(left.module).toBe(right.module);
  expect(left.artifact.configuration.servers.map(s => s.name)).toEqual(["catalog", "zeta"]);
  expect(left.artifact.configuration.servers[0].tools?.[0].inputSchema.properties?.z.enum).toEqual(["b", "a"]);
});

it("discovers absent schemas, preserves server metadata and excludes resolved credentials", async () => {
  const f = remote(), { configuration } = initRemoteMcpConfiguration([{ ...server, auth: { type: "bearer", env: "TOKEN" } }]);
  const generated = await generateRemoteMcpArtifact(configuration, { binding: { env: { TOKEN: "private-token-value" } }, schema: { fetch: f.fetch } });
  expect(generated.artifact.schemas[0]).toMatchObject({ source: "discovered", serverInfo: { name: "catalog-server", version: "1" }, capabilities: { tools: {} }, instructions: "Prefer reads", tools: [tool] });
  expect(generated.artifact.configuration.servers[0].tools).toEqual([tool]);
  expect(generated.artifact.configuration.servers[0].instructions).toBe("Prefer reads");
  expect(generated.json).not.toContain("private-token-value"); expect(generated.module).not.toContain("private-token-value");
  expect(f.requests.map(r => r.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
});

it("rejects contradictory configured and archived instructions even with a recomputed digest", async () => {
  const generated = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([{ ...server, tools: [tool], instructions: "Read first" }]).configuration);
  generated.artifact.configuration.servers[0].instructions = "Write first";
  const { digest: ignoredDigest, ...payload } = generated.artifact;
  generated.artifact.digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  expect(() => parseRemoteMcpArtifact(generated.artifact)).toThrow("schema/configuration mismatch");
});

it("refuses to serialize credentials echoed into discovery metadata", async () => {
  const f = remote(), { configuration } = initRemoteMcpConfiguration([{ ...server, auth: { type: "bearer", env: "TOKEN" } }]);
  const fetch: HttpTransportFetch = async (url, init) => {
    const response = await f.fetch(url, init);
    if (!response.ok || response.status === 202 || response.status === 204) return response;
    const value = await response.json();
    if (value.result?.serverInfo) value.result.serverInfo.name = "private-token-value";
    return Response.json(value);
  };
  const error = await generateRemoteMcpArtifact(configuration, { binding: { env: { TOKEN: "private-token-value" } }, schema: { fetch } }).catch(error => error);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain("resolved credential");
  expect(error.message).not.toContain("private-token-value");
});

it("also quarantines discovery echoes of persisted runtime grants absent from the environment", async () => {
  const f = remote(), issuer = "https://auth.example";
  const { configuration } = initRemoteMcpConfiguration([{ ...server, auth: { type: "oauth", clientMode: "static", env: { clientId: "ID" } } }]);
  const fetch: HttpTransportFetch = async (url, init) => {
    const response = await f.fetch(url, init);
    if (!response.ok || response.status === 202 || response.status === 204) return response;
    const value = await response.json();
    if (value.result?.serverInfo) value.result.serverInfo.name = "persisted-private-token";
    return Response.json(value);
  };
  const sessionStore = { load: async () => ({ resource: server.url, authorizationServer: issuer, client: { clientId: "qa-client" },
    tokens: { accessToken: "persisted-private-token", refreshToken: "persisted-private-refresh", tokenType: "Bearer" as const, expiresAt: null },
    discovery: { resourceMetadataUrl: `${server.url}/metadata`, resourceMetadata: { resource: server.url, authorization_servers: [issuer] }, authorizationServerMetadata: {
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
    } } }), save: async () => {}, clear: async () => {} };
  const error = await generateRemoteMcpArtifact(configuration, { binding: { env: { ID: "qa-client" }, oauth: { sessionStore: () => sessionStore } }, schema: { fetch } }).catch(error => error);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain("resolved credential");
  expect(error.message).not.toContain("persisted-private-token");
});

it("imports a dependency-free ESM artifact and runs it in a real Shell using runtime credentials", async () => {
  const f = remote(), { configuration } = initRemoteMcpConfiguration([{ ...server, tools: [tool], auth: { type: "bearer", env: "TOKEN" } }]);
  const generated = await generateRemoteMcpArtifact(configuration);
  const module = await import(`data:text/javascript;base64,${Buffer.from(generated.module).toString("base64")}`);
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(await remoteMcpArtifactPlugin(module.default, { binding: { env: { TOKEN: "runtime-secret" } }, commands: { fetch: f.fetch } }));
  try {
    const result = await shell.exec("catalog search_items --query '005930'");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ structuredContent: { query: "005930" }, content: [{ text: "first" }, { text: "second" }] });
    expect(f.requests.some(r => r.method === "tools/list")).toBe(false);
    expect(f.fetch.mock.calls.every(([,init]) => new Headers(init?.headers).get("Authorization") === "Bearer runtime-secret")).toBe(true);
  } finally { await shell.dispose(); }
});

it("preserves prototype-named schema keys and adversarial strings through generated ESM", async () => {
  const special = { ...tool, name: "__proto__", description: 'literal \\n </script> ${ignored} \u2028', inputSchema: { type: "object", properties: { ["__proto__"]: { type: "string" } } } };
  const generated = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([{ ...server, tools: [special] }]).configuration);
  const module = await import(`data:text/javascript;base64,${Buffer.from(generated.module).toString("base64")}`);
  expect(module.default.configuration.servers[0].tools[0]).toEqual(special);
  expect(Object.hasOwn(module.default.configuration.servers[0].tools[0].inputSchema.properties, "__proto__")).toBe(true);
});

it("rejects changed artifacts before consulting environments or providers", async () => {
  const generated = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([{ ...server, tools: [tool] }]).configuration);
  const changed = structuredClone(generated.artifact); changed.configuration.servers[0].url = "https://other.example/mcp";
  const env = { get TOKEN(): string { throw new Error("read secret"); } };
  await expect(remoteMcpArtifactPlugin(changed, { binding: { env } })).rejects.toThrow("digest");
  const { digest: ignoredDigest, ...payload } = generated.artifact;
  expect(generated.artifact.digest).toHaveLength(64);
  expect(createHash("sha256").update(JSON.stringify(payload)).digest("hex")).toBe(generated.artifact.digest);
});

it("rejects internally inconsistent snapshots even with a recomputed digest", async () => {
  const generated = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([{ ...server, tools: [tool] }]).configuration);
  const changed = structuredClone(generated.artifact); changed.schemas[0].url = "https://other.example/mcp";
  const { digest: ignoredDigest, ...payload } = changed;
  changed.digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  expect(() => parseRemoteMcpArtifact(changed)).toThrow("schema/configuration mismatch");
});

it("preserves typed, nested, array and raw inputs through an imported artifact and real Shell", async () => {
  const f = remote();
  const rich: Tool = { ...tool, name: "search-items", inputSchema: { type: "object", required: ["query"], properties: {
    query: { type: "string" }, count: { type: "integer" }, settings: { type: "object" }, rows: { type: "array", items: { type: "object" } }
  } } };
  const generated = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([{ ...server, tools: [rich] }]).configuration);
  const module = await import(`data:text/javascript;base64,${Buffer.from(generated.module).toString("base64")}`);
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(await remoteMcpArtifactPlugin(module.default, { binding: { env: {} }, commands: { fetch: f.fetch } }));
  try {
    const scripts = [
      ["catalog search-items --query '1715771790.000000' --count 5", { query: "1715771790.000000", count: 5 }],
      ["catalog search-items query=005930 count:=5", { query: "005930", count: 5 }],
      ["catalog search-items query:00123 settings:'{\"nested\":[1,2]}'", { query: "00123", settings: { nested: [1, 2] } }],
      ["catalog search-items --query x --rows '{\"a\":1,\"b\":2},{\"a\":3}'", { query: "x", rows: [{ a: 1, b: 2 }, { a: 3 }] }],
      ["catalog search-items --raw '{\"query\":\"00123\",\"settings\":{\"x\":[1,2]},\"rows\":[{\"a\":1}]}'", { query: "00123", settings: { x: [1, 2] }, rows: [{ a: 1 }] }]
    ] as const;
    for (const [script, expected] of scripts) {
      const result = await shell.exec(script);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).structuredContent).toEqual(expected);
    }
    expect(f.requests.some(r => r.method === "tools/list")).toBe(false);
  } finally { await shell.dispose(); }
});

it("bounds generated and parsed artifact bytes and observes cancellation before discovery", async () => {
  const configuration = initRemoteMcpConfiguration([{ ...server, tools: [tool] }]).configuration;
  await expect(generateRemoteMcpArtifact(configuration, { maxArtifactBytes: 100 })).rejects.toThrow("artifact byte limit");
  const generated = await generateRemoteMcpArtifact(configuration);
  expect(() => parseRemoteMcpArtifact(generated.json, { maxArtifactBytes: 100 })).toThrow("artifact byte limit");
  const controller = new AbortController(), reason = new Error("cancel generation"), fetch = vi.fn<HttpTransportFetch>(); controller.abort(reason);
  await expect(generateRemoteMcpArtifact(configuration, { schema: { fetch, signal: controller.signal } })).rejects.toBe(reason);
  expect(fetch).not.toHaveBeenCalled();
});

it("archives external input and output documents for a dependency-free imported module", async () => {
  const id = "https://catalog.example/schema";
  const registry = { [id]: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } };
  const referenced = { ...tool, inputSchema: { $ref: id }, outputSchema: { $ref: id } };
  const configuration = initRemoteMcpConfiguration([{ ...server, tools: [referenced] }]).configuration;
  const generated = await generateRemoteMcpArtifact(configuration, { schemaRegistry: registry });
  expect(generated.artifact.schemaRegistry).toEqual(registry);
  registry[id].properties.query.type = "integer";
  const module = await import(`data:text/javascript;base64,${Buffer.from(generated.module).toString("base64")}`);
  const f = remote(), shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(await remoteMcpArtifactPlugin(module.default, { binding: { env: {} }, commands: { fetch: f.fetch } }));
  try {
    const result = await shell.exec("catalog search_items --query 005930");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).structuredContent).toEqual({ query: "005930" });
    expect(f.requests.some(request => request.method === "tools/list")).toBe(false);
  } finally { await shell.dispose(); }
});

it("snapshots external documents before discovery and hashes their contents deterministically", async () => {
  const id = "https://catalog.example/schema", document = { type: "string", enum: ["b", "a"] };
  const registry = { [id]: document };
  const configuration = initRemoteMcpConfiguration([{ ...server, tools: [tool] }]).configuration;
  const pending = generateRemoteMcpArtifact(configuration, { schemaRegistry: registry });
  document.type = "integer";
  const first = await pending;
  const second = await generateRemoteMcpArtifact(configuration, { schemaRegistry: { [id]: { enum: ["b", "a"], type: "string" } } });
  expect(first.json).toBe(second.json);
  expect(first.module).toBe(second.module);
  const changed = structuredClone(first.artifact);
  changed.schemaRegistry![id] = false;
  expect(() => parseRemoteMcpArtifact(changed)).toThrow("digest");
});

it("rejects unsafe or oversized registries before reading credentials or connecting", async () => {
  const { configuration } = initRemoteMcpConfiguration([{ ...server, auth: { type: "bearer", env: "TOKEN" } }]);
  const getter = vi.fn(() => ({ type: "string" })), fetch = vi.fn<HttpTransportFetch>();
  const registry = Object.defineProperty({}, "https://catalog.example/schema", { enumerable: true, get: getter });
  const env = { get TOKEN(): string { throw new Error("read secret"); } };
  await expect(generateRemoteMcpArtifact(configuration, { schemaRegistry: registry, binding: { env }, schema: { fetch } })).rejects.toThrow("schema registry");
  await expect(generateRemoteMcpArtifact(configuration, { schemaRegistry: { large: { description: "x".repeat(1024) } }, maxArtifactBytes: 100, binding: { env }, schema: { fetch } })).rejects.toThrow("artifact byte limit");
  expect(getter).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("refuses incomplete external-reference artifacts instead of emitting unusable commands", async () => {
  const configuration = initRemoteMcpConfiguration([{ ...server, tools: [{ ...tool, inputSchema: { $ref: "https://catalog.example/missing" } }] }]).configuration;
  await expect(generateRemoteMcpArtifact(configuration)).rejects.toThrow();
});

it("rejects conflicting host registry overrides before consulting runtime credentials", async () => {
  const id = "https://catalog.example/schema", registry = { [id]: { type: "string" } };
  const { configuration } = initRemoteMcpConfiguration([{ ...server, tools: [tool], auth: { type: "bearer", env: "TOKEN" } }]);
  const generated = await generateRemoteMcpArtifact(configuration, { schemaRegistry: registry });
  const env = { get TOKEN(): string { throw new Error("read secret"); } };
  await expect(remoteMcpArtifactPlugin(generated.artifact, { binding: { env }, commands: { schemaValidation: { registry: { [id]: false } } } })).rejects.toThrow("registry conflict");
  const f = remote(), shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(await remoteMcpArtifactPlugin(generated.artifact, { binding: { env: { TOKEN: "runtime-secret" } }, commands: { fetch: f.fetch, schemaValidation: { registry } } }));
  try { expect((await shell.exec("catalog search_items --query x")).exitCode).toBe(0); }
  finally { await shell.dispose(); }
});

it("rejects host additions that could redefine archived document identities", async () => {
  const id = "https://catalog.example/schema";
  const configuration = initRemoteMcpConfiguration([{ ...server, tools: [{ ...tool, inputSchema: { $ref: id } }] }]).configuration;
  const generated = await generateRemoteMcpArtifact(configuration, { schemaRegistry: { [id]: tool.inputSchema } });
  await expect(remoteMcpArtifactPlugin(generated.artifact, { binding: { env: {} }, commands: { schemaValidation: { registry: {
    "https://catalog.example/z-alias": { $id: id, type: "object", properties: { query: { type: "integer" } } }
  } } } })).rejects.toThrow("registry conflict");
});

it("quarantines resolved credentials present in archived external documents", async () => {
  const f = remote(), { configuration } = initRemoteMcpConfiguration([{ ...server, auth: { type: "bearer", env: "TOKEN" } }]);
  const error = await generateRemoteMcpArtifact(configuration, { schemaRegistry: { "https://catalog.example/schema": { description: "private-token-value" } }, binding: { env: { TOKEN: "private-token-value" } }, schema: { fetch: f.fetch } }).catch(error => error);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain("resolved credential");
  expect(error.message).not.toContain("private-token-value");
});

it("keeps registry snapshots unchanged while remote discovery is awaiting the host", async () => {
  const id = "https://catalog.example/schema", document = { type: "string" }, f = remote();
  let started!: () => void, resume!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const fetch: HttpTransportFetch = async (url, init) => {
    if (JSON.parse(String(init?.body)).method === "initialize") { started(); await gate; }
    return f.fetch(url, init);
  };
  const pending = generateRemoteMcpArtifact(initRemoteMcpConfiguration([server]).configuration, { schemaRegistry: { [id]: document }, schema: { fetch } });
  await ready;
  document.type = "integer";
  resume();
  expect((await pending).artifact.schemaRegistry).toEqual({ [id]: { type: "string" } });
});

it("rejects invalid archived documents even after recomputing their digest", async () => {
  const generated = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([{ ...server, tools: [tool] }]).configuration, { schemaRegistry: { "https://catalog.example/schema": true } });
  const changed = structuredClone(generated.artifact);
  changed.schemaRegistry!["https://catalog.example/schema"] = { type: "invalid" };
  const { digest: ignoredDigest, ...payload } = changed;
  changed.digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  expect(() => parseRemoteMcpArtifact(changed)).toThrow("JSON Schema type");
});

it("keeps older version-one artifacts compatible with host external registrations", async () => {
  const id = "https://catalog.example/schema";
  const generated = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([{ ...server, tools: [tool] }]).configuration);
  const legacy = structuredClone(generated.artifact);
  legacy.configuration.servers[0].tools![0].inputSchema = { $ref: id };
  legacy.schemas[0].tools[0].inputSchema = { $ref: id };
  const { digest: ignoredDigest, ...payload } = legacy;
  legacy.digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  expect(parseRemoteMcpArtifact(legacy).schemaRegistry).toBeUndefined();
  const f = remote(), shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(await remoteMcpArtifactPlugin(legacy, { binding: { env: {} }, commands: { fetch: f.fetch, schemaValidation: { registry: { [id]: tool.inputSchema } } } }));
  try { expect((await shell.exec("catalog search_items --query 005930")).exitCode).toBe(0); }
  finally { await shell.dispose(); }
});

it("retains the artifact discovery signal when its caller replaces the handle during initialization", async () => {
  const f = remote(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const options = { schema: { signal: new AbortController().signal, fetch: (async (url, init) => {
    if (init?.method === "POST" && JSON.parse(String(init.body)).method === "initialize") { entered.resolve(); await release.promise; }
    return f.fetch(url, init);
  }) as HttpTransportFetch } };
  const pending = generateRemoteMcpArtifact(initRemoteMcpConfiguration([server]).configuration, options);
  const outcome = pending.catch(error => error);
  try {
    await entered.promise; options.schema.signal = AbortSignal.abort(new Error("replacement cancellation")); release.resolve();
    const result = await outcome; expect(result).not.toBeInstanceOf(Error);
    expect(result.artifact.schemas[0].tools).toEqual([tool]);
  } finally { release.resolve(); await outcome; }
});

it.each(["tighten", "loosen"])("retains the artifact configuration tool ceiling when its caller chooses to %s it during discovery", async mutation => {
  const f = remote(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const tools = [tool, { ...tool, name: "second" }];
  const options = { maxTools: mutation === "tighten" ? 2 : 1, schema: { fetch: (async (url, init) => {
    const request = init?.method === "POST" ? JSON.parse(String(init.body)) : null;
    if (request?.method === "initialize") { entered.resolve(); await release.promise; }
    if (request?.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: request.id, result: { tools } });
    return f.fetch(url, init);
  }) as HttpTransportFetch } };
  const pending = generateRemoteMcpArtifact(initRemoteMcpConfiguration([server]).configuration, options);
  const outcome = pending.catch(error => error);
  try {
    await entered.promise; options.maxTools = mutation === "tighten" ? 1 : 2; release.resolve();
    const result = await outcome;
    if (mutation === "tighten") { expect(result).not.toBeInstanceOf(Error); expect(result.artifact.schemas[0].tools).toEqual([...tools].sort((a, b) => a.name.localeCompare(b.name))); }
    else { expect(result).toBeInstanceOf(Error); expect(result.message).toContain("tool limit"); }
  } finally { release.resolve(); await outcome; }
});

it.each(["replace environment", "mutate environment", "store callback"])("quarantines original header credentials after the host chooses to %s during binding", async mutation => {
  const f = remote(), key = "original-private-header-key";
  const config = initRemoteMcpConfiguration([{ ...server, headers: { "X-Key": { env: "KEY" } }, auth: {
    type: "oauth", clientMode: "static", env: { clientId: "ID" }
  } }]).configuration;
  const binding = { env: { KEY: key, ID: "original-app", MCP_CATALOG_ACCESS_TOKEN: "private-grant", MCP_CATALOG_EXPIRES_IN: "60" }, oauth: {
    now: () => { if (mutation === "replace environment") binding.env = { ...binding.env, KEY: "replacement-private-header-key" };
      if (mutation === "mutate environment") binding.env.KEY = "replacement-private-header-key"; return 1000; },
    sessionStore: () => { if (mutation === "store callback") binding.env.KEY = "replacement-private-header-key";
      return { load: async () => null, save: async () => {}, clear: async () => {} }; }
  } };
  const fetch: HttpTransportFetch = async (url, init) => {
    expect(new Headers(init?.headers).get("X-Key")).toBe(key);
    const response = await f.fetch(url, init);
    if (!response.ok || response.status === 202 || response.status === 204) return response;
    const value = await response.json();
    if (value.result?.serverInfo) value.result.serverInfo.name = key;
    return Response.json(value);
  };
  const error = await generateRemoteMcpArtifact(config, { binding, schema: { fetch } }).catch(error => error);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain("resolved credential"); expect(error.message).not.toContain(key);
});
