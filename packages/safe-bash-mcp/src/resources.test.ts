import { expect, it, vi } from "vitest";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import type { HttpTransportFetch } from "tiny-mcp-client";
import { accessRemoteMcpResources, createRemoteMcpManagementCommand } from "./index.js";

const server = { name: "docs", url: "https://docs.example/mcp", protocolVersion: "2025-03-26" as const };
const listed = { resources: [{ name: "memo", uri: "memo://one", mimeType: "text/plain" }], nextCursor: "next=a=b", _meta: { trace: "list" } };
const read = { contents: [{ uri: "file:///remote/readme", mimeType: "text/plain", text: "remote text\n" },
  { uri: "memo://blob", mimeType: "application/octet-stream", blob: "AAE=" }], _meta: { trace: "read" } };
const templates = { resourceTemplates: [{ name: "memo", uriTemplate: "memo://{id}" }], nextCursor: "template-next" };
function remote(options: { fail?: boolean; wait?: boolean; resources?: boolean } = {}) {
  const requests: { method: string; params?: unknown }[] = [];
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method !== "POST") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init?.body)); requests.push(request);
    if (request.method === "notifications/initialized" || request.method === "notifications/cancelled") return new Response(null, { status: 202 });
    if (request.method.startsWith("resources/")) {
      started();
      if (options.wait) return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
      if (options.fail) return Response.json({ jsonrpc: "2.0", id: request.id, error: { code: -32001, message: "resource unavailable", data: { uri: "memo://one" } } });
    }
    const result = request.method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: options.resources === false ? {} : { resources: {} }, serverInfo: { name: "docs", version: "1" } }
      : request.method === "resources/list" ? listed : request.method === "resources/read" ? read : request.method === "resources/templates/list" ? templates : {};
    return Response.json({ jsonrpc: "2.0", id: request.id, result }, { headers: { "Mcp-Session-Id": "docs-session" } });
  });
  return { fetch, requests, requestStarted };
}

it("lists one preserved resource page with an exact caller cursor and no tool discovery", async () => {
  const f = remote();
  expect(await accessRemoteMcpResources(server, { operation: "list", cursor: "cursor=a=b" }, { fetch: f.fetch })).toEqual(listed);
  expect(f.requests).toContainEqual(expect.objectContaining({ method: "resources/list", params: { cursor: "cursor=a=b" } }));
  expect(f.requests.some(request => request.method === "tools/list")).toBe(false);
  expect(f.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
});
it("reads complete text and binary contents with metadata through the native client", async () => {
  const f = remote();
  expect(await accessRemoteMcpResources(server, { operation: "read", uri: "file:///remote/readme" }, { fetch: f.fetch })).toEqual(read);
  expect(f.requests).toContainEqual(expect.objectContaining({ method: "resources/read", params: { uri: "file:///remote/readme" } }));
});
it("lists resource templates without synthetic tools", async () => {
  const f = remote();
  expect(await accessRemoteMcpResources(server, { operation: "templates" }, { fetch: f.fetch })).toEqual(templates);
  expect(f.requests).toContainEqual(expect.objectContaining({ method: "resources/templates/list" }));
});
it.each([
  { operation: "read", uri: "relative/readme" }, { operation: "read", uri: "" },
  { operation: "read", uri: "memo://one\n" }, { operation: "list", cursor: 5 },
  { operation: "list", uri: "memo://one" }, { operation: "read", uri: "memo://one", cursor: "next" },
  { operation: "unknown" }
])("rejects invalid resource requests before fetching: %j", async request => {
  const f = remote();
  await expect(accessRemoteMcpResources(server, request as Parameters<typeof accessRemoteMcpResources>[1], { fetch: f.fetch })).rejects.toThrow();
  expect(f.fetch).not.toHaveBeenCalled();
});
it("bounds input and validates remote URLs and timers before fetching", async () => {
  const f = remote();
  await expect(accessRemoteMcpResources(server, { operation: "read", uri: "memo://long" }, { fetch: f.fetch, maxInputBytes: 3 })).rejects.toThrow("byte limit");
  await expect(accessRemoteMcpResources({ ...server, url: "file:///local" }, { operation: "list" }, { fetch: f.fetch })).rejects.toThrow("remote");
  await expect(accessRemoteMcpResources(server, { operation: "list" }, { fetch: f.fetch, requestTimeoutMs: 2_147_483_648 })).rejects.toThrow("2147483647");
  expect(f.fetch).not.toHaveBeenCalled();
});
it("retains protocol failures and rejects unsupported resource capabilities", async () => {
  const f = remote({ fail: true });
  await expect(accessRemoteMcpResources(server, { operation: "read", uri: "memo://one" }, { fetch: f.fetch })).rejects.toMatchObject({ code: -32001, data: { uri: "memo://one" } });
  const unsupported = remote({ resources: false });
  await expect(accessRemoteMcpResources(server, { operation: "list" }, { fetch: unsupported.fetch })).rejects.toThrow("does not support resources");
  expect(unsupported.requests.some(request => request.method.startsWith("resources/"))).toBe(false);
});
it("rejects accessor-bearing resource requests without evaluating them", async () => {
  const f = remote(), readUri = vi.fn(() => "memo://one");
  const request = Object.defineProperty({ operation: "read" as const }, "uri", { enumerable: true, get: readUri });
  await expect(accessRemoteMcpResources(server, request as { operation: "read"; uri: string }, { fetch: f.fetch })).rejects.toThrow("Invalid");
  expect(readUri).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
});
it("honors a pre-aborted management resource signal before credential binding", async () => {
  const f = remote(), controller = new AbortController(); controller.abort(new Error("resource canceled before setup"));
  const readToken = vi.fn(() => { throw new Error("must remain unread"); });
  const env = Object.defineProperty({}, "TOKEN", { enumerable: true, get: readToken });
  const definition = createRemoteMcpManagementCommand([{ ...server, auth: { type: "bearer", env: "TOKEN" } }], {
    resources: { fetch: f.fetch, signal: controller.signal, binding: { env } }
  });
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry([definition]) });
  try {
    const result = await shell.exec("mcp resource docs memo://one");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("resource canceled before setup");
    expect(readToken).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  } finally { await shell.dispose(); }
});
it("preserves cancellation identity and closes the native session", async () => {
  const f = remote({ wait: true }), controller = new AbortController(), reason = new Error("resource canceled");
  const result = accessRemoteMcpResources(server, { operation: "read", uri: "memo://one" }, { fetch: f.fetch, signal: controller.signal });
  const outcome = result.catch(error => error);
  await Promise.race([f.requestStarted, outcome.then(error => { throw error; })]);
  controller.abort(reason);
  expect(await outcome).toBe(reason);
  expect(f.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
});
it("bounds an in-flight resource request with the complete operation deadline", async () => {
  const f = remote({ wait: true });
  await expect(accessRemoteMcpResources(server, { operation: "read", uri: "memo://one" }, { fetch: f.fetch, requestTimeoutMs: 20 })).rejects.toMatchObject({ name: "TimeoutError" });
  expect(f.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
});
it("returns native protocol diagnostics on stderr with a nonzero management status", async () => {
  const f = remote({ fail: true });
  const definition = createRemoteMcpManagementCommand([server], { resources: { fetch: f.fetch } });
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry([definition]) });
  try {
    const result = await shell.exec("mcp resource docs memo://one");
    expect(result.exitCode).toBe(1); expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: -32001, data: { uri: "memo://one" } } });
  } finally { await shell.dispose(); }
});
it("routes resource list/read/templates through management SDK parity and virtual redirection", async () => {
  const f = remote(), fs = createMemoryFileSystem();
  const definition = createRemoteMcpManagementCommand([server], { resources: { fetch: f.fetch } });
  const shell = new Shell({ fs, commands: new CommandRegistry([definition]) });
  try {
    for (const [script, expected] of [["mcp resource docs --cursor 'cursor=a=b'", listed],
      ["mcp resource docs file:///remote/readme >/resource.json", read], ["mcp resource docs --templates", templates]] as const) {
      const result = await shell.exec(script);
      expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
      expect(JSON.parse(script.includes(">") ? new TextDecoder().decode(await fs.readFile("/resource.json")) : result.stdout)).toEqual(expected);
    }
    expect(f.requests.some(request => request.method === "tools/list")).toBe(false);
    f.fetch.mockClear();
    for (const script of ["mcp resource --help", "mcp resource missing", "mcp resource docs --templates memo://one", "mcp resource docs memo://one --cursor next"]) {
      const result = await shell.exec(script);
      expect(result.exitCode).toBe(script.endsWith("--help") ? 0 : 2);
    }
    expect(f.fetch).not.toHaveBeenCalled();
  } finally { await shell.dispose(); }
});
