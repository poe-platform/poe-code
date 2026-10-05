import { afterEach, expect, it, vi } from "vitest";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import type { HttpTransportFetch } from "tiny-mcp-client";
import { createRemoteMcpCommands, type RemoteMcpCommandOptions } from "./index.js";

const server = { name: "tasks", url: "https://tasks.invalid/mcp", transport: "http" as const,
  protocolVersion: "2025-03-26" as const, tools: [{ name: "find", inputSchema: {
    type: "object", properties: { query: { type: "string" } }, required: ["query"]
  } }] };

function invocation(args = ["find", "--query", "private query"], signal = new AbortController().signal) {
  const output: Uint8Array[] = [], errors: Uint8Array[] = [], carrier = createCommandArguments([]).withValues(args);
  const context: CommandContext = { command: "tasks", args: carrier.args, argumentValues: carrier, signal,
    stdin: toByteSource(""), stdout: { async write(chunk) { output.push(chunk.slice()); } },
    stderr: { async write(chunk) { errors.push(chunk.slice()); } }, cwd: "/", env: {}, fs: {} as CommandContext["fs"] };
  return { context, error: () => new TextDecoder().decode(Buffer.concat(errors)) };
}

function remote(messages: string[] | ((query: string) => string[]) = ["halfway"], rejectSetup = false) {
  const calls: { token?: string; query: string }[] = [];
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method !== "POST") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init.body));
    if (request.id === undefined) return new Response(null, { status: 202 });
    if (request.method === "initialize") return rejectSetup ? new Response(null, { status: 503 }) : Response.json({
      jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} },
        serverInfo: { name: "tasks", version: "1" } }
    }, { headers: { "Mcp-Session-Id": "test-session" } });
    const token = request.params._meta?.progressToken;
    calls.push({ token, query: request.params.arguments.query });
    const selected = typeof messages === "function" ? messages(request.params.arguments.query) : messages;
    const notifications = token === undefined ? [] : selected.map((message, index) => ({
      jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: token, progress: index + 1,
        total: selected.length, message }
    }));
    const result = { jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "done" }] } };
    return new Response([...notifications, result].map(value => `data: ${JSON.stringify(value)}\n\n`).join(""), {
      headers: { "Content-Type": "text/event-stream" }
    });
  });
  return { fetch, calls };
}

it("reports only validated tool identity and correlates concurrent command progress", async () => {
  const f = remote(query => [query === "private query" ? "first" : "second"]), starts = vi.fn(), progress = vi.fn();
  const options: RemoteMcpCommandOptions = { fetch: f.fetch, onToolStart: starts, onToolProgress: progress };
  const [command] = await createRemoteMcpCommands([server], options);
  const inputs = [invocation(), invocation(["find", "--query", "another private query"])];
  expect(await Promise.all(inputs.map(input => command.execute(input.context)))).toEqual([{ exitCode: 0 }, { exitCode: 0 }]);
  expect(starts).toHaveBeenCalledTimes(2); expect(progress).toHaveBeenCalledTimes(2);
  const contexts = starts.mock.calls.map(([context]) => context);
  expect(new Set(contexts.map(context => context.invocationId)).size).toBe(2);
  for (const context of contexts) {
    expect(Object.keys(context).sort()).toEqual(["invocationId", "serverName", "signal", "toolName"]);
    expect(context).toMatchObject({ serverName: "tasks", toolName: "find" });
    const call = f.calls.find(call => call.token === context.invocationId);
    expect(call).toBeDefined();
    const message = call?.query === "private query" ? "first" : "second";
    expect(progress.mock.calls.some(([event, owner]) => owner === context && event.message === message)).toBe(true);
  }
});

it.each([["--help"], ["find", "--schema"], ["find", "--help"], ["missing"], ["find"]].map(args => ({ args })))(
  "does not report a remote start for inspection or invalid input $args", async ({ args }) => {
    const f = remote(), start = vi.fn(), progress = vi.fn();
    const [command] = await createRemoteMcpCommands([server], { fetch: f.fetch, onToolStart: start, onToolProgress: progress });
    await command.execute(invocation(args).context);
    expect(start).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  });

it("does not report a start when connection setup fails", async () => {
  const f = remote([], true), start = vi.fn();
  const [command] = await createRemoteMcpCommands([server], { fetch: f.fetch, onToolStart: start });
  expect(await command.execute(invocation().context)).toEqual({ exitCode: 1 });
  expect(start).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
});

it("a rejected start callback prevents dispatch without exposing its error", async () => {
  const f = remote();
  const [command] = await createRemoteMcpCommands([server], { fetch: f.fetch,
    onToolStart: async () => { throw new Error("private observer diagnostic"); } });
  const input = invocation();
  expect(await command.execute(input.context)).toEqual({ exitCode: 1 });
  expect(f.calls).toHaveLength(0); expect(input.error()).not.toContain("private observer diagnostic");
  expect(input.error()).toContain("lifecycle callback failed");
});

it("a rejected progress callback cancels the call without replaying a possible write", async () => {
  const f = remote(), progress = vi.fn(async () => { throw new Error("private callback error"); });
  const [command] = await createRemoteMcpCommands([server], { fetch: f.fetch, onToolProgress: progress });
  const input = invocation();
  expect(await command.execute(input.context)).toEqual({ exitCode: 1 });
  expect(f.calls).toHaveLength(1); expect(progress).toHaveBeenCalledOnce();
  expect(input.error()).toContain("lifecycle callback failed"); expect(input.error()).not.toContain("private callback error");
});

it.each([{ maxProgressEvents: 1 }, { maxProgressMessageBytes: 3 }])("enforces progress observer limits %j", async limits => {
  const f = remote(["one", "four"]), progress = vi.fn();
  const [command] = await createRemoteMcpCommands([server], { fetch: f.fetch, onToolProgress: progress, ...limits });
  const input = invocation();
  expect(await command.execute(input.context)).toEqual({ exitCode: 1 });
  expect(f.calls).toHaveLength(1); expect(progress).toHaveBeenCalledTimes(1);
  expect(input.error()).toContain("progress limit exceeded");
});

it("cancels a pending start callback and never dispatches after it eventually resolves", async () => {
  const f = remote(), entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>(), controller = new AbortController();
  const [command] = await createRemoteMcpCommands([server], { fetch: f.fetch, onToolStart: async () => {
    entered.resolve(); await resume.promise;
  } });
  const pending = command.execute(invocation(undefined, controller.signal).context);
  await entered.promise; controller.abort(new Error("cancelled by host"));
  await expect(pending).rejects.toThrow("cancelled by host");
  resume.resolve(); await Promise.resolve(); expect(f.calls).toHaveLength(0);
});

it("cancels a pending progress observer without accepting a late successful result", async () => {
  const f = remote(["one", "two"]), entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const controller = new AbortController(), progress = vi.fn(async () => { entered.resolve(); await resume.promise; });
  const [command] = await createRemoteMcpCommands([server], { fetch: f.fetch, onToolProgress: progress });
  const pending = command.execute(invocation(undefined, controller.signal).context);
  await entered.promise; controller.abort(new Error("cancel pending progress"));
  await expect(pending).rejects.toThrow("cancel pending progress");
  resume.resolve(); await Promise.resolve();
  expect(f.calls).toHaveLength(1); expect(progress).toHaveBeenCalledOnce();
});

it("captures nonenumerable callback handles and limits before command generation", async () => {
  const f = remote(["one", "two"]), start = vi.fn(), progress = vi.fn(), replacement = vi.fn();
  const options = Object.defineProperties({ fetch: f.fetch }, {
    onToolStart: { value: start, writable: true }, onToolProgress: { value: progress, writable: true },
    maxProgressEvents: { value: 1, writable: true }, maxProgressMessageBytes: { value: 3, writable: true }
  });
  const [command] = await createRemoteMcpCommands([server], options);
  Object.defineProperties(options, { onToolStart: { value: replacement }, onToolProgress: { value: replacement },
    maxProgressEvents: { value: 100 }, maxProgressMessageBytes: { value: 100 } });
  expect(await command.execute(invocation().context)).toEqual({ exitCode: 1 });
  expect(start).toHaveBeenCalledOnce(); expect(progress).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled();
});


// Native AbortSignal.timeout is not controlled by Vitest's fake clock.
function fakeDeadlines() {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
    return controller.signal;
  });
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(["none", "start", "slow start", "progress"])("keeps handshake and tool timeout budgets independent with %s observer", async observe => {
  fakeDeadlines();
  const f = remote(), initialized = Promise.withResolvers<void>(), called = Promise.withResolvers<void>();
  const fetch: HttpTransportFetch = async (url, init) => {
    const method = init?.method === "POST" ? JSON.parse(String(init.body)).method : undefined;
    if (method === "initialize" || method === "tools/call") {
      (method === "initialize" ? initialized : called).resolve();
      await new Promise(resolve => setTimeout(resolve, 650));
    }
    return f.fetch(url, init);
  };
  const [command] = await createRemoteMcpCommands([server], { fetch, requestTimeoutMs: 1000,
    ...(observe === "none" ? {} : observe === "progress" ? { onToolProgress: () => {} }
      : { onToolStart: () => observe === "slow start" ? new Promise<void>(resolve => setTimeout(resolve, 650)) : undefined }) });
  const pending = command.execute(invocation().context);
  await initialized.promise;
  await vi.advanceTimersByTimeAsync(observe === "slow start" ? 1300 : 650);
  await called.promise;
  await vi.advanceTimersByTimeAsync(650);
  expect(await pending).toEqual({ exitCode: 0 });
  expect(f.calls).toHaveLength(1);
  expect(f.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
});

it.each(["initialize", "tools/call"])("retains the per-RPC deadline for %s with observers", async slowMethod => {
  fakeDeadlines();
  const f = remote(), entered = Promise.withResolvers<void>();
  const fetch: HttpTransportFetch = async (url, init) => {
    if (init?.method === "POST" && JSON.parse(String(init.body)).method === slowMethod) {
      entered.resolve();
      await new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
    }
    return f.fetch(url, init);
  };
  const [command] = await createRemoteMcpCommands([server], { fetch, requestTimeoutMs: 1000, onToolStart: () => {} });
  const input = invocation(), pending = command.execute(input.context);
  await entered.promise;
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toEqual({ exitCode: 1 });
  expect(input.error()).toContain("timed out");
  if (slowMethod === "tools/call")
    expect(f.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
});

it.each(["start", "progress"])("bounds a pending %s callback independently after setup", async hook => {
  fakeDeadlines();
  const f = remote(), initialized = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const fetch: HttpTransportFetch = async (url, init) => {
    if (init?.method === "POST" && JSON.parse(String(init.body)).method === "initialize") {
      initialized.resolve();
      await new Promise(resolve => setTimeout(resolve, 650));
    }
    return f.fetch(url, init);
  };
  let signal: AbortSignal | undefined;
  const observer = async (owner: { signal: AbortSignal }) => {
    signal = owner.signal; entered.resolve(); await new Promise(() => {});
  };
  const [command] = await createRemoteMcpCommands([server], { fetch, requestTimeoutMs: 1000,
    ...(hook === "start" ? { onToolStart: observer } : { onToolProgress: (_progress, owner) => observer(owner) }) });
  const pending = command.execute(invocation().context);
  await initialized.promise;
  await vi.advanceTimersByTimeAsync(650);
  await entered.promise;
  await vi.advanceTimersByTimeAsync(350);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(650);
  expect(await pending).toEqual({ exitCode: 1 });
  expect(signal?.aborted).toBe(true);
  expect(f.calls).toHaveLength(hook === "start" ? 0 : 1);
  expect(f.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
});


it("propagates caller cancellation during the tool RPC and closes the session", async () => {
  const f = remote(), entered = Promise.withResolvers<void>(), controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const fetch: HttpTransportFetch = async (url, init) => {
    if (init?.method === "POST" && JSON.parse(String(init.body)).method === "tools/call") {
      requestSignal = init.signal!;
      entered.resolve();
      await new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
    }
    return f.fetch(url, init);
  };
  const [command] = await createRemoteMcpCommands([server], { fetch, onToolStart: () => {} });
  const pending = command.execute(invocation(undefined, controller.signal).context);
  const rejected = expect(pending).rejects.toThrow("caller cancelled RPC");
  await entered.promise;
  controller.abort(new Error("caller cancelled RPC"));
  await rejected;
  expect(requestSignal?.aborted).toBe(true);
  expect(f.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
});
