import { describe, expect, it, vi } from "vitest";
import {
  CommandRegistry, createCommandArguments, toByteSource,
  type CommandContext, type CommandDefinition, type ByteSink
} from "@poe-platform/safe-bash/contracts";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import type { CallToolResult, HttpTransportFetch, Tool } from "tiny-mcp-client";
import { createRemoteMcpCommands, remoteMcpCommands } from "./index.js";

const tool: Tool = { name: "search_items", description: "Find catalog items", inputSchema: {
  type: "object", properties: { query: { type: "string" }, limit: { type: "integer", default: 10 },
    filters: { type: "object" }, tags: { type: "array", items: { type: "string" } } },
  required: ["query"], additionalProperties: false
} };
const server = { name: "catalog", url: "https://catalog.example/mcp", tools: [tool], protocolVersion: "2025-03-26" as const };
const success: CallToolResult = { content: [{ type: "text", text: "first" }, { type: "text", text: "second" }], structuredContent: { rows: [{ id: 1 }, { id: 2 }] } };

function remote(result: unknown = success, options: { rpcError?: boolean; waitForCall?: boolean } = {}) {
  const requests: { method: string; params?: { name?: string; arguments?: Record<string, unknown> } }[] = [];
  let started!: () => void;
  const callStarted = new Promise<void>(resolve => { started = resolve; });
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method !== "POST") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init.body));
    requests.push(request);
    if (request.method === "notifications/initialized" || request.method === "notifications/cancelled") return new Response(null, { status: 202 });
    const value = request.method === "initialize" ? {
      protocolVersion: "2025-03-26", capabilities: { tools: {} },
      serverInfo: { name: "catalog", version: "1" }, instructions: "Prefer read operations"
    } : request.method === "tools/list" ? { tools: [tool] } : result;
    if (request.method === "tools/call") {
      started();
      if (options.waitForCall) return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }
    const payload = request.method === "tools/call" && options.rpcError ? { error: result } : { result: value };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...payload }), {
      headers: { "Content-Type": "application/json", "Mcp-Session-Id": "catalog-session" }
    });
  });
  return { fetch, requests, callStarted };
}

function invocation(args: readonly (string | Uint8Array)[], options: { signal?: AbortSignal; stdin?: string | Uint8Array; stdout?: ByteSink } = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const carrier = createCommandArguments([]).withValues(args);
  const context: CommandContext = {
    command: "catalog", args: carrier.args, argumentValues: carrier,
    signal: options.signal ?? new AbortController().signal,
    stdin: toByteSource(options.stdin ?? ""),
    stdout: options.stdout ?? { async write(chunk) { stdout.push(Uint8Array.from(chunk)); } },
    stderr: { async write(chunk) { stderr.push(Uint8Array.from(chunk)); } },
    cwd: "/", env: {}, fs: {} as CommandContext["fs"]
  };
  return { context, output: () => Buffer.concat(stdout).toString("utf8"), error: () => Buffer.concat(stderr).toString("utf8") };
}

async function command(fixture = remote(), tools: readonly Tool[] = [tool]): Promise<CommandDefinition> {
  return (await createRemoteMcpCommands([{ ...server, tools }], { fetch: fixture.fetch }))[0];
}

describe("generated remote MCP safe-bash commands", () => {
  it("prints only the exact selected tool metadata offline and snapshots it before caller mutation", async () => {
    const fixture = remote();
    const selected: Tool = { ...tool, name: "API-post-page.detail", annotations: { readOnlyHint: true },
      outputSchema: { type: "object", properties: { id: { type: "string" } } } };
    const expected = structuredClone(selected);
    const definition = await command(fixture, [selected, { ...tool, name: "API-post-page" }]);
    selected.annotations!.readOnlyHint = false;
    const input = invocation(["API-post-page.detail", "--schema"]);
    expect(await definition.execute(input.context)).toEqual({ exitCode: 0 });
    expect(JSON.parse(input.output())).toEqual(expected);
    expect(input.error()).toBe("");
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("inspects a literal dash-prefixed tool without calling it", async () => {
    const fixture = remote();
    const selected = { ...tool, name: "--schema" };
    const input = invocation(["--", "--schema", "--schema"]);
    expect(await (await command(fixture, [selected])).execute(input.context)).toEqual({ exitCode: 0 });
    expect(JSON.parse(input.output())).toEqual(selected);
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("does not interpret a raw value equal to --schema as inspection", async () => {
    const fixture = remote();
    const input = invocation(["search_items", "--raw", "--schema"]);
    expect(await (await command(fixture)).execute(input.context)).toEqual({ exitCode: 2 });
    expect(input.output()).toBe("");
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("keeps a schema field independently invokable through its collision-safe flag", async () => {
    const fixture = remote();
    const selected: Tool = { name: "configure", inputSchema: { type: "object", properties: { schema: { type: "string" } }, required: ["schema"] } };
    const input = invocation(["configure", "--schema-2=--schema"]);
    expect(await (await command(fixture, [selected])).execute(input.context)).toEqual({ exitCode: 0 });
    expect(fixture.requests.find(request => request.method === "tools/call")?.params?.arguments).toEqual({ schema: "--schema" });
  });

  it("surfaces discovered server instructions in server and tool help without reconnecting", async () => {
    const fixture = remote();
    const [definition] = await createRemoteMcpCommands([{ ...server, tools: undefined }], { fetch: fixture.fetch });
    fixture.fetch.mockClear();
    for (const args of [["--help"], ["search_items", "--help"]]) {
      const input = invocation(args);
      expect(await definition.execute(input.context)).toEqual({ exitCode: 0 });
      expect(input.output()).toContain("Instructions:\nPrefer read operations\n");
    }
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("retains supplied multiline instructions while escaping terminal controls", async () => {
    const fixture = remote();
    const [definition] = await createRemoteMcpCommands([{ ...server, instructions: "Read first\nThen write\u001b[31m\r\nLast step" }], { fetch: fixture.fetch });
    const input = invocation(["--help"]);
    expect(await definition.execute(input.context)).toEqual({ exitCode: 0 });
    expect(input.output()).toContain("Instructions:\nRead first\nThen write\\u001b[31m\nLast step\n");
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("generates commands from supplied schemas without fetching", async () => {
    const fixture = remote();
    const commands = await createRemoteMcpCommands([server], { fetch: fixture.fetch });
    expect(commands.map(command => command.name)).toEqual(["catalog"]);
    expect(new CommandRegistry(commands).has("catalog")).toBe(true);
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("exposes only caller-selected tool schemas without ambient catalog discovery", async () => {
    const fixture = remote();
    const selected = { ...tool, name: "selected" };
    const definition = await command(fixture, [selected]);
    const help = invocation(["--help"]);
    expect(await definition.execute(help.context)).toEqual({ exitCode: 0 });
    expect(help.output()).toContain("selected");
    expect(help.output()).not.toContain("search_items");
    const excluded = invocation(["search_items", "--query", "hidden"]);
    expect(await definition.execute(excluded.context)).toEqual({ exitCode: 2 });
    expect(fixture.fetch).not.toHaveBeenCalled();
    const call = invocation(["selected", "--query", "visible"]);
    expect(await definition.execute(call.context)).toEqual({ exitCode: 0 });
    expect(fixture.requests.some(request => request.method === "tools/list")).toBe(false);
    expect(fixture.requests.find(request => request.method === "tools/call")?.params?.name).toBe("selected");
  });

  it("fetches absent schemas automatically before generating commands", async () => {
    const fixture = remote();
    const commands = await createRemoteMcpCommands([{ ...server, tools: undefined }], { fetch: fixture.fetch });
    expect(commands[0].name).toBe("catalog");
    expect(fixture.requests.map(request => request.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
  });

  it("passes schema-aware arguments through the actual client without coercion or field loss", async () => {
    const fixture = remote();
    const definition = await command(fixture);
    const input = invocation(["search_items", "--query", "005930", "--limit", "5", "--filters", '{"nested":[1,2]}', "--tags", '["first,a","second"]']);
    expect(await definition.execute(input.context)).toEqual({ exitCode: 0 });
    expect(fixture.requests.find(request => request.method === "tools/call")?.params).toEqual({
      name: "search_items", arguments: { query: "005930", limit: 5, filters: { nested: [1, 2] }, tags: ["first,a", "second"] }
    });
    expect(JSON.parse(input.output())).toEqual(success);
    expect(input.error()).toBe("");
    expect(fixture.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("retains nested field arrays through named and raw calls without requesting tool metadata", async () => {
    const selected: Tool = { name: "create_workitem", inputSchema: { type: "object", properties: {
      work_item_type: { type: "string" }, project_key: { type: "string" }, fields: { type: "array", items: {
        type: "object", properties: { field_key: { type: "string" }, field_value: {} },
        required: ["field_key", "field_value"], additionalProperties: false
      } }
    }, required: ["work_item_type", "project_key", "fields"], additionalProperties: false } };
    const expected = { work_item_type: "requirement", project_key: "00123", fields: [
      { field_key: "name", field_value: "Test Requirement" },
      { field_key: "details", field_value: { enabled: false, count: 0, owners: ["001", "002"], parent: null } }
    ] };
    const fixture = remote();
    const fetch: HttpTransportFetch = async (url, init) => {
      if (init?.method === "POST" && JSON.parse(String(init.body)).method === "tools/list")
        throw new Error("metadata unavailable");
      return fixture.fetch(url, init);
    };
    const [definition] = await createRemoteMcpCommands([{ ...server, tools: [selected] }], { fetch });
    for (const args of [
      ["work_item_type=requirement", "project_key=00123", `fields=${JSON.stringify(expected.fields)}`],
      ["--raw", JSON.stringify(expected)]
    ]) {
      const input = invocation(["create_workitem", ...args]);
      expect(await definition.execute(input.context)).toEqual({ exitCode: 0 });
      expect(input.error()).toBe("");
    }
    expect(fixture.requests.filter(request => request.method === "tools/call").map(request => request.params?.arguments))
      .toEqual([expected, expected]);
    fixture.fetch.mockClear();
    const invalid = invocation(["create_workitem", "work_item_type=requirement", "project_key=00123", "fields:name=Test Requirement"]);
    expect(await definition.execute(invalid.context)).toEqual({ exitCode: 2 });
    expect(invalid.output()).toBe("");
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("preserves schema-owned execution-option names through named and raw native calls", async () => {
    const fixture = remote();
    const selected: Tool = { name: "policy_fields", inputSchema: { type: "object", properties: {
      args: { type: "object" }, disableOAuth: { type: "boolean" }, timeout: { type: "integer" },
      autoAuthorize: { type: "boolean" }, allowCachedAuth: { type: "boolean" },
      yes: { type: "boolean" }, raw: { type: "string" }, help: { type: "string" }
    }, required: ["args", "disableOAuth", "timeout", "autoAuthorize", "allowCachedAuth", "yes", "raw", "help"], additionalProperties: false } };
    const expected = { args: { nested: [0, false, null] }, disableOAuth: true, timeout: 0,
      autoAuthorize: true, allowCachedAuth: false, yes: false, raw: "--help", help: "--schema" };
    const definition = await command(fixture, [selected]);
    for (const argumentsList of [
      ["--args", JSON.stringify(expected.args), "--disable-oauth", "--timeout", "0", "--auto-authorize",
        "--allow-cached-auth=false", "--yes-2=false", "--raw-2=--help", "--help-2=--schema"],
      ["--raw", JSON.stringify(expected)]
    ]) {
      const input = invocation([selected.name, ...argumentsList]);
      expect(await definition.execute(input.context)).toEqual({ exitCode: 0 });
      expect(input.error()).toBe("");
    }
    expect(fixture.requests.filter(request => request.method === "tools/call").map(request => request.params))
      .toEqual([{ name: selected.name, arguments: expected }, { name: selected.name, arguments: expected }]);
    expect(fixture.requests.some(request => request.method === "tools/list")).toBe(false);
  });

  it("prints exact invokable tool names and generated flags in help without connecting", async () => {
    const fixture = remote();
    const definition = await command(fixture);
    for (const args of [["--help"], ["search_items", "--help"]]) {
      const input = invocation(args);
      expect(await definition.execute(input.context)).toEqual({ exitCode: 0 });
      expect(input.output()).toContain("search_items");
    }
    const detail = invocation(["search_items", "--help"]);
    await definition.execute(detail.context);
    expect(detail.output()).toContain("--query");
    expect(detail.output()).toContain("--raw");
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid arguments before opening any RPC connection", async () => {
    const fixture = remote();
    const definition = await command(fixture);
    const input = invocation(["search_items", "--limit", "invalid"]);
    expect(await definition.execute(input.context)).toEqual({ exitCode: 2 });
    expect(input.error()).toContain("limit");
    expect(input.output()).toBe("");
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("uses raw JSON to fulfill required arguments without a separate flag", async () => {
    const fixture = remote();
    const input = invocation(["search_items", "--raw", '{"query":"1234567890.123456","filters":{"nested":true}}']);
    expect(await (await command(fixture)).execute(input.context)).toEqual({ exitCode: 0 });
    expect(fixture.requests.find(request => request.method === "tools/call")?.params?.arguments)
      .toEqual({ query: "1234567890.123456", filters: { nested: true } });
  });

  it("reads --raw - from the virtual command's stdin", async () => {
    const fixture = remote();
    const input = invocation(["search_items", "--raw", "-"], { stdin: '{"query":"stdin","tags":["one","two"]}' });
    expect(await (await command(fixture)).execute(input.context)).toEqual({ exitCode: 0 });
    expect(fixture.requests.find(request => request.method === "tools/call")?.params?.arguments)
      .toEqual({ query: "stdin", tags: ["one", "two"] });
  });

  it("applies defaults only when --yes is supplied", async () => {
    const fixture = remote();
    const definition = await command(fixture);
    for (const args of [["search_items", "--query", "a"], ["search_items", "--query", "b", "--yes"]])
      await definition.execute(invocation(args).context);
    expect(fixture.requests.filter(request => request.method === "tools/call").map(request => request.params?.arguments))
      .toEqual([{ query: "a" }, { query: "b", limit: 10 }]);
  });

  it("retains all result blocks, metadata and structured data", async () => {
    const result = { ...success, _meta: { trace: "abc" }, content: [
      ...success.content,
      { type: "image", data: "AAE=", mimeType: "image/png" },
      { type: "audio", data: "AAE=", mimeType: "audio/wav" },
      { type: "resource_link", name: "document", uri: "https://example.test/document", mimeType: "text/plain" },
      { type: "resource", resource: { uri: "https://example.test/text", text: "resource text", mimeType: "text/plain" } },
      { type: "resource", resource: { uri: "https://example.test/blob", blob: "AAE=", mimeType: "application/octet-stream" } }
    ] };
    const input = invocation(["search_items", "--query", "all"]);
    expect(await (await command(remote(result))).execute(input.context)).toEqual({ exitCode: 0 });
    expect(JSON.parse(input.output())).toEqual(result);
  });

  it.each([
    { content: [{ type: "text", text: '{\n  "entities": [],\n  "relations": []\n}' }], structuredContent: { entities: [], relations: [] } },
    { content: [{ type: "text", text: '{"id":1}' }, { type: "text", text: '{"id":2}' }], structuredContent: { result: [{ id: 1 }, { id: 2 }] } },
    { content: [{ type: "text", text: '{"status":"error","summary":"failed","data":{},"meta":{}}' }],
      structuredContent: { json: { privateWrapperName: true }, data: {}, status: "error", summary: "failed", meta: {}, trace_id: "retained" }, isError: true },
    { content: [{ type: "text", text: "not JSON; no inspect fallback" }], structuredContent: { status: "ok", summary: "plain object" } }
  ])("preserves ambiguous text/structured result shapes without wrapper guesses: %j", async result => {
    const input = invocation(["search_items", "--query", "all"]);
    expect(await (await command(remote(result))).execute(input.context)).toEqual({ exitCode: result.isError ? 1 : 0 });
    expect(JSON.parse(input.output())).toEqual(result);
    expect(input.error()).toBe("");
  });

  it("returns nonzero on tool failure without collapsing the result", async () => {
    const result = { ...success, isError: true, structuredContent: { data: { error: "failed" }, detail: "preserved" } };
    const input = invocation(["search_items", "--query", "failure"]);
    expect(await (await command(remote(result))).execute(input.context)).toEqual({ exitCode: 1 });
    expect(JSON.parse(input.output())).toEqual(result);
  });

  it("retains protocol error code and data in diagnostics", async () => {
    const input = invocation(["search_items", "--query", "failure"]);
    const fixture = remote({ code: -32001, message: "server failed", data: { data: [1, 2], detail: "preserved" } }, { rpcError: true });
    expect(await (await command(fixture)).execute(input.context)).toEqual({ exitCode: 1 });
    expect(input.output()).toBe("");
    expect(JSON.parse(input.error())).toMatchObject({ error: { code: -32001, message: "server failed", data: { data: [1, 2], detail: "preserved" } } });
  });

  it("waits for output to drain and retains output larger than 64 KiB", async () => {
    const result = { content: [{ type: "text", text: "x".repeat(150_000) }] };
    const chunks: Uint8Array[] = [];
    let complete = false;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    const input = invocation(["search_items", "--query", "large"], { stdout: { async write(chunk) {
      started(); await blocked; chunks.push(Uint8Array.from(chunk));
    } } });
    const pending = (await command(remote(result))).execute(input.context);
    const completion = Promise.resolve(pending).then(value => { complete = true; return value; });
    await writing;
    expect(complete).toBe(false);
    release();
    expect(await completion).toEqual({ exitCode: 0 });
    expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(result);
  });

  it("rejects invalid UTF-8 argument bytes before opening an RPC connection", async () => {
    const fixture = remote();
    const input = invocation(["search_items", "--query", Uint8Array.of(0xff)]);
    expect(await (await command(fixture)).execute(input.context)).toEqual({ exitCode: 2 });
    expect(input.error()).toContain("UTF-8");
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("propagates cancellation identity and closes an in-flight tool request", async () => {
    const fixture = remote(success, { waitForCall: true });
    const controller = new AbortController();
    const reason = { cancelled: true };
    const input = invocation(["search_items", "--query", "wait"], { signal: controller.signal });
    const pending = (await command(fixture)).execute(input.context);
    const assertion = expect(pending).rejects.toBe(reason);
    await fixture.callStarted;
    controller.abort(reason);
    await assertion;
    expect(fixture.fetch.mock.calls.filter(([, init]) => init?.method === "POST").some(([, init]) => init?.signal?.aborted)).toBe(true);
  });

  it("preflights every command name before discovering any schemas", async () => {
    const fixture = remote();
    await expect(createRemoteMcpCommands([{ ...server, tools: undefined }, { ...server, name: "bad name" }], { fetch: fixture.fetch }))
      .rejects.toThrow("command name");
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("preflights plugin registry conflicts before registering any command", async () => {
    const registry = new CommandRegistry([{ name: "second", execute() { return { exitCode: 0 }; } }]);
    const plugin = await remoteMcpCommands([{ ...server, name: "first" }, { ...server, name: "second" }]);
    await expect(Promise.resolve().then(() => plugin.setup({ commands: registry, use() {}, registerFileSystem() {} }))).rejects.toThrow("second");
    expect(registry.has("first")).toBe(false);
  });

  it("routes literal tool names beginning with dashes using --", async () => {
    const fixture = remote();
    const definition = await command(fixture, [{ ...tool, name: "--help" }]);
    const input = invocation(["--", "--help", "--query", "literal"]);
    expect(await definition.execute(input.context)).toEqual({ exitCode: 0 });
    expect(fixture.requests.find(request => request.method === "tools/call")?.params?.name).toBe("--help");
  });
  it("propagates help output failures without reporting an argument error", async () => {
    const failure = new Error("sink unavailable");
    for (const args of [["--help"], ["search_items", "--help"]]) {
      const input = invocation(args, { stdout: { async write() { throw failure; } } });
      await expect((await command()).execute(input.context)).rejects.toBe(failure);
      expect(input.error()).toBe("");
    }
  });

  it("validates a raw value equal to --help instead of treating it as help", async () => {
    const fixture = remote();
    const input = invocation(["search_items", "--raw", "--help"]);
    expect(await (await command(fixture)).execute(input.context)).toEqual({ exitCode: 2 });
    expect(input.output()).toBe("");
    expect(input.error()).toContain("JSON");
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("validates structured output and preserves the complete invalid result", async () => {
    const result = { content: [{ type: "text", text: "retained" }], structuredContent: { count: "wrong" } };
    const input = invocation(["search_items", "--query", "output"]);
    const definition = await command(remote(result), [{ ...tool, outputSchema: {
      type: "object", properties: { count: { type: "integer" } }, required: ["count"]
    } }]);
    expect(await definition.execute(input.context)).toEqual({ exitCode: 1 });
    expect(JSON.parse(input.output())).toEqual(result);
    expect(input.error()).toContain("Invalid tool output");
  });

  it("snapshots external output schemas before caller mutation", async () => {
    const registry = { "https://example.test/output": { type: "object", properties: { count: { type: "integer" } } } };
    const fixture = remote({ content: [], structuredContent: { count: 2 } });
    const [definition] = await createRemoteMcpCommands([{ ...server, tools: [{ ...tool, outputSchema: {
      $ref: "https://example.test/output"
    } }] }], { fetch: fixture.fetch, schemaValidation: { registry } });
    registry["https://example.test/output"].properties.count.type = "string";
    const input = invocation(["search_items", "--query", "output"]);
    expect(await definition.execute(input.context)).toEqual({ exitCode: 0 });
    expect(input.error()).toBe("");
  });

  it("runs generated commands in a real virtual shell with quoting, stdin and redirection", async () => {
    const fixture = remote();
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input.json", new TextEncoder().encode('{"query":"005930"}'));
    const shell = new Shell({ fs }).use(await remoteMcpCommands([server], { fetch: fixture.fetch }));
    try {
      const result = await shell.exec("catalog search_items --raw - </input.json >/result.json");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(JSON.parse(new TextDecoder().decode(await fs.readFile("/result.json")))).toEqual(success);
      const quoted = await shell.exec("catalog search_items --query 'space, quote and 005930'");
      expect(quoted.exitCode).toBe(0);
      expect(fixture.requests.filter(request => request.method === "tools/call").map(request => request.params?.arguments))
        .toEqual([{ query: "005930" }, { query: "space, quote and 005930" }]);
    } finally { await shell.dispose(); }
  });

  it.each([{ name: "oversized", stdin: new Uint8Array(200).fill(32) }, { name: "invalid UTF-8", stdin: Uint8Array.of(0xff) }])("rejects $name stdin before RPC", async ({ stdin }) => {
    const fixture = remote();
    const [definition] = await createRemoteMcpCommands([server], { fetch: fixture.fetch, maxInputBytes: 100 });
    const input = invocation(["search_items", "--raw=-"], { stdin });
    expect(await definition.execute(input.context)).toEqual({ exitCode: 2 });
    expect(input.error()).not.toBe("");
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("primes supplied parameter header annotations on modern calls without listing tools", async () => {
    const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      if (request.method === "server/discover") return Response.json({ jsonrpc: "2.0", id: request.id, result: {
        resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, ttlMs: 0, cacheScope: "private"
      } });
      expect(request.method).toBe("tools/call");
      expect(new Headers(init?.headers).get("Mcp-Param-Tenant")).toBe("=?base64?5LiW55WM?=");
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { resultType: "complete", content: [] } });
    });
    const [definition] = await createRemoteMcpCommands([{ ...server, protocolVersion: "2026-07-28", tools: [{
      name: "tenant", inputSchema: { type: "object", properties: { tenant: { type: "string", "x-mcp-header": "Tenant" } } }
    }] }], { fetch });
    const input = invocation(["tenant", "--tenant", "世界"]);
    expect(await definition.execute(input.context), input.error()).toEqual({ exitCode: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("calls legacy SSE tools through the actual client and closes the event stream", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const encoder = new TextEncoder();
    const methods: string[] = [];
    const fetch = vi.fn<HttpTransportFetch>(async (url, init) => {
      if (init?.method === "POST" && url.toString() === server.url) return new Response(null, { status: 405 });
      if (init?.method === "GET") return new Response(new ReadableStream({
        start(controller) { stream = controller; stream.enqueue(encoder.encode("event: endpoint\ndata: /messages\n\n")); }, cancel
      }), { headers: { "Content-Type": "text/event-stream" } });
      const request = JSON.parse(String(init?.body));
      methods.push(request.method);
      if (request.id !== undefined) {
        const result = request.method === "initialize" ? {
          protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "legacy", version: "1" }
        } : success;
        stream.enqueue(encoder.encode(`data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n\n`));
      }
      return new Response(null, { status: 202 });
    });
    const [definition] = await createRemoteMcpCommands([server], { fetch });
    const input = invocation(["search_items", "--query", "legacy"]);
    expect(await definition.execute(input.context)).toEqual({ exitCode: 0 });
    expect(JSON.parse(input.output())).toEqual(success);
    expect(methods).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    { input: ["query:005930", "limit:=5", 'filters:{"nested":[1,2]}'], value: { query: "005930", limit: 5, filters: { nested: [1, 2] } } },
    { input: ["query=1234567890.123456", "--tags", "first", "--tags", "second"], value: { query: "1234567890.123456", tags: ["first", "second"] } },
    { input: ["--raw", '{"query":"1234567890.123456","limit":5,"filters":{"nested":[1,2]},"tags":["first,a","second"]}'],
      value: { query: "1234567890.123456", limit: 5, filters: { nested: [1, 2] }, tags: ["first,a", "second"] } }
  ])("retains upstream argument regression values through native RPC: $input", async ({ input, value }) => {
    const fixture = remote();
    const invocationValue = invocation(["search_items", ...input]);
    expect(await (await command(fixture)).execute(invocationValue.context)).toEqual({ exitCode: 0 });
    expect(fixture.requests.find(request => request.method === "tools/call")?.params?.arguments).toEqual(value);
  });

});
