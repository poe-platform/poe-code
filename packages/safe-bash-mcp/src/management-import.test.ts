import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry, createCommandArguments, type CommandContext } from "@poe-platform/safe-bash/contracts";
import { createRemoteMcpManagementCommand, type RemoteMcpCredentialImportOptions } from "./index.js";
import type { StoredOAuthSession } from "mcp-oauth";
const resource = "https://resource.example/mcp", issuer = "https://auth.example";
const payload = { tokens: { access_token: "private-access", refresh_token: "private-refresh", token_type: "Bearer", expires_in: 3600 },
  clientInfo: { client_id: "original", client_secret: "private-secret", provider_metadata: { tenant: "one" } } };
function fixture(name = "catalog", maxInputBytes?: number, policy: Pick<RemoteMcpCredentialImportOptions, "maxImportBytes" | "timeoutMs"> = {}) {
  const fs = createMemoryFileSystem();
  const fetch = vi.fn(async (url: string | URL) => Response.json(String(url).includes("oauth-protected-resource")
    ? { resource, authorization_servers: [issuer] }
    : { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] }));
  const importSession = vi.fn(async (_server: unknown, _session: StoredOAuthSession, _options: unknown) => {});
  const shell = new Shell({ fs, commands: new CommandRegistry([createRemoteMcpManagementCommand([
    { name, url: resource, tools: [], auth: { type: "oauth", clientMode: "dynamic" } }
  ], { maxInputBytes, credentialImport: { ...policy, fetch, binding: { env: {}, oauth: { now: () => 10_000, importSession } } } })]) });
  return { fs, fetch, importSession, shell };
}
it("imports bounded redirected virtual stdin with a public JSON summary", async () => {
  const f = fixture(); await f.fs.writeFile("/credentials.json", new TextEncoder().encode(JSON.stringify(payload)));
  try {
    const result = await f.shell.exec("mcp import catalog --json < /credentials.json");
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout)).toEqual({ name: "catalog", url: resource, imported: true });
    expect(result.stderr).toBe(""); expect(result.stdout).not.toContain("private-");
    expect(f.importSession).toHaveBeenCalledWith(expect.objectContaining({ name: "catalog" }), expect.objectContaining({ client: expect.objectContaining({ clientId: "original", registrationOwnership: "caller" }), tokens: expect.objectContaining({ expiresAt: 3_610_000 }) }), expect.any(Object));
    expect(f.fetch).toHaveBeenCalledTimes(2);
  } finally { await f.shell.dispose(); }
});
it("imports a named virtual file and returns a concise text summary", async () => {
  const f = fixture(); await f.fs.writeFile("/credentials.json", new TextEncoder().encode(JSON.stringify(payload)));
  try {
    const result = await f.shell.exec("mcp import catalog --file /credentials.json");
    expect(result.exitCode).toBe(0); expect(result.stdout).toBe("Imported OAuth credentials for catalog.\n");
    expect(result.stderr).toBe(""); expect(f.importSession).toHaveBeenCalledOnce();
  } finally { await f.shell.dispose(); }
});
it("supports literal dash names and a complete-operation timeout override", async () => {
  const f = fixture("-catalog"); await f.fs.writeFile("/credentials.json", new TextEncoder().encode(JSON.stringify(payload)));
  try {
    const result = await f.shell.exec("mcp import --json --timeout-ms=1000 --file /credentials.json -- -catalog");
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout).name).toBe("-catalog");
    expect(f.importSession).toHaveBeenCalledOnce();
  } finally { await f.shell.dispose(); }
});
it("shows focused import help before reading any credential input", async () => {
  const f = fixture();
  try {
    const result = await f.shell.exec("mcp import --help");
    expect(result.exitCode).toBe(0); expect(result.stdout).toMatch(/^Usage: mcp import /u);
    expect(result.stdout).toContain("--file"); expect(result.stdout).toContain("original"); expect(result.stdout).toContain("stdin");
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.importSession).not.toHaveBeenCalled();
  } finally { await f.shell.dispose(); }
});
it.each(["mcp import", "mcp import missing", "mcp import catalog --file", "mcp import catalog --file a --file b", "mcp import catalog --json --json", "mcp import catalog --browser host", "mcp import catalog --timeout-ms 0"])("rejects invalid import arguments before credential reads: %s", async command => {
  const f = fixture();
  try {
    const result = await f.shell.exec(command);
    expect(result.exitCode).toBe(2); expect(result.stdout).toBe(""); expect(f.fetch).not.toHaveBeenCalled(); expect(f.importSession).not.toHaveBeenCalled();
  } finally { await f.shell.dispose(); }
});
it.each(["invalid JSON", "invalid UTF-8", "oversized"])("rejects %s credential input without echoing it", async mode => {
  const f = fixture("catalog", mode === "oversized" ? 100 : undefined);
  const bytes = mode === "invalid UTF-8" ? new Uint8Array([0xff]) : new TextEncoder().encode(mode === "invalid JSON" ? '{"private-marker":' : JSON.stringify(payload));
  await f.fs.writeFile("/credentials.json", bytes);
  try {
    const result = await f.shell.exec("mcp import catalog --file /credentials.json --json");
    expect(result.exitCode).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).not.toContain("private-");
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.importSession).not.toHaveBeenCalled();
  } finally { await f.shell.dispose(); }
});
it("bounds redirected stdin just like a virtual file", async () => {
  const f = fixture("catalog", 100); await f.fs.writeFile("/credentials.json", new TextEncoder().encode(JSON.stringify(payload)));
  try {
    const result = await f.shell.exec("mcp import catalog < /credentials.json");
    expect(result.exitCode).toBe(1); expect(result.stdout).toBe(""); expect(f.fetch).not.toHaveBeenCalled();
  } finally { await f.shell.dispose(); }
});
it("reports a missing virtual file without contacting the OAuth server", async () => {
  const f = fixture();
  try {
    const result = await f.shell.exec("mcp import catalog --file /missing.json");
    expect(result.exitCode).toBe(1); expect(result.stdout).toBe(""); expect(f.fetch).not.toHaveBeenCalled();
  } finally { await f.shell.dispose(); }
});
it("bounds stalled credential input with the command deadline and cleans up its stream", async () => {
  const f = fixture(), controller = new AbortController(), entered = Promise.withResolvers<void>(), cancel = vi.fn();
  const deadline = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const read = Promise.withResolvers<IteratorResult<Uint8Array>>();
  const stream = { [Symbol.asyncIterator]() { return {
    next: () => read.promise,
    return: async () => { cancel(); read.resolve({ done: true, value: undefined }); return { done: true as const, value: undefined }; }
  }; } };
  vi.spyOn(f.fs, "readStream").mockImplementation(() => { entered.resolve(); return stream; });
  const operation = f.shell.exec("mcp import catalog --file /credentials.json --timeout-ms 1000");
  try {
    await entered.promise;
    expect(deadline).toHaveBeenCalledWith(1000);
    controller.abort(new Error("credential input deadline"));
    const result = await Promise.race([operation, new Promise<"still pending">((resolve) => setTimeout(() => resolve("still pending"), 50))]);
    expect(cancel).toHaveBeenCalledOnce();
    expect(result).not.toBe("still pending");
    if (result === "still pending") throw new Error("Credential input deadline did not settle");
    expect(result.exitCode).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).toContain("credential input deadline");
    expect(cancel).toHaveBeenCalledOnce(); expect(f.fetch).not.toHaveBeenCalled();
  } finally {
    read.resolve({ done: true, value: undefined });
    await operation; deadline.mockRestore(); await f.shell.dispose();
  }
});
it.each([" ", "="])("passes separate CLI import byte/lock limits over host settings using %j", async separator => {
  const f = fixture("catalog", undefined, { maxImportBytes: 1, timeoutMs: 1 });
  await f.fs.writeFile("/credentials.json", new TextEncoder().encode(JSON.stringify(payload)));
  try {
    const result = await f.shell.exec(`mcp import catalog --file /credentials.json --max-import-bytes${separator}4096 --lock-timeout-ms${separator}1000 --timeout-ms=2000 --json`);
    expect(result.exitCode).toBe(0); expect(result.stderr).toBe(""); expect(JSON.parse(result.stdout).imported).toBe(true);
    expect(f.importSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ timeoutMs: 1000 }));
  } finally { await f.shell.dispose(); }
});
it("stops oversized virtual-file credential input at the CLI byte budget without reading later chunks", async () => {
  const f = fixture(), next = vi.fn();
  await f.fs.writeFile("/credentials.json", new Uint8Array(0));
  const fsRead = vi.spyOn(f.fs, "readStream").mockImplementation(() => ({ async *[Symbol.asyncIterator]() {
    next(); yield new Uint8Array(101); next(); yield new TextEncoder().encode("private-later-credential");
  } }));
  try {
    const result = await f.shell.exec("mcp import catalog --file /credentials.json --max-import-bytes=100");
    expect(result.exitCode).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).not.toContain("private-");
    expect(fsRead).toHaveBeenCalled(); expect(next).toHaveBeenCalledOnce();
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.importSession).not.toHaveBeenCalled();
  } finally { fsRead.mockRestore(); await f.shell.dispose(); }
});
it("applies a smaller host import budget while collecting input", async () => {
  const f = fixture("catalog", undefined, { maxImportBytes: 100 }), next = vi.fn();
  vi.spyOn(f.fs, "readStream").mockImplementation(() => ({ async *[Symbol.asyncIterator]() {
    next(); yield new Uint8Array(101); next(); yield new TextEncoder().encode("private-later-credential");
  } }));
  try {
    const result = await f.shell.exec("mcp import catalog --file /credentials.json");
    expect(result.exitCode).toBe(1); expect(next).toHaveBeenCalledOnce(); expect(f.fetch).not.toHaveBeenCalled();
  } finally { await f.shell.dispose(); }
});
it("rejects invalid/repeated import policy flags before reading credential input", async () => {
  const f = fixture(), read = vi.spyOn(f.fs, "readStream");
  try {
    for (const flag of ["--max-import-bytes", "--lock-timeout-ms"]) for (const suffix of ["", "=", "=0", "=-1", "=1.5", "=1e3", "=9007199254740992", "=2 " + flag + "=3"]) {
      const result = await f.shell.exec(`mcp import catalog --file /credentials.json ${flag}${suffix}`);
      expect(result.exitCode).toBe(2); expect(result.stdout).toBe(""); expect(result.stderr).toContain(flag);
    }
    const overflow = await f.shell.exec("mcp import catalog --lock-timeout-ms=2147483648 --file /credentials.json");
    expect(overflow.exitCode).toBe(2); expect(overflow.stderr).toContain("--lock-timeout-ms");
    expect(read).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled(); expect(f.importSession).not.toHaveBeenCalled();
  } finally { await f.shell.dispose(); }
});
it("stops and closes direct credential stdin at its selected byte budget", async () => {
  const f = fixture(), next = vi.fn(), closed = vi.fn(), output = vi.fn(async () => {}), errors = vi.fn(async () => {});
  const definition = createRemoteMcpManagementCommand([{ name: "catalog", url: resource, tools: [], auth: { type: "oauth", clientMode: "dynamic" } }],
    { credentialImport: { fetch: f.fetch, binding: { env: {}, oauth: { importSession: f.importSession } } } });
  const carrier = createCommandArguments(["import", "catalog", "--max-import-bytes=100"]);
  const context: CommandContext = { command: "mcp", args: carrier.args, argumentValues: carrier,
    signal: new AbortController().signal, cwd: "/", env: {}, fs: f.fs, stdout: { write: output }, stderr: { write: errors },
    stdin: { async *[Symbol.asyncIterator]() { try { next(); yield new Uint8Array(101); next(); yield new Uint8Array(1); } finally { closed(); } } } };
  try {
    expect(await definition.execute(context)).toEqual({ exitCode: 1 });
    expect(next).toHaveBeenCalledOnce(); expect(closed).toHaveBeenCalledOnce(); expect(output).not.toHaveBeenCalled(); expect(errors).toHaveBeenCalledOnce();
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.importSession).not.toHaveBeenCalled();
  } finally { await f.shell.dispose(); }
});
it("enforces the selected import budget on actual virtual stdin redirection", async () => {
  const f = fixture(); await f.fs.writeFile("/credentials.json", new TextEncoder().encode(JSON.stringify(payload)));
  try {
    const result = await f.shell.exec("mcp import catalog --max-import-bytes=100 < /credentials.json");
    expect(result.exitCode).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).not.toContain("private-");
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.importSession).not.toHaveBeenCalled();
  } finally { await f.shell.dispose(); }
});
