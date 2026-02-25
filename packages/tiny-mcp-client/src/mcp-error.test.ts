import { describe, expect, it } from "vitest";
import {
  ERROR_INTERNAL,
  ERROR_INVALID_PARAMS,
  ERROR_INVALID_REQUEST,
  ERROR_METHOD_NOT_FOUND,
  ERROR_PARSE,
  McpError,
} from "./internal.js";

describe("McpError", () => {
  it("defines standard JSON-RPC error code constants", () => {
    expect(ERROR_PARSE).toBe(-32700);
    expect(ERROR_INVALID_REQUEST).toBe(-32600);
    expect(ERROR_METHOD_NOT_FOUND).toBe(-32601);
    expect(ERROR_INVALID_PARAMS).toBe(-32602);
    expect(ERROR_INTERNAL).toBe(-32603);
  });

  it("constructs with code, message, and data", () => {
    const data = { field: "path" };
    const error = new McpError(-32602, "Invalid params", data);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(McpError);
    expect(error.name).toBe("McpError");
    expect(error.code).toBe(-32602);
    expect(error.message).toBe("Invalid params");
    expect(error.data).toBe(data);
    expect(Object.prototype.hasOwnProperty.call(error, "data")).toBe(true);
  });

  it("does not define data when omitted", () => {
    const error = new McpError(-32600, "Invalid request");

    expect(error.data).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(error, "data")).toBe(false);
  });

  it("passes instanceof checks", () => {
    const error: Error = new McpError(-32603, "Internal error");

    expect(error instanceof Error).toBe(true);
    expect(error instanceof McpError).toBe(true);
  });
});
