import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JsonRpcMessageLayer,
  createJsonRpcErrorResponse,
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
  type JsonRpcResponseMessage,
} from "./jsonrpc-message-layer.js";
import {
  ACP_ERROR_CODE_AUTH_REQUIRED,
  ACP_ERROR_CODE_INTERNAL,
  ACP_ERROR_CODE_INVALID_PARAMS,
  ACP_ERROR_CODE_INVALID_REQUEST,
  ACP_ERROR_CODE_METHOD_NOT_FOUND,
  ACP_ERROR_CODE_PARSE,
  ACP_ERROR_CODE_RESOURCE_NOT_FOUND,
  AcpError,
  isAcpError,
} from "./types.js";

// ---------------------------------------------------------------------------
// Shared harness (unified from acp-error.test.ts and jsonrpc-message-layer.test.ts)
// The more flexible version with optional options is used.
// ---------------------------------------------------------------------------

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
    requestTimeoutMs: 1_000,
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

// ---------------------------------------------------------------------------
// acp-error.test.ts — AcpError class and JSON-RPC AcpError handling
// ---------------------------------------------------------------------------

describe("AcpError", () => {
  it("defines all standard ACP error code constants", () => {
    expect(ACP_ERROR_CODE_PARSE).toBe(-32700);
    expect(ACP_ERROR_CODE_INVALID_REQUEST).toBe(-32600);
    expect(ACP_ERROR_CODE_METHOD_NOT_FOUND).toBe(-32601);
    expect(ACP_ERROR_CODE_INVALID_PARAMS).toBe(-32602);
    expect(ACP_ERROR_CODE_INTERNAL).toBe(-32603);
    expect(ACP_ERROR_CODE_AUTH_REQUIRED).toBe(-32000);
    expect(ACP_ERROR_CODE_RESOURCE_NOT_FOUND).toBe(-32002);
  });

  it("extends Error and carries code/message/data", () => {
    const error = new AcpError(ACP_ERROR_CODE_INVALID_PARAMS, "Invalid params", {
      field: "path",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AcpError);
    expect(error.name).toBe("AcpError");
    expect(error.code).toBe(ACP_ERROR_CODE_INVALID_PARAMS);
    expect(error.message).toBe("Invalid params");
    expect(error.data).toEqual({ field: "path" });
  });

  it("provides an isAcpError guard for class instances and plain error-like objects", () => {
    const instance = new AcpError(ACP_ERROR_CODE_AUTH_REQUIRED, "Auth required");

    expect(isAcpError(instance)).toBe(true);
    expect(
      isAcpError({
        code: -32000,
        message: "Auth required",
        data: { methodId: "api-key" },
      })
    ).toBe(true);
    expect(isAcpError({ code: 4_000_000_000, message: "bad" })).toBe(false);
    expect(isAcpError({ code: -32000 })).toBe(false);
    expect(isAcpError("nope")).toBe(false);
  });
});

describe("JSON-RPC AcpError handling", () => {
  it.each([
    ACP_ERROR_CODE_PARSE,
    ACP_ERROR_CODE_INVALID_REQUEST,
    ACP_ERROR_CODE_METHOD_NOT_FOUND,
    ACP_ERROR_CODE_INVALID_PARAMS,
    ACP_ERROR_CODE_INTERNAL,
    ACP_ERROR_CODE_AUTH_REQUIRED,
    ACP_ERROR_CODE_RESOURCE_NOT_FOUND,
  ] as const)(
    "wraps thrown AcpError (%d) into JSON-RPC error responses",
    async (code) => {
      const { input, written, layer } = createHarness();

      layer.onRequest("failing/method", () => {
        throw new AcpError(code, `error ${code}`, { marker: code });
      });

      input.write('{"jsonrpc":"2.0","id":1,"method":"failing/method","params":{}}\n');

      await waitForWriteCount(written, 1);
      const [response] = parseWrittenMessages(written) as Array<{
        error: { code: number; message: string; data: { marker: number } };
      }>;

      expect(response.error).toEqual({
        code,
        message: `error ${code}`,
        data: { marker: code },
      });
    }
  );

  it("parses incoming JSON-RPC errors into AcpError instances", async () => {
    const { input, written, layer } = createHarness();

    const pending = layer.sendRequest("auth/check", { token: "x" });

    await waitForWriteCount(written, 1);
    const [outbound] = parseWrittenMessages(written) as Array<{ id: number | string | null }>;
    input.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: outbound.id,
        error: {
          code: ACP_ERROR_CODE_AUTH_REQUIRED,
          message: "Auth required",
          data: { methodId: "api-key" },
        },
      }) + "\n"
    );

    const error = await pending.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AcpError);
    expect(error).toMatchObject({
      code: ACP_ERROR_CODE_AUTH_REQUIRED,
      message: "Auth required",
      data: { methodId: "api-key" },
    });
  });

  it("supports custom int32 error codes for serialization and deserialization", async () => {
    const customCode = 10_001;
    const serialized = createJsonRpcErrorResponse(
      "custom",
      new AcpError(customCode, "Custom failure", { retryable: false })
    );

    expect(serialized).toEqual({
      jsonrpc: "2.0",
      id: "custom",
      error: {
        code: customCode,
        message: "Custom failure",
        data: { retryable: false },
      },
    });

    const { input, written, layer } = createHarness();
    const pending = layer.sendRequest("custom/method");

    await waitForWriteCount(written, 1);
    const [outbound] = parseWrittenMessages(written) as Array<{ id: number | string | null }>;

    input.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: outbound.id,
        error: {
          code: customCode,
          message: "Custom failure",
          data: { retryable: false },
        },
      }) + "\n"
    );

    const error = await pending.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AcpError);
    expect(error).toMatchObject({
      code: customCode,
      message: "Custom failure",
      data: { retryable: false },
    });
  });
});

// ---------------------------------------------------------------------------
// jsonrpc-message-layer.test.ts — parseJsonRpcMessage, serializeJsonRpcMessage, JsonRpcMessageLayer
// ---------------------------------------------------------------------------

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
    const pending = expect(layer.sendRequest("slow/method")).rejects.toThrow(
      'JSON-RPC request "slow/method" timed out after 25ms'
    );

    await vi.advanceTimersByTimeAsync(25);

    await pending;
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
