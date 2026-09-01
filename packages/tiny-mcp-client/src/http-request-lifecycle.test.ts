import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpTransport, McpClient, type JsonRpcRequest } from "./index.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settleStreams(): Promise<void> {
  await nextTurn();
  await nextTurn();
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  try {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  } finally {
    vi.useRealTimers();
  }
});

async function createFixture(format: "json" | "sse", session: boolean) {
  const posts: Array<{ request: JsonRpcRequest; headers: Headers; signal: AbortSignal }> = [];
  const pending = new Map<string, { finish: () => void; fail: (error: Error) => void }>();
  const effects: string[] = [];
  const deletions: string[] = [];
  const cancelledBodies: string[] = [];
  let phase = "active";
  const transport = new HttpTransport({
    url: "https://mcp.invalid/lifecycle",
    fetch: async (input, init) => {
      expect(String(input)).toBe("https://mcp.invalid/lifecycle");
      const headers = new Headers(init?.headers);
      if (init?.method === "GET") {
        return new Response(null, { status: 405 });
      }
      if (init?.method === "DELETE") {
        deletions.push(headers.get("Mcp-Session-Id") ?? "");
        return new Response(null, { status: 204 });
      }
      expect(init?.method).toBe("POST");
      const request = JSON.parse(String(init?.body)) as JsonRpcRequest;
      posts.push({ request, headers, signal: init?.signal as AbortSignal });
      if (request.method === "initialize") {
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "lifecycle-fixture", version: "1" },
          },
        }, { headers: session ? { "Mcp-Session-Id": "fixture-session" } : {} });
      }
      if (request.method.startsWith("notifications/")) {
        return new Response(null, { status: 202 });
      }
      expect(request.method).toBe("tools/call");
      const { name } = request.params as { name: string };
      const reply = {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: name }] },
      };
      if (name === "record") {
        effects.push(phase);
        return Response.json(reply);
      }
      if (format === "json") {
        const response = deferred<Response>();
        pending.set(name, {
          finish: () => {
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(JSON.stringify(reply)));
              },
              pull(controller) {
                controller.close();
              },
              cancel() {
                cancelledBodies.push(name);
              },
            });
            response.resolve(new Response(body, {
              headers: {
                "Content-Type": "application/json",
                ...(session ? { "Mcp-Session-Id": "fixture-session" } : {}),
              },
            }));
          },
          fail: response.reject,
        });
        return response.promise;
      }
      let closed = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          pending.set(name, {
            finish: () => {
              if (!closed) {
                closed = true;
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(reply)}\n\n`));
                controller.close();
              }
            },
            fail: (error) => {
              if (!closed) {
                closed = true;
                controller.error(error);
              }
            },
          });
        },
        cancel() {
          closed = true;
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  const client = new McpClient({
    clientInfo: { name: "lifecycle-client", version: "1" },
    requestTimeoutMs: 50,
  });
  cleanups.push(async () => {
    for (const response of pending.values()) {
      response.finish();
    }
    await settleStreams();
    await client.close();
    await transport.closed;
  });
  await client.connect(transport);
  await settleStreams();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return {
    client, transport, posts, pending, effects, deletions, cancelledBodies,
    expireCallers: () => { phase = "expired"; },
    cancellations: () => posts.filter(({ request }) => request.method === "notifications/cancelled"),
    calls: () => posts.filter(({ request }) => request.method === "tools/call"),
  };
}

describe.each([
  { format: "json" as const, session: false },
  { format: "json" as const, session: true },
  { format: "sse" as const, session: false },
  { format: "sse" as const, session: true },
])("HTTP request lifecycle ($format, session=$session)", ({ format, session }) => {
  it("sends abort cancellation before the slow response completes", async () => {
    const fixture = await createFixture(format, session);
    const controller = new AbortController();
    const reason = new Error("User cancelled");
    const outcome = fixture.client.callTool({ name: "slow" }, { signal: controller.signal })
      .catch((error: unknown) => error);
    await settleStreams();
    expect(fixture.pending.has("slow")).toBe(true);
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    await settleStreams();
    expect(fixture.cancellations()).toHaveLength(1);
    expect(fixture.cancellations()[0]?.request.params).toEqual({ requestId: fixture.calls()[0]?.request.id });
    fixture.pending.get("slow")?.finish();
    await settleStreams();
    await vi.advanceTimersByTimeAsync(50);
    expect(fixture.cancellations()).toHaveLength(1);
    expect(fixture.client.state).toBe("ready");
    expect(fixture.posts.slice(1).every(({ headers }) =>
      headers.get("Mcp-Session-Id") === (session ? "fixture-session" : null))).toBe(true);
  });

  it("completes an independent tool before the slow request times out", async () => {
    const fixture = await createFixture(format, session);
    const slow = fixture.client.callTool({ name: "slow" }).catch((error: unknown) => error);
    await settleStreams();
    const record = fixture.client.callTool({ name: "record" }).catch((error: unknown) => error);
    await settleStreams();
    expect(fixture.effects).toEqual(["active"]);
    expect(await record).toEqual({ content: [{ type: "text", text: "record" }] });
    await vi.advanceTimersByTimeAsync(50);
    expect(await slow).toEqual(expect.objectContaining({ message: expect.stringContaining("timed out") }));
    fixture.expireCallers();
    fixture.pending.get("slow")?.finish();
    await settleStreams();
    expect(fixture.effects).toEqual(["active"]);
    expect(fixture.calls()).toHaveLength(2);
    expect(fixture.cancellations()).toHaveLength(1);
  });

  it("cancels multiple timed-out requests without waiting for either response", async () => {
    const fixture = await createFixture(format, session);
    const outcomes = ["first", "second"].map((name) =>
      fixture.client.callTool({ name }).catch((error: unknown) => error));
    await settleStreams();
    expect(fixture.calls()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(50);
    for (const outcome of outcomes) {
      expect(await outcome).toEqual(expect.objectContaining({ message: expect.stringContaining("timed out") }));
    }
    await settleStreams();
    expect(fixture.cancellations().map(({ request }) => request.params)).toEqual(
      fixture.calls().map(({ request }) => ({ requestId: request.id })),
    );
    fixture.pending.get("second")?.finish();
    fixture.pending.get("first")?.finish();
    await settleStreams();
    expect(fixture.client.state).toBe("ready");
    expect(fixture.cancellations()).toHaveLength(2);
    expect(fixture.calls()).toHaveLength(2);
  });

  it("matches responses that finish out of order to their callers", async () => {
    const fixture = await createFixture(format, session);
    const first = fixture.client.callTool({ name: "first" }).catch((error: unknown) => error);
    const second = fixture.client.callTool({ name: "second" }).catch((error: unknown) => error);
    await settleStreams();
    expect(fixture.calls()).toHaveLength(2);
    fixture.pending.get("second")?.finish();
    expect(await second).toEqual({ content: [{ type: "text", text: "second" }] });
    fixture.pending.get("first")?.finish();
    expect(await first).toEqual({ content: [{ type: "text", text: "first" }] });
    await vi.advanceTimersByTimeAsync(50);
    expect(fixture.cancellations()).toHaveLength(0);
  });
});

it("closes all concurrent fetches and ignores session headers arriving after close", async () => {
  const fixture = await createFixture("json", true);
  const outcomes = ["first", "second"].map((name) =>
    fixture.client.callTool({ name }).catch((error: unknown) => error));
  await settleStreams();
  expect(fixture.calls()).toHaveLength(2);
  await fixture.client.close();
  await fixture.transport.closed;
  expect(fixture.calls().every(({ signal }) => signal.aborted)).toBe(true);
  expect(fixture.deletions).toEqual(["fixture-session"]);
  fixture.pending.get("first")?.finish();
  fixture.pending.get("second")?.finish();
  await settleStreams();
  expect(fixture.cancelledBodies).toEqual(["first", "second"]);
  expect(fixture.deletions).toEqual(["fixture-session"]);
  expect(fixture.client.state).toBe("closed");
  for (const outcome of outcomes) {
    expect(await outcome).toBeInstanceOf(Error);
  }
});

it("waits for initialization headers before dispatching the next message", async () => {
  const initialized = deferred<Response>();
  const headers: Headers[] = [];
  const transport = new HttpTransport({
    url: "https://mcp.invalid/initialize",
    fetch: async (_input, init) => {
      if (init?.method !== "POST") {
        return new Response(null, { status: 405 });
      }
      headers.push(new Headers(init.headers));
      return headers.length === 1 ? initialized.promise : new Response(null, { status: 202 });
    },
  });
  cleanups.push(async () => {
    initialized.resolve(new Response(null, { status: 202 }));
    transport.dispose();
    await transport.closed;
  });
  transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  transport.writable.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  await settleStreams();
  expect(headers).toHaveLength(1);
  initialized.resolve(new Response(null, {
    status: 202,
    headers: { "Mcp-Session-Id": "initialized-session" },
  }));
  await settleStreams();
  expect(headers).toHaveLength(2);
  expect(headers[1]?.get("Mcp-Session-Id")).toBe("initialized-session");
});

it("does not dispatch a prepared request after disposal", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 202 }));
  const transport = new HttpTransport({
    url: "https://mcp.invalid/closed",
    headers: {
      get "X-Fixture"() {
        transport.dispose();
        return "closed";
      },
    },
    fetch,
  });
  transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  await transport.closed;
  await settleStreams();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["json", "sse"] as const)("owns concurrent %s response failures and closes siblings", async (format) => {
  const fixture = await createFixture(format, false);
  const outcomes = ["first", "second"].map((name) =>
    fixture.client.callTool({ name }).catch((error: unknown) => error));
  await settleStreams();
  expect(fixture.calls()).toHaveLength(2);
  const reason = new Error("Response failed");
  fixture.pending.get("second")?.fail(reason);
  await expect(fixture.transport.closed).resolves.toEqual({ reason });
  for (const outcome of outcomes) {
    expect(await outcome).toBeInstanceOf(Error);
  }
  expect(fixture.client.state).toBe("closed");
  if (format === "json") {
    expect(fixture.calls()[0]?.signal.aborted).toBe(true);
  }
});
