import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { dump, dumpCurrent } from "../dump.js";
import { Budget } from "../interp/budget.js";
import { run } from "../run.js";
import { makeMcpModule } from "./mcp.js";
import { parseMcpConfig } from "./mcp-transport.js";

function createHttpServer() {
  const requests: Array<{ method: string; params?: unknown }> = [];
  const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") {
      requests.push({ method: "close" });
      return new Response(null, { status: 204 });
    }
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    if (request.id === undefined) return new Response(null, { status: 202 });
    const result =
      request.method === "initialize"
        ? {
            protocolVersion: request.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "memory", version: "1" }
          }
        : request.method === "tools/list"
          ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
          : { content: [{ type: "text", text: JSON.stringify(request.params.arguments) }] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
      headers: { "content-type": "application/json", "mcp-session-id": "test-session" }
    });
  });
  return { fetch, requests };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("managed MCP capabilities", () => {
  it("retains JSON-RPC error codes and data through checked calls and replay", async () => {
    const server = createHttpServer();
    const originalFetch = server.fetch.getMockImplementation()!;
    server.fetch.mockImplementation(async (input, init) => {
      if (String(init?.body).includes('"tools/call"')) {
        const request = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32602, message: "Bad query", data: { field: "query" } }
          }),
          { headers: { "content-type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    });
    const options = { servers: { docs: { url: "https://example.test/mcp" } }, fetch: server.fetch };
    const source =
      'import {servers} from "mcp"; try { await servers.docs.tool("echo",{}); } catch(error) { return [error.name,error.code,error.data,error instanceof Error]; }';
    const first = await run(source, { modules: { mcp: makeMcpModule(options) } });
    expect(first.returnValue).toEqual(["McpError", -32602, { field: "query" }, true]);
    const count = server.fetch.mock.calls.length;
    const resumed = await run(source, {
      modules: { mcp: makeMcpModule(options) },
      snapshot: JSON.parse(await dump(first))
    });
    expect(resumed.returnValue).toEqual(first.returnValue);
    expect(server.fetch).toHaveBeenCalledTimes(count);
  });

  it("resolves config paths and keeps an explicit child environment", () => {
    expect(
      parseMcpConfig(
        JSON.stringify({
          servers: { local: { command: "./server", cwd: "../work", env: { TOKEN: "provided" } } }
        }),
        "/repo/config"
      )
    ).toMatchObject({
      servers: {
        local: { command: "/repo/config/server", cwd: "/repo/work", env: { TOKEN: "provided" } }
      }
    });
    expect(() => parseMcpConfig('{"servers":{},"fetch":"unsafe"}', "/repo")).toThrow();
  });

  it("runs stdio without ambient environment and escalates a child ignoring SIGTERM", async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null as NodeJS.Signals | null,
      killed: false,
      kill: vi.fn((signal: NodeJS.Signals) => {
        if (signal === "SIGKILL") {
          child.signalCode = signal;
          child.emit("exit", null, signal);
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
        }
        return true;
      })
    });
    child.stdin.on("data", (data) => {
      for (const line of String(data).trim().split("\n")) {
        const request = JSON.parse(line);
        if (request.id === undefined) continue;
        const result =
          request.method === "initialize"
            ? {
                protocolVersion: request.params.protocolVersion,
                capabilities: { tools: {} },
                serverInfo: { name: "memory", version: "1" }
              }
            : { tools: [] };
        child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
      }
    });
    const spawn = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams);
    const mcp = makeMcpModule({
      servers: { local: { command: "/server", args: ["safe"] } },
      spawn,
      closeTimeoutMs: 20
    });
    await expect(mcp.servers.local.tools()).resolves.toEqual([]);
    expect(spawn).toHaveBeenCalledWith(
      "/server",
      ["safe"],
      expect.objectContaining({ env: {}, stdio: ["pipe", "pipe", "pipe"] })
    );
    const closing = mcp.servers.local.close();
    await vi.advanceTimersByTimeAsync(20);
    await closing;
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts an active request and awaits transport shutdown", async () => {
    const server = createHttpServer();
    const originalFetch = server.fetch.getMockImplementation()!;
    const controller = new AbortController();
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let aborted = false;
    server.fetch.mockImplementation(async (input, init) => {
      if (String(init?.body).includes('"tools/call"')) {
        started();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(init.signal?.reason);
            },
            { once: true }
          );
        });
      }
      return originalFetch(input, init);
    });
    const mcp = makeMcpModule({
      servers: { docs: { url: "https://example.test/mcp" } },
      fetch: server.fetch
    });
    const running = run('import {servers} from "mcp"; await servers.docs.tool("echo",{});', {
      modules: { mcp },
      signal: controller.signal
    });
    const rejection = expect(running).rejects.toThrow();
    await startedPromise;
    controller.abort(new Error("cancel MCP"));
    await rejection;
    expect(aborted).toBe(true);
    expect(server.requests.at(-1)?.method).toBe("close");
  });

  it("bounds HTTP session termination even when DELETE never responds", async () => {
    vi.useFakeTimers();
    const server = createHttpServer();
    const originalFetch = server.fetch.getMockImplementation()!;
    let aborted = false;
    server.fetch.mockImplementation(async (input, init) => {
      if (init?.method === "DELETE")
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(init.signal?.reason);
            },
            { once: true }
          );
        });
      return originalFetch(input, init);
    });
    const mcp = makeMcpModule({
      servers: { docs: { url: "https://example.test/mcp" } },
      fetch: server.fetch,
      closeTimeoutMs: 20
    });
    await mcp.servers.docs.tools();
    const closing = mcp.servers.docs.close();
    await vi.advanceTimersByTimeAsync(20);
    await closing;
    expect(aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps transport configuration on the host and connects lazily", async () => {
    const server = createHttpServer();
    const mcp = makeMcpModule({
      servers: { docs: { url: "https://example.test/mcp", headers: { Authorization: "secret" } } },
      fetch: server.fetch
    });
    expect(mcp.server("docs")).toEqual({ name: "docs" });
    const client = await mcp.client(mcp.server("docs"));
    expect(client).toBe(mcp.servers.docs);
    expect(server.fetch).not.toHaveBeenCalled();
    await expect(client.tools()).resolves.toEqual([{ name: "echo", schema: { type: "object" } }]);
    await expect(client.tool("echo", { value: 7 })).resolves.toEqual({
      content: [{ type: "text", text: '{"value":7}' }]
    });
    await client.close();
    expect(server.requests.filter((request) => request.method === "initialize")).toHaveLength(1);
    expect(server.requests.at(-1)?.method).toBe("close");
    expect(server.fetch.mock.calls.every(([, options]) => options?.redirect === "error")).toBe(
      true
    );
  });

  it.each(["missing", "__proto__", "constructor"])(
    "denies unconfigured server %s",
    async (name) => {
      const server = createHttpServer();
      const mcp = makeMcpModule({ servers: {}, fetch: server.fetch });
      expect(() => mcp.server(name)).toThrow("not configured");
      await expect(mcp.client({ name })).rejects.toThrow("not configured");
      expect(server.fetch).not.toHaveBeenCalled();
    }
  );

  it("rejects forged handles and unknown transport options before effects", async () => {
    const server = createHttpServer();
    const mcp = makeMcpModule({
      servers: { docs: { url: "https://example.test/mcp" } },
      fetch: server.fetch
    });
    await expect(mcp.client({ name: "docs", command: "arbitrary" } as never)).rejects.toThrow();
    expect(() => makeMcpModule({ servers: { docs: { url: "file:///secret" } } })).toThrow();
    expect(() =>
      makeMcpModule({
        servers: { docs: { command: "server", url: "https://example.test" } }
      } as never)
    ).toThrow();
    expect(() =>
      makeMcpModule({ servers: { docs: { command: "server", ignored: true } } } as never)
    ).toThrow();
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it("closes connections after a run and replays without reopening or repeating tools", async () => {
    const server = createHttpServer();
    const mcp = makeMcpModule({
      servers: { docs: { url: "https://example.test/mcp" } },
      fetch: server.fetch
    });
    const source =
      'import {server,client} from "mcp"; const docs=await client(server("docs")); return await docs.tool("echo",{value:9});';
    const first = await run(source, { modules: { mcp } });
    expect(first).toMatchObject({ ok: true, returnValue: { content: [{ text: '{"value":9}' }] } });
    expect(server.requests.at(-1)?.method).toBe("close");
    const calls = server.requests.length;
    const second = await run(source, { modules: { mcp }, snapshot: JSON.parse(await dump(first)) });
    expect(second.returnValue).toEqual(first.returnValue);
    expect(server.requests).toHaveLength(calls);
  });

  it.each(["throw new Error('failed');", "while(true){}"])(
    "cleans up on failure: %s",
    async (tail) => {
      const server = createHttpServer();
      const mcp = makeMcpModule({
        servers: { docs: { url: "https://example.test/mcp" } },
        fetch: server.fetch
      });
      await expect(
        run(`import {servers} from "mcp"; await servers.docs.tools(); ${tail}`, {
          modules: { mcp },
          budget: new Budget({ maxSteps: 1000 })
        })
      ).rejects.toThrow();
      expect(server.requests.at(-1)?.method).toBe("close");
    }
  );

  it("isolates concurrent runs sharing a module", async () => {
    const server = createHttpServer();
    const mcp = makeMcpModule({
      servers: { docs: { url: "https://example.test/mcp" } },
      fetch: server.fetch
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        run(
          `import {servers} from "mcp"; return await servers.docs.tool("echo",{index:${index}});`,
          { modules: { mcp } }
        )
      )
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(server.requests.filter((request) => request.method === "initialize")).toHaveLength(8);
    expect(server.requests.filter((request) => request.method === "close")).toHaveLength(8);
  });

  it("deduplicates parallel connection attempts within a run", async () => {
    const server = createHttpServer();
    const mcp = makeMcpModule({
      servers: { docs: { url: "https://example.test/mcp" } },
      fetch: server.fetch
    });
    const result = await run(
      'import {servers} from "mcp"; return await Promise.all([servers.docs.tools(),servers.docs.tools()]);',
      { modules: { mcp } }
    );
    expect(result.ok).toBe(true);
    expect(server.requests.filter((request) => request.method === "initialize")).toHaveLength(1);
    expect(server.requests.filter((request) => request.method === "close")).toHaveLength(1);
  });

  it("does not connect when cancellation precedes execution", async () => {
    const server = createHttpServer();
    const mcp = makeMcpModule({
      servers: { docs: { url: "https://example.test/mcp" } },
      fetch: server.fetch
    });
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(
      run('import {servers} from "mcp"; await servers.docs.tools();', {
        modules: { mcp },
        signal: controller.signal
      })
    ).rejects.toThrow();
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it("preserves SDK cancellation reasons instead of returning batch failures", async () => {
    const controller = new AbortController();
    const reason = new Error("SDK cancelled");
    const server = createHttpServer();
    const originalFetch = server.fetch.getMockImplementation()!;
    server.fetch.mockImplementation(async (input, init) => {
      if (String(init?.body).includes('"tools/call"')) {
        controller.abort(reason);
        throw reason;
      }
      return originalFetch(input, init);
    });
    const mcp = makeMcpModule({
      servers: { docs: { url: "https://example.test/mcp" } },
      fetch: server.fetch,
      signal: controller.signal
    });
    await expect(mcp.servers.docs.toolBatch([{ name: "echo", args: {} }])).rejects.toBe(reason);
    await mcp.servers.docs.close();
  });

  it("bounds unique pagination cursors", async () => {
    const server = createHttpServer();
    const originalFetch = server.fetch.getMockImplementation()!;
    let pages = 0;
    server.fetch.mockImplementation(async (input, init) => {
      if (String(init?.body).includes('"tools/list"')) {
        const request = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: { tools: [], nextCursor: String(++pages) }
          }),
          { headers: { "content-type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    });
    const mcp = makeMcpModule({
      servers: { docs: { url: "https://example.test/mcp" } },
      fetch: server.fetch,
      maxToolPages: 3
    });
    await expect(mcp.servers.docs.tools()).rejects.toThrow("page limit");
    await mcp.servers.docs.close();
    expect(pages).toBe(3);
  });

  it("aborts a stalled HTTP response body on run cancellation", async () => {
    const server = createHttpServer();
    const originalFetch = server.fetch.getMockImplementation()!;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let bodyCancelled = false;
    server.fetch.mockImplementation(async (input, init) => {
      if (String(init?.body).includes('"tools/call"')) {
        started();
        return new Response(
          new ReadableStream({
            cancel() {
              bodyCancelled = true;
            }
          }),
          { headers: { "content-type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    });
    const controller = new AbortController();
    const mcp = makeMcpModule({
      servers: { docs: { url: "https://example.test/mcp" } },
      fetch: server.fetch
    });
    const running = run('import {servers} from "mcp"; await servers.docs.tool("echo",{});', {
      modules: { mcp },
      signal: controller.signal
    });
    const rejection = expect(running).rejects.toThrow();
    await startedPromise;
    await Promise.resolve();
    controller.abort(new Error("stop body"));
    await rejection;
    expect(bodyCancelled).toBe(true);
  });

  it("requires reconciliation for an interrupted effectful tool call", async () => {
    const server = createHttpServer();
    const originalFetch = server.fetch.getMockImplementation()!;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    server.fetch.mockImplementation(async (input, init) => {
      if (String(init?.body).includes('"tools/call"')) {
        started();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true
          });
        });
      }
      return originalFetch(input, init);
    });
    const controller = new AbortController();
    const options = { servers: { docs: { url: "https://example.test/mcp" } }, fetch: server.fetch };
    const source =
      'import {client,server} from "mcp"; const docs=await client(server("docs")); return await docs.tool("echo",{});';
    const running = run(source, {
      modules: { mcp: makeMcpModule(options) },
      signal: controller.signal
    });
    const rejection = expect(running).rejects.toThrow();
    await startedPromise;
    const snapshot = JSON.parse(await dumpCurrent(running));
    controller.abort(new Error("interrupted"));
    await rejection;
    const requests = server.fetch.mock.calls.length;
    await expect(
      run(source, { modules: { mcp: makeMcpModule(options) }, snapshot })
    ).rejects.toMatchObject({
      name: "HostCallResumabilityError",
      action: "external-reconciliation"
    });
    expect(server.fetch).toHaveBeenCalledTimes(requests);
  });
});
