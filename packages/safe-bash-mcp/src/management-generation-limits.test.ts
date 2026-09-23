import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import type { HttpTransportFetch } from "tiny-mcp-client";
import { createRemoteMcpManagementCommand, type RemoteMcpManagementOptions } from "./index.js";

const tools = ["one", "two"].map(name => ({ name, inputSchema: { type: "object" } }));
const server = { name: "catalog", url: "https://catalog.example/mcp", protocolVersion: "2025-03-26" as const };
function fixture() {
  const cursors: unknown[] = [];
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method !== "POST") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init.body));
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = request.method === "initialize"
      ? { protocolVersion: server.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "catalog", version: "1" } }
      : (cursors.push(request.params?.cursor), request.params?.cursor === "next" ? { tools: [tools[1]] } : { tools: [tools[0]], nextCursor: "next" });
    return Response.json({ jsonrpc: "2.0", id: request.id, result }, { headers: { "Mcp-Session-Id": "limits-session" } });
  });
  return { cursors, fetch };
}
async function run(script: string, options: RemoteMcpManagementOptions = {}, supplied = false) {
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry([
    createRemoteMcpManagementCommand([{ ...server, ...(supplied ? { tools } : {}) }], options)
  ]) });
  try { return await shell.exec(script); } finally { await shell.dispose(); }
}

it.each([
  [{ maxPages: 1 }, "page limit", [undefined]],
  [{ maxTools: 1 }, "tool limit", [undefined, "next"]],
  [{ maxResponseBytes: 1 }, "byte", []]
])("keeps host discovery ceilings %j when CLI requests more", async (policy, message, cursors) => {
  const f = fixture();
  const result = await run("mcp generate --max-pages=2 --max-tools=2 --max-response-bytes=4096",
    { generation: { schema: { fetch: f.fetch, ...policy } } });
  expect(result.exitCode).toBe(1); expect(result.stdout).toBe("");
  expect(result.stderr.toLowerCase()).toContain(message); expect(f.cursors).toEqual(cursors);
});

it.each([
  ["--max-pages=1", "page limit", [undefined]],
  ["--max-tools 1", "tool limit", [undefined, "next"]],
  ["--max-response-bytes=1", "byte", []]
])("enforces stricter discovery policy %s and retires its session", async (flag, message, cursors) => {
  const f = fixture();
  const result = await run(`mcp generate ${flag}`, { generation: { schema: { fetch: f.fetch } } });
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.toLowerCase()).toContain(message);
  expect(f.cursors).toEqual(cursors);
  if (cursors.length > 0) expect(f.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
});

it.each(["--max-configuration-bytes", "--max-artifact-bytes"])("exposes offline size policy %s", async flag => {
  const fetch = vi.fn<HttpTransportFetch>();
  const rejected = await run(`mcp generate ${flag}=1`, { generation: { schema: { fetch } } }, true);
  expect(rejected.exitCode).toBe(1); expect(rejected.stdout).toBe(""); expect(rejected.stderr).toContain("byte limit");
  const hostRejected = await run(`mcp generate ${flag} 10000`, { generation: { [flag === "--max-artifact-bytes" ? "maxArtifactBytes" : "maxConfigurationBytes"]: 1, schema: { fetch } } }, true);
  expect(hostRejected.exitCode).toBe(1); expect(hostRejected.stdout).toBe(""); expect(hostRejected.stderr).toContain("byte limit");
  expect(fetch).not.toHaveBeenCalled();
});

it("enforces the tool limit on authoritative supplied schemas without discovery", async () => {
  const fetch = vi.fn<HttpTransportFetch>();
  const result = await run("mcp generate --max-tools=1", { generation: { schema: { fetch } } }, true);
  expect(result.exitCode).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).toContain("tool limit");
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects malformed/repeated generation limits before credential binding or network", async () => {
  const fetch = vi.fn<HttpTransportFetch>();
  const read = vi.fn(() => { throw new Error("credentials must remain unread"); });
  const binding = { env: Object.defineProperty({}, "TOKEN", { enumerable: true, get: read }) };
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry([
    createRemoteMcpManagementCommand([{ ...server, auth: { type: "bearer", env: "TOKEN" } }], { generation: { binding, schema: { fetch } } })
  ]) });
  try {
    for (const flag of ["--max-pages", "--max-tools", "--max-response-bytes", "--max-configuration-bytes", "--max-artifact-bytes"]) {
      for (const value of ["", "=", "=0", "=-1", "=1.5", "=1e3", "=9007199254740992", "=20oops", "=2 " + flag + " 3"]) {
        const result = await shell.exec(`mcp generate ${flag}${value}`);
        expect(result.exitCode).toBe(2); expect(result.stdout).toBe(""); expect(result.stderr).toContain(flag);
      }
    }
    expect(fetch).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  } finally { await shell.dispose(); }
});
