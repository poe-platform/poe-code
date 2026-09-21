import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import type { HttpTransportFetch, Tool } from "tiny-mcp-client";
import { remoteMcpCommands, type RemoteMcpCommandOptions } from "./index.js";

const tool: Tool = { name: "echo", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } };

async function fixture(options: RemoteMcpCommandOptions = {}, selected = tool, large = false) {
  const methods: string[] = [], inputs: unknown[] = [];
  const called = Promise.withResolvers<void>();
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    if (init?.method === "DELETE") { methods.push("DELETE"); return new Response(null, { status: 204 }); }
    if (init?.method !== "POST") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init.body)); methods.push(request.method);
    if (request.method.startsWith("notifications/")) return new Response(null, { status: 202 });
    if (request.method === "tools/call") {
      inputs.push(request.params.arguments); called.resolve();
      if (request.params.arguments.query === "stall") return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }
    return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "initialize" ? {
      protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "qa", version: "1" }
    } : { content: [{ type: "text", text: large ? "x".repeat(1024) : "ok" }], structuredContent: request.params.arguments } },
    { headers: { "Mcp-Session-Id": "owned" } });
  });
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(await remoteMcpCommands([
    { name: "catalog", url: "https://mcp.invalid/limits", protocolVersion: "2025-03-26", tools: [selected] }
  ], { ...options, fetch }));
  return { shell, fs, fetch, methods, inputs, called: called.promise };
}

it.each(["separated", "inline"])("accepts %s execution policies before the tool", async syntax => {
  const host = await fixture({ maxResponseBytes: 1 });
  try {
    const flags = syntax === "inline" ? "--timeout-ms=100 --max-response-bytes=4096 --max-input-bytes=1024 --max-output-bytes=4096"
      : "--timeout-ms 100 --max-response-bytes 4096 --max-input-bytes 1024 --max-output-bytes 4096";
    const result = await host.shell.exec(`catalog ${flags} echo --query 005930`);
    expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).structuredContent).toEqual({ query: "005930" });
    expect(host.methods).toEqual(["initialize", "notifications/initialized", "tools/call", "DELETE"]);
  } finally { await host.shell.dispose(); }
});

it("keeps execution-looking fields owned by the tool schema after its name", async () => {
  const selected: Tool = { name: "policy", inputSchema: { type: "object", properties: {
    timeoutMs: { type: "integer" }, maxResponseBytes: { type: "integer" }, maxInputBytes: { type: "integer" }, maxOutputBytes: { type: "integer" }
  }, additionalProperties: false } };
  const host = await fixture({}, selected);
  try {
    const result = await host.shell.exec("catalog --timeout-ms 100 --max-response-bytes 4096 policy --timeout-ms 7 --max-response-bytes 8 --max-input-bytes 9 --max-output-bytes 10");
    expect(result.exitCode).toBe(0);
    expect(host.inputs).toEqual([{ timeoutMs: 7, maxResponseBytes: 8, maxInputBytes: 9, maxOutputBytes: 10 }]);
  } finally { await host.shell.dispose(); }
});

it("selects a literal policy-looking tool using -- after execution flags", async () => {
  const host = await fixture({}, { ...tool, name: "--timeout-ms" });
  try {
    const result = await host.shell.exec("catalog --timeout-ms=100 -- --timeout-ms --query literal");
    expect(result.exitCode).toBe(0); expect(host.inputs).toEqual([{ query: "literal" }]);
  } finally { await host.shell.dispose(); }
});

it.each(["arguments", "stdin"])("enforces a smaller CLI input budget for %s before connecting", async mode => {
  const host = await fixture();
  try {
    const json = JSON.stringify({ query: "世界".repeat(30) });
    await host.fs.writeFile("/input.json", new TextEncoder().encode(json));
    const result = await host.shell.exec(mode === "stdin" ? "catalog --max-input-bytes=100 echo --raw - </input.json"
      : `catalog --max-input-bytes=100 echo --raw '${json}'`);
    expect(result.exitCode).toBe(2); expect(result.stdout).toBe("");
    expect(result.stderr).toContain(mode === "stdin" ? "exceeds maxBytes" : "argument byte limit");
    expect(host.fetch).not.toHaveBeenCalled();
  } finally { await host.shell.dispose(); }
});

it("keeps the host input ceiling when a CLI policy requests more", async () => {
  const host = await fixture({ maxInputBytes: 100 });
  try {
    await host.fs.writeFile("/input.json", new TextEncoder().encode(JSON.stringify({ query: "x".repeat(200) })));
    const result = await host.shell.exec("catalog --max-input-bytes=4096 echo --raw - </input.json");
    expect(result.exitCode).toBe(2); expect(result.stderr).toContain("exceeds maxBytes");
    expect(host.fetch).not.toHaveBeenCalled();
  } finally { await host.shell.dispose(); }
});

it.each(["CLI", "host"])("enforces the %s output ceiling without writing partial JSON", async owner => {
  const host = await fixture(owner === "host" ? { maxOutputBytes: 128 } : {}, tool, true);
  try {
    const result = await host.shell.exec(`catalog --max-output-bytes=${owner === "host" ? 4096 : 128} echo --query large`);
    expect(result.exitCode).not.toBe(0); expect(result.stdout).toBe("");
    expect(result.stderr).toContain("output byte limit"); expect(host.inputs).toEqual([{ query: "large" }]);
    expect(host.methods.at(-1)).toBe("DELETE");
  } finally { await host.shell.dispose(); }
});

it("applies a CLI response budget and retires initialization sessions on failure", async () => {
  const host = await fixture();
  try {
    const result = await host.shell.exec("catalog --max-response-bytes=8 echo --query bounded");
    expect(result.exitCode).toBe(1); expect(result.stdout).toBe("");
    expect(result.stderr).toContain("8 bytes"); expect(host.inputs).toEqual([]);
    expect(host.methods.at(-1)).toBe("DELETE");
  } finally { await host.shell.dispose(); }
});

it("overrides the RPC deadline and cancels a stalled call", async () => {
  const host = await fixture({ requestTimeoutMs: 30_000 });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const pending = host.shell.exec("catalog --timeout-ms=100 echo --query stall");
    await Promise.race([host.called, pending.then(() => { throw new Error("Command ended before tools/call"); })]);
    await vi.advanceTimersByTimeAsync(101);
    const result = await pending;
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain("timed out");
    expect(host.fetch.mock.calls.some(([, init]) => String(init?.body).includes('"tools/call"') && init?.signal?.aborted)).toBe(true);
    expect(host.methods.at(-1)).toBe("DELETE");
  } finally { await host.shell.dispose(); vi.useRealTimers(); }
});

it.each(["--timeout-ms=0", "--timeout-ms=2147483648", "--timeout-ms=1.5", "--timeout-ms", "--timeout-ms=1 --timeout-ms=2",
  "--max-response-bytes=0", "--max-response-bytes=-1", "--max-response-bytes=1 --max-response-bytes=2",
  "--max-input-bytes=0", "--max-input-bytes=9007199254740992", "--max-input-bytes=1 --max-input-bytes=2",
  "--max-output-bytes=0", "--max-output-bytes=1e3", "--max-output-bytes=1 --max-output-bytes=2"
])("rejects malformed/repeated policy %s before connecting", async flags => {
  const host = await fixture();
  try {
    const result = await host.shell.exec(`catalog ${flags} echo --query unchanged`);
    expect(result.exitCode).toBe(2); expect(result.stdout).toBe(""); expect(host.fetch).not.toHaveBeenCalled();
    expect(result.stderr).toMatch(/positive integer|only be supplied once/);
  } finally { await host.shell.dispose(); }
});

it("documents prefix policies in offline server and tool help", async () => {
  const host = await fixture();
  try {
    for (const command of ["catalog --help", "catalog --timeout-ms=100 echo --help"]) {
      const result = await host.shell.exec(command);
      expect(result.exitCode).toBe(0);
      for (const flag of ["--timeout-ms", "--max-response-bytes", "--max-input-bytes", "--max-output-bytes"])
        expect(result.stdout).toContain(flag);
    }
    expect(host.fetch).not.toHaveBeenCalled();
  } finally { await host.shell.dispose(); }
});
