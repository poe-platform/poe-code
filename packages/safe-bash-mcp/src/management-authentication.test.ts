import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry, createCommandArguments, toByteSource, type CommandContext } from "@poe-platform/safe-bash/contracts";
import { createRemoteMcpManagementCommand } from "./index.js";
const server = { name: "catalog", url: "https://resource.example/mcp", tools: [], protocolVersion: "2025-03-26" as const,
  auth: { type: "bearer" as const, env: "TOKEN" } };
function fixture() {
  const requests: string[] = [];
  const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-token");
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    const request = JSON.parse(String(init?.body)); requests.push(request.method);
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "private-token", version: "1" } } });
  });
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { TOKEN: "private-token" }, commands: new CommandRegistry([
    createRemoteMcpManagementCommand([server], { authentication: { fetch } }) ]) });
  return { shell, fetch, requests };
}
it("authenticates a named supplied-schema server using shell credential references without listing tools", async () => {
  const f = fixture();
  try {
    const result = await f.shell.exec("mcp auth catalog --json");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ name: "catalog", url: server.url, connected: true });
    expect(result.stdout + result.stderr).not.toContain("private-token");
    expect(f.requests).toEqual(["initialize", "notifications/initialized"]);
  } finally { await f.shell.dispose(); }
});

it("selects a literal leading-dash server name and overrides a host request deadline", async () => {
  const f = fixture();
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { TOKEN: "private-token" }, commands: new CommandRegistry([
    createRemoteMcpManagementCommand([{ ...server, name: "-catalog" }], { authentication: { fetch: f.fetch, requestTimeoutMs: 1 } }) ]) });
  try {
    const result = await shell.exec("mcp auth --json --timeout-ms=1000 -- -catalog");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ name: "-catalog", url: server.url, connected: true });
  } finally { await shell.dispose(); await f.shell.dispose(); }
});

it("fails missing credentials before making a connection", async () => {
  const f = fixture();
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry([
    createRemoteMcpManagementCommand([server], { authentication: { fetch: f.fetch } }) ]) });
  try {
    const result = await shell.exec("mcp auth catalog");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("TOKEN");
    expect(f.fetch).not.toHaveBeenCalled();
  } finally { await shell.dispose(); await f.shell.dispose(); }
});

it("shows focused auth help before reading credentials or contacting a server", async () => {
  const f = fixture();
  try {
    const result = await f.shell.exec("mcp auth --help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^Usage: mcp auth /u);
    expect(result.stdout).toContain("--timeout-ms");
    expect(result.stdout).toContain("--browser none|host");
    expect(f.fetch).not.toHaveBeenCalled();
  } finally { await f.shell.dispose(); }
});

function oauthFixture(args = ["auth", "catalog", "--json"], tokenFailures = 0) {
  const resource = "https://resource.example/mcp", issuer = "https://issuer.example";
  let callback = Promise.withResolvers<string>();
  let stdout = "", stderr = "";
  let session: import("mcp-oauth").StoredOAuthSession | null = null;
  const opener = vi.fn(async () => {});
  const observer = vi.fn(async (event: { authorizationUrl: string; redirectUri: string }) => {
    // Delivery is complete before either host integration or callback waiting.
    expect(stdout).toContain(event.authorizationUrl);
    const authorization = new URL(event.authorizationUrl), redirect = new URL(event.redirectUri);
    expect(authorization.searchParams.get("client_id")).toBe("host-client");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    redirect.searchParams.set("code", "synthetic-code");
    redirect.searchParams.set("state", authorization.searchParams.get("state")!);
    callback.resolve(redirect.href);
    callback = Promise.withResolvers<string>();
  });
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes(".well-known/oauth-protected-resource")) return Response.json({ resource, authorization_servers: [issuer] });
    if (url.includes(".well-known/oauth-authorization-server")) return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
    if (url === `${issuer}/token`) {
      if (tokenFailures-- > 0) return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
      return Response.json({ access_token: "private-access", token_type: "Bearer", expires_in: 3600 });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method !== "POST") return new Response(null, { status: 405 });
    if (new Headers(init.headers).get("Authorization") !== "Bearer private-access") return new Response(null, { status: 401 });
    const request = JSON.parse(String(init.body));
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    expect(request.method).toBe("initialize");
    return Response.json({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "private-access", version: "1" } } });
  });
  const binding = { env: { ID: "host-client" }, oauth: { now: () => 1000, sessionStore: () => ({ load: async () => session,
    save: async (_key: string, value: import("mcp-oauth").StoredOAuthSession) => { session = value; }, clear: async () => { session = null; } }),
    browser: { openBrowser: opener, readLine: () => callback.promise } } };
  const servers = [{ name: "catalog", url: resource, tools: [], protocolVersion: "2025-03-26" as const, auth: {
    type: "oauth" as const, clientMode: "static" as const, env: { clientId: "ID" }, redirectUri: "http://127.0.0.1:39141/callback" } }];
  const carrier = createCommandArguments(args), controller = new AbortController();
  const context: CommandContext = { command: "mcp", args: carrier.args, argumentValues: carrier,
    signal: controller.signal, stdin: toByteSource(""), stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }, cwd: "/", env: { ID: "shell-client" }, fs: createMemoryFileSystem() };
  return { context, servers, binding, fetch, observer, opener, controller, output: () => ({ stdout, stderr }) };
}

it("delivers a headless JSON authorization URL before consent and sends the public success summary to stderr", async () => {
  const f = oauthFixture();
  const command = createRemoteMcpManagementCommand(f.servers, { authentication: { binding: f.binding, fetch: f.fetch, onAuthorizationUrl: f.observer } });
  expect(await command.execute(f.context)).toEqual({ exitCode: 0 });
  const output = f.output();
  expect(JSON.parse(output.stdout)).toEqual(expect.objectContaining({ authorizationUrl: expect.stringContaining("/authorize?"), redirectUri: "http://127.0.0.1:39141/callback" }));
  expect(JSON.parse(output.stderr)).toEqual({ name: "catalog", url: server.url, connected: true });
  expect(output.stdout + output.stderr).not.toContain("private-access");
  expect(f.opener).not.toHaveBeenCalled();
});

it("prints complete headless text guidance before consent", async () => {
  const f = oauthFixture(["auth", "catalog"]);
  const command = createRemoteMcpManagementCommand(f.servers, { authentication: { binding: f.binding, fetch: f.fetch, onAuthorizationUrl: f.observer } });
  expect(await command.execute(f.context)).toEqual({ exitCode: 0 });
  expect(f.output().stdout).toContain("Authorization URL: https://issuer.example/authorize?");
  expect(f.output().stdout).toContain("Redirect URI: http://127.0.0.1:39141/callback\n");
  expect(f.output().stderr).toBe("Connected to catalog.\n");
});

it("streams a JSON record for each authorization attempt after a transient token failure", async () => {
  const f = oauthFixture(undefined, 1);
  const command = createRemoteMcpManagementCommand(f.servers, { authentication: { binding: f.binding, fetch: f.fetch, onAuthorizationUrl: f.observer } });
  expect(await command.execute(f.context)).toEqual({ exitCode: 0 });
  const events = f.output().stdout.trim().split("\n").map(line => JSON.parse(line));
  expect(events).toHaveLength(2);
  expect(events[0].authorizationUrl).not.toBe(events[1].authorizationUrl);
  expect(f.observer).toHaveBeenCalledTimes(2);
});

it("bounds aggregate URL output across authorization retries", async () => {
  const f = oauthFixture(undefined, 1);
  const command = createRemoteMcpManagementCommand(f.servers, { maxOutputBytes: 700, authentication: { binding: f.binding, fetch: f.fetch, onAuthorizationUrl: f.observer } });
  await expect(command.execute(f.context)).rejects.toThrow("output byte limit");
  expect(f.output().stdout.trim().split("\n")).toHaveLength(1);
  expect(f.observer).toHaveBeenCalledOnce();
});

it.each(["--browser=host", "--browser host"])("launches only the configured host browser with %s", async selection => {
  const f = oauthFixture(["auth", "catalog", "--json", ...selection.split(" ")]);
  const command = createRemoteMcpManagementCommand(f.servers, { authentication: { binding: f.binding, fetch: f.fetch, onAuthorizationUrl: f.observer } });
  expect(await command.execute(f.context)).toEqual({ exitCode: 0 });
  expect(f.opener).toHaveBeenCalledWith(JSON.parse(f.output().stdout).authorizationUrl);
});

it("overrides a host browser preference with explicit --no-browser", async () => {
  const f = oauthFixture(["auth", "catalog", "--json", "--no-browser"]);
  const command = createRemoteMcpManagementCommand(f.servers, { authentication: { binding: f.binding, fetch: f.fetch, noBrowser: false, onAuthorizationUrl: f.observer } });
  expect(await command.execute(f.context)).toEqual({ exitCode: 0 });
  expect(f.opener).not.toHaveBeenCalled();
});

it("reuses a cached grant and emits no second authorization URL", async () => {
  const f = oauthFixture();
  const command = createRemoteMcpManagementCommand(f.servers, { authentication: { binding: f.binding, fetch: f.fetch, onAuthorizationUrl: f.observer } });
  expect(await command.execute(f.context)).toEqual({ exitCode: 0 });
  expect(await command.execute(f.context)).toEqual({ exitCode: 0 });
  const lines = f.output().stdout.trim().split("\n").map(line => JSON.parse(line));
  expect(lines).toHaveLength(2);
  expect(lines[1]).toEqual({ name: "catalog", url: server.url, connected: true });
  expect(f.observer).toHaveBeenCalledOnce();
});

it("rejects authorization URL sink failure without invoking the observer or token endpoint", async () => {
  const f = oauthFixture(), failure = new Error("URL sink closed");
  const command = createRemoteMcpManagementCommand(f.servers, { authentication: { binding: f.binding, fetch: f.fetch, onAuthorizationUrl: f.observer } });
  await expect(command.execute({ ...f.context, stdout: { write: async () => { throw failure; } } })).rejects.toBe(failure);
  expect(f.observer).not.toHaveBeenCalled();
  expect(f.opener).not.toHaveBeenCalled();
  expect(f.output().stderr).toBe("");
  expect(f.fetch.mock.calls.some(([url]) => String(url).endsWith("/token"))).toBe(false);
});

it("propagates a cached connection summary sink failure without writing a misleading authentication error", async () => {
  const f = fixture(), failure = new Error("summary sink closed");
  const carrier = createCommandArguments(["auth", "catalog", "--json"]);
  const errors = vi.fn(async () => {});
  const command = createRemoteMcpManagementCommand([server], { authentication: { fetch: f.fetch } });
  try {
    await expect(command.execute({ command: "mcp", args: carrier.args, argumentValues: carrier, signal: new AbortController().signal,
      stdin: toByteSource(""), stdout: { write: async () => { throw failure; } }, stderr: { write: errors },
      cwd: "/", env: { TOKEN: "private-token" }, fs: createMemoryFileSystem() })).rejects.toBe(failure);
    expect(errors).not.toHaveBeenCalled();
  } finally { await f.shell.dispose(); }
});

it("enforces the authorization output bound before invoking host hooks", async () => {
  const f = oauthFixture();
  const command = createRemoteMcpManagementCommand(f.servers, { maxOutputBytes: 256, authentication: { binding: f.binding, fetch: f.fetch, onAuthorizationUrl: f.observer } });
  await expect(command.execute(f.context)).rejects.toThrow("output byte limit");
  expect(f.output()).toEqual({ stdout: "", stderr: "" });
  expect(f.observer).not.toHaveBeenCalled();
});

it("propagates cancellation during URL observation and never launches the selected browser", async () => {
  const f = oauthFixture(["auth", "catalog", "--json", "--browser", "host"]), reason = new Error("cancel auth");
  const command = createRemoteMcpManagementCommand(f.servers, { authentication: { binding: f.binding, fetch: f.fetch,
    onAuthorizationUrl: async () => { f.controller.abort(reason); } } });
  await expect(command.execute(f.context)).rejects.toBe(reason);
  expect(f.opener).not.toHaveBeenCalled();
  expect(f.output().stderr).toBe("");
});
it.each(["mcp auth", "mcp auth unknown", "mcp auth catalog other", "mcp auth catalog --browser", "mcp auth catalog --browser invalid",
  "mcp auth catalog --json --json", "mcp auth catalog --no-browser --browser host", "mcp auth catalog --timeout-ms", "mcp auth catalog --timeout-ms=",
  "mcp auth catalog --timeout-ms 0", "mcp auth catalog --timeout-ms 2147483648", "mcp auth catalog --timeout-ms 25abc", "mcp auth catalog --timeout-ms 1.5",
  "mcp auth catalog --timeout-ms 100 --timeout-ms 200"])("rejects invalid auth usage before connecting: %s", async script => {
  const f = fixture();
  try { const result = await f.shell.exec(script); expect(result.exitCode).toBe(2); expect(result.stdout).toBe(""); expect(f.fetch).not.toHaveBeenCalled(); }
  finally { await f.shell.dispose(); }
});
