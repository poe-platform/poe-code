import { describe, expect, it } from "bun:test";
import { ERROR_INVALID_REQUEST, ERROR_PARSE, parseJsonRpcMessage } from "./internal.js";

describe("parseJsonRpcMessage", () => {
  it("parses a request with numeric id", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');

    expect(parsed).toEqual({
      type: "request",
      message: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      },
    });
  });

  it("parses a request with string id", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":"request-1","method":"tools/list"}'
    );

    expect(parsed).toEqual({
      type: "request",
      message: {
        jsonrpc: "2.0",
        id: "request-1",
        method: "tools/list",
      },
    });
  });

  it("parses a request with params", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"text":"hello"}}}'
    );

    expect(parsed).toEqual({
      type: "request",
      message: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "echo",
          arguments: {
            text: "hello",
          },
        },
      },
    });
  });

  it("parses a request without params", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":"request-2","method":"tools/list"}'
    );

    expect(parsed).toEqual({
      type: "request",
      message: {
        jsonrpc: "2.0",
        id: "request-2",
        method: "tools/list",
      },
    });
  });

  it("parses a notification with params", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"token-1","progress":0.5}}'
    );

    expect(parsed).toEqual({
      type: "notification",
      message: {
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: {
          progressToken: "token-1",
          progress: 0.5,
        },
      },
    });
  });

  it("parses a notification without params", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    );

    expect(parsed).toEqual({
      type: "notification",
      message: {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
    });
  });

  it("parses a success response", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"2.0","id":"req-1","result":{}}');

    expect(parsed).toEqual({
      type: "response",
      message: {
        jsonrpc: "2.0",
        id: "req-1",
        result: {},
      },
    });
  });

  it("parses an error response with data", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":"req-2","error":{"code":-32601,"message":"Method not found","data":{"method":"tools/missing"}}}'
    );

    expect(parsed).toEqual({
      type: "response",
      message: {
        jsonrpc: "2.0",
        id: "req-2",
        error: {
          code: -32601,
          message: "Method not found",
          data: {
            method: "tools/missing",
          },
        },
      },
    });
  });

  it("parses an error response without data", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":"req-3","error":{"code":-32000,"message":"Boom"}}'
    );

    expect(parsed).toEqual({
      type: "response",
      message: {
        jsonrpc: "2.0",
        id: "req-3",
        error: {
          code: -32000,
          message: "Boom",
        },
      },
    });
  });

  it("returns parse error for malformed JSON", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1');

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_PARSE);
    expect(parsed.id).toBeNull();
  });

  it("returns invalid request for array payload", () => {
    const parsed = parseJsonRpcMessage("[]");

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBeNull();
  });

  it("returns invalid request for string payload", () => {
    const parsed = parseJsonRpcMessage('"not-an-object"');

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBeNull();
  });

  it("returns invalid request when jsonrpc field is missing", () => {
    const parsed = parseJsonRpcMessage('{"id":1,"method":"tools/list"}');

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBe(1);
  });

  it("returns invalid request when jsonrpc field has wrong value", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"1.0","id":1,"method":"tools/list"}');

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBe(1);
  });

  it("returns invalid request when method is not a string", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"method":123}');

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBe(1);
  });

  it("returns invalid request for response containing both result and error", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":1,"result":{},"error":{"code":-32601,"message":"Method not found"}}'
    );

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBe(1);
  });

  it("returns invalid request for response containing neither result nor error", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1}');

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBe(1);
  });

  it("returns invalid with error code and id metadata", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"2.0","id":"bad"}');

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBe("bad");
  });
});
