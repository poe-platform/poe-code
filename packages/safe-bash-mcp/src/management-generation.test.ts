import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import { createRemoteMcpManagementCommand, parseRemoteMcpArtifact, type RemoteMcpManagementOptions, type InitRemoteMcpServer } from "./index.js";
import type { HttpTransportFetch } from "tiny-mcp-client";

const server = { name: "catalog", url: "https://catalog.example/mcp", protocolVersion: "2025-03-26" as const,
  tools: [{ name: "search_items", inputSchema: { type: "object" } }], auth: { type: "bearer" as const, env: "TOKEN" } };
async function run(script: string, options: RemoteMcpManagementOptions = {}, provided: InitRemoteMcpServer = server) {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, env: { TOKEN: "private-runtime-token" }, commands: new CommandRegistry([createRemoteMcpManagementCommand([provided], options)]) });
  try { return await shell.exec(script); } finally { await shell.dispose(); }
}

it("prints reproducible SDK artifacts from mcp generate without touching provided credentials", async () => {
  const fetch = vi.fn<HttpTransportFetch>();
  const first = await run("mcp generate", { generation: { schema: { fetch } } });
  const second = await run("mcp generate --format=json", { generation: { schema: { fetch } } });
  expect(first.exitCode).toBe(0); expect(first.stderr).toBe("");
  expect(first.stdout).toBe(second.stdout);
  expect(parseRemoteMcpArtifact(first.stdout).configuration.servers[0].tools).toEqual(server.tools);
  expect(first.stdout).not.toContain("private-runtime-token");
  expect(fetch).not.toHaveBeenCalled();
});

it("prints an importable module through virtual shell redirection", async () => {
  const fs = createMemoryFileSystem(), shell = new Shell({ fs, commands: new CommandRegistry([createRemoteMcpManagementCommand([server])]) });
  try {
    const result = await shell.exec("mcp generate --format module > /catalog.mjs");
    expect(result.exitCode).toBe(0); expect(result.stdout).toBe("");
    const source = await fs.readFile("/catalog.mjs", "utf8");
    const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    expect(parseRemoteMcpArtifact(module.default).schemas[0].source).toBe("provided");
  } finally { await shell.dispose(); }
});

it("prints resolved configuration with --format config", async () => {
  const result = await run("mcp generate --format config");
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ version: 1, servers: [{ name: server.name, tools: server.tools }] });
});

it.each(["mcp generate --format", "mcp generate --format env", "mcp generate --format=json --format=module"])("rejects invalid generation arguments before discovery: %s", async script => {
  const fetch = vi.fn<HttpTransportFetch>();
  const result = await run(script, { generation: { schema: { fetch } } });
  expect(result.exitCode).toBe(2); expect(result.stdout).toBe("");
  expect(fetch).not.toHaveBeenCalled();
});

it("reports discovery failures with failure status and keeps artifact stdout empty", async () => {
  const fetch = vi.fn<HttpTransportFetch>(async () => { throw new Error("endpoint unavailable"); });
  const { tools: ignoredTools, ...absent } = server;
  const result = await run("mcp generate", { generation: { schema: { fetch } } }, absent);
  expect(result.exitCode).toBe(1); expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr).error.message).toContain("endpoint unavailable");
});

it("shows generation output formats in management help", async () => {
  const result = await run("mcp generate --help");
  expect(result.exitCode).toBe(0); expect(result.stdout).toContain("generate");
  expect(result.stdout).toContain("module"); expect(result.stdout).toContain("absent");
});
