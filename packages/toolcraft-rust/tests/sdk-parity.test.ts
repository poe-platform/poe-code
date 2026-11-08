import { afterEach, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { S, defineCommand, defineGroup } from "../dist/index.js";

let attempts = 0;
let lists = 0;
let failure: unknown;
let gate: Promise<void> | undefined;
const calls: unknown[] = [];
class Client {
  state = "disconnected";
  serverInfo = { name: "fixture", version: "1" };
  async connect() { attempts++; if (gate) await gate; if (failure) throw failure; this.state = "ready"; }
  async listTools() { lists++; return { tools: [{ name: "remote", inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } }] }; }
  async callTool(input: unknown) { calls.push(input); return { content: [{ type: "text", text: "ok" }] }; }
  async close() { this.state = "closed"; }
}
class Transport {}
vi.mock("tiny-mcp-client-rust", () => ({ McpClient: Client, HttpTransport: Transport, StdioTransport: Transport }));
vi.mock("tiny-mcp-client", () => ({ McpClient: Client, HttpTransport: Transport, StdioTransport: Transport }));
vi.mock("toolcraft-design-rust", () => ({ createLogger: () => ({ info() {} }) }));
vi.mock("toolcraft-design", () => ({ createLogger: () => ({ info() {} }) }));
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("node:fs", async () => (await import("memfs")).fs);

const { createSDK: native } = await import("../dist/sdk.js");
const { createSDK: reference } = await import("../../toolcraft/src/sdk.js");
const { disposeMcpProxies } = await import("../dist/mcp-proxy.js");
afterEach(() => { vi.restoreAllMocks(); });

function setup() {
  vol.reset(); vol.fromJSON({ "/repo/package.json": "{}" });
  attempts = 0; lists = 0; failure = undefined; gate = undefined; calls.length = 0;
  const root = defineGroup({ name: "root", children: [defineGroup({ name: "upstream", children: [], mcp: { transport: "stdio", command: "fixture" } })] });
  return root;
}

it("shares deferred discovery, exposes only the root thenable and resolves callable paths", async () => {
  for (const create of [native, reference]) {
    const root = setup();
    let release!: () => void;
    gate = new Promise(resolve => { release = resolve; });
    const sdk = create(root, { projectRoot: "/repo", errorReports: false }) as any;
    expect(sdk.upstream.then).toBeUndefined();
    const first = sdk.upstream.remote({ value: "first" });
    const second = sdk.upstream.remote({ value: "second" });
    const ready = Promise.resolve(sdk);
    release();
    await Promise.all([first, second]);
    const resolved = await ready;
    expect(lists).toBe(1);
    expect(attempts).toBe(2); // Discovery closes its client; invocation opens one shared hot client.
    expect(Object.keys(resolved)).toEqual(["upstream"]);
    expect(calls).toEqual([{ name: "remote", arguments: { value: "first" } }, { name: "remote", arguments: { value: "second" } }]);
    await expect(sdk.upstream()).rejects.toThrow('SDK member "upstream" is not callable.');
    await expect(sdk[Symbol.for("missing")].nested()).rejects.toThrow('SDK member "Symbol(missing).nested" is not callable.');
    await expect(sdk.missing.nested()).rejects.toBeInstanceOf(TypeError);
    await disposeMcpProxies(root);
  }
});

it("retries rejected discovery for concurrent callers without retaining the rejected promise", async () => {
  for (const create of [native, reference]) {
    const root = setup();
    failure = new Error("fixture connection rejected");
    const sdk = create(root, { projectRoot: "/repo", errorReports: false }) as any;
    const results = await Promise.allSettled([sdk.upstream.remote({ value: "a" }), sdk.upstream.remote({ value: "b" })]);
    expect(attempts).toBe(1);
    expect(results[0].status).toBe("rejected");
    expect(results[1]).toEqual(results[0]);
    failure = undefined;
    await sdk.upstream.remote({ value: "retry" });
    expect(lists).toBe(1);
    expect(attempts).toBe(3);
    await disposeMcpProxies(root);
  }
});

it("awaits error persistence and retains report failure precedence", async () => {
  for (const create of [native, reference]) {
    setup();
    const failure = new Error("handler failed"); failure.stack = "stable stack";
    const root = defineGroup({ name: "root", children: [defineCommand({ name: "fail", params: S.Object({}), handler() { throw failure; } })] });
    const sdk = create(root, { projectRoot: "/repo", errorReports: true }) as any;
    await expect(sdk.fail()).rejects.toBe(failure);
    const files = vol.toJSON();
    const reports = Object.entries(files).filter(([name]) => name.includes("/.toolcraft/errors/"));
    expect(reports).toHaveLength(1);
    expect(reports[0][1]).toContain("handler failed");
    const invalid = create(root, { projectRoot: "/repo", errorReports: { dir: "../escape" } }) as any;
    await expect(invalid.fail()).rejects.toThrow("Error report directory resolves outside project root.");
  }
});
