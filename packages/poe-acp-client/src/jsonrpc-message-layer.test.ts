import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "bun:test";
import {
  JsonRpcMessageLayer,
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
  type JsonRpcResponseMessage,
} from "./jsonrpc-message-layer.js";
import { AcpError } from "./types.js";

interface Harness {
  input: PassThrough;
  output: PassThrough;
  written: string[];
  layer: JsonRpcMessageLayer;
}

const cleanup: Array<() => void> = [];

afterEach(() => {
  vi.useRealTimers();
  while (cleanup.length > 0) {
    const fn = cleanup.pop();
    fn?.();
  }
});

function createHarness(options?: ConstructorParameters<typeof JsonRpcMessageLayer>[0]): Harness {
  const input = new PassThrough();
  const output = new PassThrough();
  const written: string[] = [];

  output.setEncoding("utf8");
  output.on("data", (chunk) => {
    written.push(String(chunk));
  });

  const layer = new JsonRpcMessageLayer({
    input,
    output,
    ...options,
  });

  cleanup.push(() => {
    layer.dispose();
    input.destroy();
    output.destroy();
  });

  return { input, output, written, layer };
}

function parseWrittenMessages(written: string[]): unknown[] {
  const combined = written.join("");
  if (combined.length === 0) {
    return [];
  }

  return combined
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

async function waitForWriteCount(written: string[], count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(parseWrittenMessages(written)).toHaveLength(count);
  });
}

describe("parseJsonRpcMessage", () => {
  it("distinguishes request, notification, and response messages", () => {
    const request = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":1,"method":"tools/run","params":{"name":"fmt"}}'
    );
    const notification = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","method":"session/update","params":{"ok":true}}'
    );
    const response = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":"req-1","result":{"done":true}}'
    );

    expect(request).toEqual({
      type: "request",
      message: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/run",
        params: { name: "fmt" },
      },
    });

    expect(notification).toEqual({
      type: "notification",
      message: {
        jsonrpc: "2.0",
        method: "session/update",
        params: { ok: true },
      },
    });

    expect(response).toEqual({
      type: "response",
      message: {
        jsonrpc: "2.0",
        id: "req-1",
        result: { done: true },
      },
    });
  });

  it("supports all RequestId variants", () => {
    const numberId = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":9,"method":"ping"}'
    );
    const stringId = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":"abc","method":"ping"}'
    );
    const nullId = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":null,"method":"ping"}'
    );

    expect(numberId).toMatchObject({ type: "request", message: { id: 9 } });
    expect(stringId).toMatchObject({ type: "request", message: { id: "abc" } });
    expect(nullId).toMatchObject({ type: "request", message: { id: null } });
  });

  it("returns parse error metadata for malformed JSON", () => {
    const parsed = parseJsonRpcMessage("{broken");

    expect(parsed).toMatchObject({
      type: "invalid",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
      },
    });
    expect(parsed.type).toBe("invalid");
    if (parsed.type === "invalid") {
      expect(parsed.error).toBeInstanceOf(AcpError);
    }
  });
});

describe("serializeJsonRpcMessage", () => {
  it("serializes outgoing messages with newline delimiter", () => {
    const line = serializeJsonRpcMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "s-1" },
    });

    expect(line).toBe('{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s-1"}}\n');
    expect(line.endsWith("\n")).toBe(true);
  });
});

describe("JsonRpcMessageLayer", () => {
  it("parses newline-delimited input and dispatches request and notification handlers", async () => {
    const { input, written, layer } = createHarness();

    const requestHandler = vi.fn((params: unknown) => params);
    const notificationHandler = vi.fn();

    layer.onRequest("echo", requestHandler);
    layer.onNotification("note", notificationHandler);

    input.write('{"jsonrpc":"2.0","id":1,"method":"echo","params":{"text":"hel');
    input.write('lo"}}\n{"jsonrpc":"2.0","method":"note","params":{"ok":true}}\n');

    await vi.waitFor(() => {
      expect(requestHandler).toHaveBeenCalledTimes(1);
      expect(notificationHandler).toHaveBeenCalledTimes(1);
    });

    await waitForWriteCount(written, 1);
    const [response] = parseWrittenMessages(written) as JsonRpcResponseMessage[];

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { text: "hello" },
    });
  });

  it("correlates responses to pending requests for numeric, string, and null ids", async () => {
    const { input, written, layer } = createHarness();

    const numericPromise = layer.sendRequest("numeric", { value: 1 });
    const stringPromise = layer.sendRequest("string", { value: 2 }, { id: "req-2" });
    const nullPromise = layer.sendRequest("null", { value: 3 }, { id: null });

    await waitForWriteCount(written, 3);
    const outbound = parseWrittenMessages(written) as Array<{
      jsonrpc: "2.0";
      method: string;
      id: string | number | null;
    }>;

    expect(outbound[0].id).toBe(1);
    expect(outbound[1].id).toBe("req-2");
    expect(outbound[2].id).toBeNull();

    input.write('{"jsonrpc":"2.0","id":1,"result":"n"}\n');
    input.write('{"jsonrpc":"2.0","id":"req-2","result":"s"}\n');
    input.write('{"jsonrpc":"2.0","id":null,"result":"z"}\n');

    await expect(numericPromise).resolves.toBe("n");
    await expect(stringPromise).resolves.toBe("s");
    await expect(nullPromise).resolves.toBe("z");
  });

  it("rejects pending requests when response returns JSON-RPC error", async () => {
    const { input, written, layer } = createHarness();

    const pending = layer.sendRequest("auth/check", { token: "x" });

    await waitForWriteCount(written, 1);
    input.write(
      '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"Auth required","data":{"methodId":"api-key"}}}\n'
    );

    await expect(pending).rejects.toMatchObject({
      message: "Auth required",
      code: -32000,
      data: { methodId: "api-key" },
    });
  });

  it("rejects pending requests on timeout", async () => {
    vi.useFakeTimers();

    const { layer } = createHarness({ requestTimeoutMs: 25 });
    const pending = layer.sendRequest("slow/method");

    vi.advanceTimersByTime(25);
    await Promise.resolve();

    await expect(pending).rejects.toThrow(
      'JSON-RPC request "slow/method" timed out after 25ms'
    );
    expect(layer.pendingRequestCount()).toBe(0);
  });

  it("returns method_not_found for unregistered request methods", async () => {
    const { input, written } = createHarness();

    input.write('{"jsonrpc":"2.0","id":"missing","method":"nope"}\n');

    await waitForWriteCount(written, 1);
    const [response] = parseWrittenMessages(written) as JsonRpcResponseMessage[];

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "missing",
      error: {
        code: -32601,
        message: 'Method not found: "nope"',
      },
    });
  });

  it("returns structured AcpError responses from failing request handlers", async () => {
    const { input, written, layer } = createHarness();

    layer.onRequest("fs/read", () => {
      throw {
        code: -32602,
        message: "Invalid params",
        data: { field: "path" },
      };
    });

    input.write('{"jsonrpc":"2.0","id":7,"method":"fs/read","params":{}}\n');

    await waitForWriteCount(written, 1);
    const [response] = parseWrittenMessages(written) as JsonRpcResponseMessage[];

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: {
        code: -32602,
        message: "Invalid params",
        data: { field: "path" },
      },
    });
  });

  it("returns parse_error response for malformed input lines", async () => {
    const { input, written } = createHarness();

    input.write("{bad-json}\n");

    await waitForWriteCount(written, 1);
    const [response] = parseWrittenMessages(written) as JsonRpcResponseMessage[];

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
      },
    });
  });

  it("returns invalid_request response for structurally invalid JSON-RPC payload", async () => {
    const { input, written } = createHarness();

    input.write('{"jsonrpc":"2.0","id":"x","method":123}\n');

    await waitForWriteCount(written, 1);
    const [response] = parseWrittenMessages(written) as JsonRpcResponseMessage[];

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "x",
      error: {
        code: -32600,
        message: "Invalid Request",
      },
    });
  });
});
