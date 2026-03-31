import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "bun:test";
import {
  JsonRpcMessageLayer,
  createJsonRpcErrorResponse,
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

interface Harness {
  input: PassThrough;
  output: PassThrough;
  written: string[];
  layer: JsonRpcMessageLayer;
}

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length > 0) {
    cleanup.pop()?.();
  }
});

function createHarness(): Harness {
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
