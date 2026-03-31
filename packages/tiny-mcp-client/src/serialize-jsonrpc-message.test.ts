import { describe, expect, it } from "bun:test";
import {
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
  type JsonRpcRequest,
} from "./internal.js";

describe("serializeJsonRpcMessage", () => {
  it("serializes JSON-RPC message to newline-delimited JSON", () => {
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { cursor: "next" },
    };

    const serialized = serializeJsonRpcMessage(message);

    expect(serialized).toBe(`${JSON.stringify(message)}\n`);
    expect(serialized.endsWith("\n")).toBe(true);
  });

  it("round-trips through parseJsonRpcMessage", () => {
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: "request-1",
      method: "tools/call",
      params: {
        name: "echo",
        arguments: { text: "hello" },
      },
    };

    const parsed = parseJsonRpcMessage(serializeJsonRpcMessage(message));

    expect(parsed).toEqual({
      type: "request",
      message,
    });
  });
});
