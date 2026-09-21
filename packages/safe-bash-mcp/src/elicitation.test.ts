import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry, createCommandArguments, toByteSource, type CommandContext } from "@poe-platform/safe-bash/contracts";
import type { ElicitationParams, ElicitationResult, HttpTransportFetch, McpRequestContext } from "tiny-mcp-client";
import { createRemoteMcpCommands, fetchRemoteMcpSchema, generateRemoteMcpArtifact, initRemoteMcpConfiguration, remoteMcpArtifactPlugin } from "./index.js";

const tool = { name: "confirm", inputSchema: { type: "object" } };
const server = { name: "jobs", url: "https://jobs.example/mcp", tools: [tool], protocolVersion: "2026-07-28" as const };
const form: ElicitationParams = { message: "Choose a project", requestedSchema: { type: "object", properties: { project: { type: "string" } }, required: ["project"] } };
function remote(input: ElicitationParams = form, operation = "tools/call") {
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  const fetch = vi.fn<HttpTransportFetch>(async (requestUrl, init) => {
    expect(String(requestUrl)).toBe(server.url);
    expect(init?.method).toBe("POST");
    const request = JSON.parse(String(init?.body)); requests.push(request);
    if (request.method === "server/discover") return Response.json({ jsonrpc: "2.0", id: request.id, result: {
      resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, ttlMs: 0, cacheScope: "private"
    } });
    expect(request.method).toBe(operation);
    const result = request.params.inputResponses === undefined
      ? { resultType: "input_required", requestState: "original-state", inputRequests: { question: { method: "elicitation/create", params: input } } }
      : operation === "tools/list" ? { resultType: "complete", tools: [tool], ttlMs: 0, cacheScope: "private" }
        : { resultType: "complete", content: [{ type: "text", text: JSON.stringify(request.params.inputResponses) }] };
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  });
  return { fetch, requests };
}

it("declines remote input without a host handler and preserves the server's final result", async () => {
  const f = remote(), onWarning = vi.fn();
  const commands = await createRemoteMcpCommands([server], { fetch: f.fetch, onWarning });
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
  try {
    const result = await shell.exec("jobs confirm");
    expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).content).toEqual([{ type: "text", text: JSON.stringify({ question: { action: "decline" } }) }]);
    expect(f.requests.at(-1)?.params).toMatchObject({ requestState: "original-state", inputResponses: { question: { action: "decline" } } });
    expect(onWarning).toHaveBeenCalledOnce(); expect(onWarning.mock.calls[0][0]).toContain("onElicitationRequest");
  } finally { await shell.dispose(); }
});

it("routes typed form input to an attributed host handler with native cancellation context", async () => {
  const f = remote(), onWarning = vi.fn();
  const handler = vi.fn((_params: ElicitationParams, _context: McpRequestContext & { server: { name: string; url: string } }): ElicitationResult => ({ action: "accept", content: { project: "chosen-project" } }));
  const commands = await createRemoteMcpCommands([server], { fetch: f.fetch, onWarning, onElicitationRequest: handler });
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
  try {
    const result = await shell.exec("jobs confirm");
    expect(result.exitCode).toBe(0); expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toEqual(form);
    expect(handler.mock.calls[0][1]).toMatchObject({ method: "elicitation/create", server: { name: server.name, url: server.url } });
    expect(handler.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(JSON.parse(result.stdout).content[0].text)).toEqual({ question: { action: "accept", content: { project: "chosen-project" } } });
    expect(onWarning).not.toHaveBeenCalled();
  } finally { await shell.dispose(); }
});

it("preserves a URL input request for the host without opening it", async () => {
  const urlInput: ElicitationParams = { mode: "url", message: "Continue externally", url: "https://jobs.example/consent?state=a=b&next=%2Ftasks", elicitationId: "external-1" };
  const f = remote(urlInput), handler = vi.fn((): ElicitationResult => ({ action: "cancel" }));
  const commands = await createRemoteMcpCommands([server], { fetch: f.fetch, onElicitationRequest: handler });
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
  try {
    expect((await shell.exec("jobs confirm")).exitCode).toBe(0);
    expect(handler).toHaveBeenCalledWith(urlInput, expect.objectContaining({ server: { name: server.name, url: server.url } }));
    expect(f.requests.at(-1)?.params.inputResponses).toEqual({ question: { action: "cancel" } });
  } finally { await shell.dispose(); }
});

it("declines URL input without following the URL or rendering untrusted prompt text", async () => {
  const input: ElicitationParams = { mode: "url", message: "private-prompt\u001b]52;c;injected\u0007", url: "https://external.example/consent?private=value", elicitationId: "external-1" };
  const f = remote(input), onWarning = vi.fn();
  const commands = await createRemoteMcpCommands([server], { fetch: f.fetch, onWarning });
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
  try {
    expect((await shell.exec("jobs confirm")).exitCode).toBe(0);
    expect(f.requests.at(-1)?.params.inputResponses).toEqual({ question: { action: "decline" } });
    expect(onWarning).toHaveBeenCalledOnce();
    expect(onWarning.mock.calls[0][0]).not.toContain("private"); expect(onWarning.mock.calls[0][0]).not.toContain("\u001b");
  } finally { await shell.dispose(); }
});

it("rejects malformed input parameters before handing them to the host", async () => {
  const f = remote({ message: 12 } as never), handler = vi.fn((): ElicitationResult => ({ action: "accept" }));
  const commands = await createRemoteMcpCommands([server], { fetch: f.fetch, onElicitationRequest: handler });
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
  try {
    const result = await shell.exec("jobs confirm");
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain("Invalid MCP input_required result");
    expect(handler).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(2);
  } finally { await shell.dispose(); }
});

it("rejects malformed host responses before submitting a continuation", async () => {
  const f = remote(), handler = vi.fn(() => ({ action: "approve" }) as never);
  const commands = await createRemoteMcpCommands([server], { fetch: f.fetch, onElicitationRequest: handler });
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
  try {
    const result = await shell.exec("jobs confirm");
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain("Invalid MCP input response");
    expect(handler).toHaveBeenCalledOnce(); expect(f.requests).toHaveLength(2);
  } finally { await shell.dispose(); }
});

it("rejects protocol-invalid discovery input before invoking a host handler", async () => {
  const f = remote(form, "tools/list"), onWarning = vi.fn(), handler = vi.fn((): ElicitationResult => ({ action: "decline" }));
  await expect(fetchRemoteMcpSchema({ ...server, tools: undefined }, { fetch: f.fetch, onWarning, onElicitationRequest: handler })).rejects.toThrow("Invalid MCP input_required result");
  expect(handler).not.toHaveBeenCalled(); expect(onWarning).not.toHaveBeenCalled();
});

it("reinjects host input handling when commands are recreated from an artifact", async () => {
  const f = remote(), handler = vi.fn((): ElicitationResult => ({ action: "accept", content: { project: "archived-host" } }));
  const configuration = initRemoteMcpConfiguration([server]).configuration;
  const generated = await generateRemoteMcpArtifact(configuration);
  const shell = new Shell({ fs: createMemoryFileSystem() });
  await shell.use(await remoteMcpArtifactPlugin(generated.artifact, { binding: { env: {} }, commands: { fetch: f.fetch, onElicitationRequest: handler } }));
  try {
    const result = await shell.exec("jobs confirm");
    expect(result.exitCode).toBe(0); expect(handler).toHaveBeenCalledOnce();
    expect(f.requests.some(request => request.method === "tools/list")).toBe(false);
    expect(generated.json).not.toContain("archived-host");
  } finally { await shell.dispose(); }
});

it("cancels a pending host input hook without submitting a continuation", async () => {
  const f = remote(), controller = new AbortController();
  let started!: () => void, hookSignal!: AbortSignal;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const handler = vi.fn((_params: ElicitationParams, context: McpRequestContext): Promise<ElicitationResult> => {
    hookSignal = context.signal; started(); return new Promise(() => {});
  });
  const commands = await createRemoteMcpCommands([server], { fetch: f.fetch, signal: controller.signal, onElicitationRequest: handler });
  const carrier = createCommandArguments(["confirm"]), sink = { write: vi.fn(async () => {}) };
  const context: CommandContext = { command: "jobs", args: carrier.args, argumentValues: carrier, signal: controller.signal,
    stdin: toByteSource(""), stdout: sink, stderr: sink, cwd: "/", env: {}, fs: createMemoryFileSystem() };
  const outcome = commands[0].execute(context).catch(error => error);
  await Promise.race([entered, outcome.then(value => { throw value; })]);
  const reason = new Error("host input canceled"); controller.abort(reason);
  expect(await outcome).toBe(reason); expect(sink.write).not.toHaveBeenCalled();
  expect(hookSignal.aborted).toBe(true); expect(handler).toHaveBeenCalledOnce();
  expect(f.requests).toHaveLength(2); expect(f.requests.at(-1)?.params).not.toHaveProperty("inputResponses");
});

it("bounds a stalled host input hook with the configured request deadline", async () => {
  const f = remote(); let hookSignal!: AbortSignal;
  const handler = vi.fn((_params: ElicitationParams, context: McpRequestContext): Promise<ElicitationResult> => {
    hookSignal = context.signal; return new Promise(() => {});
  });
  const commands = await createRemoteMcpCommands([server], { fetch: f.fetch, requestTimeoutMs: 20, onElicitationRequest: handler });
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
  try {
    const result = await shell.exec("jobs confirm");
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain('timed out after 20ms');
    expect(handler).toHaveBeenCalledOnce(); expect(hookSignal.aborted).toBe(true);
    expect(f.requests).toHaveLength(2); expect(f.requests.at(-1)?.params).not.toHaveProperty("inputResponses");
  } finally { await shell.dispose(); }
});

it("handles a legacy server-initiated form request over an owned HTTP receive stream", async () => {
  const encoder = new TextEncoder(), onWarning = vi.fn();
  let events!: ReadableStreamDefaultController<Uint8Array>, toolId: string | number, closed = 0;
  const replies: unknown[] = [];
  const send = (message: unknown) => events.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`));
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method === "GET") return new Response(new ReadableStream<Uint8Array>({ start(controller) { events = controller; }, cancel() { closed++; } }), { headers: { "Content-Type": "text/event-stream" } });
    const request = JSON.parse(String(init?.body));
    if (request.method === "initialize") return Response.json({ jsonrpc: "2.0", id: request.id, result: {
      protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "legacy-jobs", version: "1" }
    } }, { headers: { "Mcp-Session-Id": "owned-input-session" } });
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (request.method === "tools/call") {
      toolId = request.id;
      send({ jsonrpc: "2.0", id: "question", method: "elicitation/create", params: form });
      return new Response(null, { status: 202 });
    }
    expect(request.id).toBe("question"); replies.push(request.result);
    send({ jsonrpc: "2.0", id: toolId, result: { content: [{ type: "text", text: JSON.stringify(request.result) }] } });
    return new Response(null, { status: 202 });
  });
  const commands = await createRemoteMcpCommands([{ ...server, protocolVersion: "2025-03-26" }], { fetch, onWarning });
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
  try {
    const result = await shell.exec("jobs confirm");
    expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
    expect(replies).toEqual([{ action: "decline" }]);
    expect(JSON.parse(JSON.parse(result.stdout).content[0].text)).toEqual({ action: "decline" });
    expect(onWarning).toHaveBeenCalledOnce(); expect(closed).toBe(1);
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  } finally { await shell.dispose(); }
});
