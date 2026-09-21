import { describe, expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry, createCommandArguments, toByteSource, type CommandContext } from "@poe-platform/safe-bash/contracts";
import { createRemoteMcpManagementCommand, initRemoteMcpConfiguration } from "./index.js";

const servers = [{ name: "catalog", url: "https://catalog.example/mcp", auth: {
  type: "oauth" as const, clientMode: "static" as const, env: { clientId: "GOOGLE_APP_ID", clientSecret: "GOOGLE_APP_SECRET" },
  clientName: "Host Application",
  tokenEndpointAuthMethod: "client_secret_basic" as const,
  scope: "read offline_access", redirectUri: "http://localhost:39119/callback"
} }];

async function run(script: string, env: Record<string, string> = {}) {
  const fs = createMemoryFileSystem();
  const command = createRemoteMcpManagementCommand(servers);
  const shell = new Shell({ fs, env, commands: new CommandRegistry([command]) });
  try { return await shell.exec(script); }
  finally { await shell.dispose(); }
}

describe("remote MCP management init command", () => {
  it("rejects invalid or repeated discovery/resource timeouts before credential binding or network", async () => {
    const fetch = vi.fn();
    const readCredential = vi.fn(() => { throw new Error("must remain unread"); });
    const binding = { env: Object.defineProperty({}, "GOOGLE_APP_ID", { enumerable: true, get: readCredential }) };
    const definition = createRemoteMcpManagementCommand(servers, { generation: { binding, schema: { fetch } }, resources: { binding, fetch } });
    const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry([definition]) });
    try {
      for (const command of ["generate", "resource catalog"]) {
        for (const flags of ["--timeout-ms", "--timeout-ms=", "--timeout-ms=0", "--timeout-ms=-1", "--timeout-ms=1.5",
          "--timeout-ms=20oops", "--timeout-ms=2147483648", "--timeout-ms=20 --timeout-ms=30"]) {
          const result = await shell.exec(`mcp ${command} ${flags}`);
          expect(result.exitCode).toBe(2);
          expect(result.stdout).toBe("");
          expect(result.stderr).toContain("--timeout-ms");
        }
      }
      expect(readCredential).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally { await shell.dispose(); }
  });
  it("routes all management help before reading credentials or creating native sessions", async () => {
    const readCredential = vi.fn(() => { throw new Error("help must not read credentials"); });
    const env = Object.defineProperty({}, "GOOGLE_APP_ID", { enumerable: true, get: readCredential });
    const sessionStore = vi.fn(() => { throw new Error("help must not create sessions"); });
    const fetch = vi.fn();
    const binding = { env, oauth: { sessionStore } };
    const definition = createRemoteMcpManagementCommand(servers, {
      generation: { binding, schema: { fetch } }, authentication: { binding, fetch },
      credentialImport: { binding, fetch }, reset: { binding }, resources: { binding, fetch }
    });
    const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry([definition]) });
    try {
      for (const script of ["mcp", "mcp --help", ...["init", "generate", "auth", "import", "reset", "resource"].map(command => `mcp ${command} --help`)]) {
        const result = await shell.exec(script);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Usage:");
        expect(result.stderr).toBe("");
      }
      expect(readCredential).not.toHaveBeenCalled();
      expect(sessionStore).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally { await shell.dispose(); }
  });

  it("prints complete SDK initialization JSON without fetching schemas or reading actual credentials", async () => {
    const result = await run("mcp init", { GOOGLE_APP_ID: "actual-id", GOOGLE_APP_SECRET: "actual-secret", MCP_CATALOG_ACCESS_TOKEN: "actual-token" });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(initRemoteMcpConfiguration(servers));
    expect(JSON.parse(result.stdout).configuration.servers[0].auth.clientName).toBe("Host Application");
    expect(result.stderr).toBe("");
    for (const secret of ["actual-id", "actual-secret", "actual-token"]) expect(result.stdout).not.toContain(secret);
  });

  it.each(["--format env", "--format=env"])("prints the complete empty environment template with %s", async flag => {
    const result = await run(`mcp init ${flag}`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(initRemoteMcpConfiguration(servers).envTemplate);
    expect(result.stdout).toContain("GOOGLE_APP_ID=\n");
    expect(result.stdout).toContain("MCP_CATALOG_REDIRECT_URI=\n");
    expect(result.stdout).toContain("MCP_CATALOG_REFRESH_TOKEN=\n");
  });

  it("prints standalone configuration suitable for shell redirection", async () => {
    const result = await run("mcp init --format config");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(initRemoteMcpConfiguration(servers).configuration);
  });

  it.each(["mcp", "mcp --help", "mcp init --help"])("shows useful command and environment guidance for %s", async script => {
    const result = await run(script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("--format");
    expect(result.stdout).toContain("client");
    expect(result.stdout).toContain("redirect");
  });

  it.each(["mcp delete", "mcp init --format", "mcp init --format unknown", "mcp init --secret value", "mcp init --format=env --format=config"])
    ("rejects invalid arguments for %s without output", async script => {
      const result = await run(script);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toBe("");
    });

  it("supports a host-selected management command name", async () => {
    const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry([createRemoteMcpManagementCommand(servers, { name: "remote-tools" })]) });
    try {
      const result = await shell.exec("remote-tools init --format env");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("GOOGLE_APP_ID=\n");
    } finally { await shell.dispose(); }
  });

  it("preflights generated-command conflicts before preparing a management command", () => {
    expect(() => createRemoteMcpManagementCommand([{ ...servers[0], name: "mcp" }])).toThrow("conflict");
  });

  it("rejects output failures and invalid UTF-8 without mistaking sink failures for argument errors", async () => {
    const failure = new Error("output failed");
    const definition = createRemoteMcpManagementCommand(servers);
    const output = vi.fn(async () => { throw failure; });
    const errors = vi.fn(async () => {});
    const carrier = createCommandArguments(["init"]);
    const context: CommandContext = { command: "mcp", args: carrier.args, argumentValues: carrier,
      signal: new AbortController().signal, stdin: toByteSource(""), stdout: { write: output }, stderr: { write: errors },
      cwd: "/", env: {}, fs: createMemoryFileSystem() };
    await expect(definition.execute(context)).rejects.toBe(failure);
    expect(errors).not.toHaveBeenCalled();
    const invalid = carrier.withValues([Uint8Array.of(0xff)]);
    expect(await definition.execute({ ...context, args: invalid.args, argumentValues: invalid })).toEqual({ exitCode: 2 });
    expect(errors).toHaveBeenCalledOnce();
  });
});
