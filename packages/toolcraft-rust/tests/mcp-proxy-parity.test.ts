import { afterEach, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { toJsonSchema } from "toolcraft-schema-rust";

const events: unknown[] = [];
let response: unknown;
let connectGate: Promise<void> | undefined;
let closeFailure: unknown;
class Client {
  state = "disconnected";
  serverInfo = { name: "fixture", version: "1" };
  constructor(options: unknown) { events.push(["client", options]); }
  async connect(transport: unknown) { events.push(["connect", transport]); if (connectGate) await connectGate; this.state = "ready"; }
  async listTools(params: unknown) { events.push(["list", params]); return { tools: [remoteTool] }; }
  async callTool(params: unknown, options: unknown) { events.push(["call", params, options]); return response; }
  async close() { events.push(["close"]); this.state = "closed"; if (closeFailure !== undefined) throw closeFailure; }
}
class Transport { constructor(readonly options: unknown) {} }
const clients = { McpClient: Client, HttpTransport: Transport, StdioTransport: Transport };
vi.mock("tiny-mcp-client-rust", () => clients);
vi.mock("tiny-mcp-client", () => clients);
vi.mock("toolcraft-design-rust", () => ({ createLogger: () => ({ info: (message: string) => events.push(["log", message]) }) }));
vi.mock("toolcraft-design", () => ({ createLogger: () => ({ info: (message: string) => events.push(["log", message]) }) }));
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("node:fs", async () => (await import("memfs")).fs);
vi.mock("node:crypto", async importOriginal => ({ ...await importOriginal<object>(), randomUUID: () => "fixture-id" }));

const native = await import("../dist/mcp-proxy.js");
const reference = await import("../../toolcraft/src/mcp-proxy.js");
const remoteTool = { name: "remote", title: "Title", description: "Description", annotations: { readOnlyHint: true },
  inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
  outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } };
const originalRefresh = process.env.TOOLCRAFT_MCP_REFRESH;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); if (originalRefresh === undefined) delete process.env.TOOLCRAFT_MCP_REFRESH; else process.env.TOOLCRAFT_MCP_REFRESH = originalRefresh; });

function setup() {
  events.length = 0; response = { content: [], structuredContent: { value: "result" } }; connectGate = undefined; closeFailure = undefined;
  vol.reset(); vol.fromJSON({ "/repo/package.json": "{}" });
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  delete process.env.TOOLCRAFT_MCP_REFRESH;
}
function group(observe = false) {
  const wrap = <T extends object>(object: T, name: string): T => !observe ? object : new Proxy(object, {
    get(target, key, receiver) { events.push(["get", name, typeof key === "symbol" ? key.description : key]); return Reflect.get(target, key, receiver); }
  });
  const config = wrap({ transport: "stdio", command: "fixture", args: ["arg"], env: { KEY: "test" } }, "config");
  const root = { kind: "group", name: "upstream", scope: ["sdk"], secrets: { key: { env: "KEY" } }, requires: undefined,
    children: [], [Symbol("toolcraft.group.config")]: wrap({ mcp: config, rename: { remote: "nested.run" } }, "internal") };
  return wrap(root, "root");
}
function command(root: any): any { return root.children[0].children[0]; }
function tree(node: any): unknown {
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(node)) {
    if (key === "handler") output[key] = typeof node[key];
    else if (key === "children") output[key] = node[key].map(tree);
    else if (key === "params" || key === "result") output[key] = toJsonSchema(node[key]);
    else output[key] = node[key];
  }
  return { output, symbols: Object.getOwnPropertySymbols(node).map(symbol => ({ name: symbol.description, enumerable: Object.getOwnPropertyDescriptor(node, symbol)?.enumerable })) };
}

it("matches discovery side effects, metadata, getter order, hot calls and replacement", async () => {
  const run = async (lib: typeof reference) => {
    setup(); const root = group(true);
    await lib.resolveMcpProxies(root as never, { projectRoot: "/repo" });
    const discovered = tree(root);
    const first = await command(root).handler({ params: { value: "first" } });
    const second = await command(root).handler({ params: { value: "second" } });
    await lib.resolveMcpProxies(root as never, { projectRoot: "/repo" });
    const replacement = tree(root);
    await lib.disposeMcpProxies(root as never);
    return { discovered, replacement, first, second, events: [...events], files: vol.toJSON() };
  };
  expect(await run(native)).toEqual(await run(reference));
});

it("matches connection cancellation and disposal after the shared connection resolves", async () => {
  const run = async (lib: typeof reference) => {
    setup(); const root = group();
    await lib.resolveMcpProxies(root as never, { projectRoot: "/repo" });
    let release!: () => void;
    connectGate = new Promise(resolve => { release = resolve; });
    const controller = new AbortController();
    const reason = { cancelled: true };
    const pending = command(root).handler({ params: { value: "pending" }, signal: controller.signal });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    const disposing = lib.disposeMcpProxies(root as never);
    release();
    await disposing;
    return [...events];
  };
  expect(await run(native)).toEqual(await run(reference));
});

it("matches routine result errors and aggregate disposal failures without losing identity", async () => {
  for (const lib of [native, reference]) {
    setup(); const root = group();
    await lib.resolveMcpProxies(root as never, { projectRoot: "/repo" });
    response = { content: [{ type: "text", text: "failure" }], isError: true };
    expect(await command(root).handler({ params: { value: "input" } })).toMatchObject(response);
    const failure = Symbol("close failed"); closeFailure = failure;
    try { await lib.disposeMcpProxies(root as never); throw new Error("expected failure"); }
    catch (error) { expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors).toEqual([failure]); }
  }
});

it("creates own command metadata without invoking inherited setters", async () => {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "annotations");
  let writes = 0;
  Object.defineProperty(Object.prototype, "annotations", { configurable: true, get() { return undefined; }, set() { writes++; } });
  try {
    for (const lib of [native, reference]) {
      setup(); const root = group(); writes = 0;
      await lib.resolveMcpProxies(root as never, { projectRoot: "/repo" });
      expect(Object.getOwnPropertyDescriptor(command(root), "annotations")).toEqual({ value: { readOnlyHint: true }, writable: true, configurable: true, enumerable: true });
      expect(writes).toBe(0);
      await lib.disposeMcpProxies(root as never);
    }
  } finally { if (original) Object.defineProperty(Object.prototype, "annotations", original); else delete (Object.prototype as { annotations?: unknown }).annotations; }
});
