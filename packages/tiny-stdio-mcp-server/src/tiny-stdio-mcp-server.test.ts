import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { Readable, Writable } from "stream";
import * as api from "./index.js";
import type { HandleResult } from "./index.js";
import {
  parseMessage,
  formatSuccessResponse,
  formatErrorResponse,
} from "./jsonrpc.js";
import { ToolError } from "./index.js";
import { JSON_RPC_ERROR_CODES } from "./types.js";
import type { JSONRPCMessage, JSONRPCNotification, SDKTransport } from "./types.js";
import { defineSchema } from "./schema.js";
import { createServer } from "./server.js";
import { createTestPair, type TestPair } from "./testing.js";
import { Image } from "./content/image.js";
import { Audio } from "./content/audio.js";
import { File } from "./content/file.js";

// ---------------------------------------------------------------------------
// index.test.ts
// ---------------------------------------------------------------------------

describe("tiny-stdio-mcp-server public entry point", () => {
  it("exports HandleResult as part of the package type surface", () => {
    expectTypeOf<HandleResult>().toEqualTypeOf<{
      result?: unknown;
      error?: { code: number; message: string };
    }>();
  });

  it("keeps HandleResult out of the runtime namespace", () => {
    expect(api).not.toHaveProperty("HandleResult");
  });

  it("does not permit mutation of exported error codes", () => {
    const errorCodes = JSON_RPC_ERROR_CODES as unknown as { INVALID_REQUEST: number };
    const originalCode = errorCodes.INVALID_REQUEST;

    try {
      expect(() => {
        errorCodes.INVALID_REQUEST = 7;
      }).toThrow();
      expect(JSON_RPC_ERROR_CODES.INVALID_REQUEST).toBe(-32600);
    } finally {
      if (errorCodes.INVALID_REQUEST !== originalCode) {
        errorCodes.INVALID_REQUEST = originalCode;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// jsonrpc.test.ts
// ---------------------------------------------------------------------------

describe("parseMessage", () => {
  describe("valid requests", () => {
    it("parses valid JSON-RPC request with numeric id", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":1,"method":"ping"}');

      expect(result.success).toBe(true);
      if (result.success && !result.isNotification) {
        expect(result.request.jsonrpc).toBe("2.0");
        expect(result.request.id).toBe(1);
        expect(result.request.method).toBe("ping");
      }
    });

    it("parses valid JSON-RPC request with string id", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":"abc-123","method":"test"}'
      );

      expect(result.success).toBe(true);
      if (result.success && !result.isNotification) {
        expect(result.request.id).toBe("abc-123");
      }
    });

    it("parses request with params object", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":1,"method":"test","params":{"key":"value","num":42}}'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.params).toEqual({ key: "value", num: 42 });
      }
    });

    it("parses request with empty params", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":1,"method":"test","params":{}}'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.params).toEqual({});
      }
    });

    it("parses request without params", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":1,"method":"test"}');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.params).toBeUndefined();
      }
    });

    it("parses request with zero id", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":0,"method":"test"}');

      expect(result.success).toBe(true);
      if (result.success && !result.isNotification) {
        expect(result.request.id).toBe(0);
      }
    });

    it("parses request with negative id", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":-1,"method":"test"}');

      expect(result.success).toBe(true);
      if (result.success && !result.isNotification) {
        expect(result.request.id).toBe(-1);
      }
    });

    it("parses request with large id", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":9007199254740991,"method":"test"}'
      );

      expect(result.success).toBe(true);
      if (result.success && !result.isNotification) {
        expect(result.request.id).toBe(9007199254740991);
      }
    });

    it("parses request with empty string id", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":"","method":"test"}');

      expect(result.success).toBe(true);
      if (result.success && !result.isNotification) {
        expect(result.request.id).toBe("");
      }
    });

    it("parses a request with an explicit null id", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":null,"method":"ping"}');

      expect(result.success).toBe(true);
      if (result.success && !result.isNotification) {
        expect(result.request.id).toBeNull();
      }
    });

    it("parses request with nested params", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":1,"method":"test","params":{"nested":{"deep":{"value":true}}}}'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.params).toEqual({
          nested: { deep: { value: true } },
        });
      }
    });

    it("parses request with array in params", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":1,"method":"test","params":{"items":[1,2,3]}}'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.params).toEqual({ items: [1, 2, 3] });
      }
    });
  });

  describe("method names", () => {
    it("parses simple method name", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":1,"method":"ping"}');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.method).toBe("ping");
      }
    });

    it("parses namespaced method name", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.method).toBe("tools/list");
      }
    });

    it("parses deeply namespaced method", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":1,"method":"a/b/c/d"}'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.method).toBe("a/b/c/d");
      }
    });

    it("parses method with dots", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":1,"method":"rpc.discover"}'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.method).toBe("rpc.discover");
      }
    });

    it("parses method with underscores", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":1,"method":"get_user_data"}'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.method).toBe("get_user_data");
      }
    });

    it("parses method with hyphens", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":1,"method":"get-user-data"}'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.method).toBe("get-user-data");
      }
    });
  });

  describe("parse errors", () => {
    it("returns parse error for completely invalid JSON", () => {
      const result = parseMessage("{invalid}");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.PARSE_ERROR);
        expect(result.error.message).toBe("Parse error");
        expect(result.id).toBeNull();
      }
    });

    it("returns parse error for truncated JSON", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.PARSE_ERROR);
      }
    });

    it("returns parse error for empty string", () => {
      const result = parseMessage("");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.PARSE_ERROR);
      }
    });

    it("returns parse error for whitespace only", () => {
      const result = parseMessage("   ");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.PARSE_ERROR);
      }
    });

    it("returns parse error for trailing comma", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":1,}');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.PARSE_ERROR);
      }
    });

    it("returns parse error for single quotes", () => {
      const result = parseMessage("{'jsonrpc':'2.0','id':1,'method':'test'}");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.PARSE_ERROR);
      }
    });

    it("returns parse error for unquoted keys", () => {
      const result = parseMessage('{jsonrpc:"2.0",id:1,method:"test"}');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.PARSE_ERROR);
      }
    });
  });

  describe("invalid request errors", () => {
    it("returns invalid request for primitive params", () => {
      expect(parseMessage('{"jsonrpc":"2.0","id":1,"method":"test","params":"bad"}')).toEqual({
        success: false,
        error: { code: JSON_RPC_ERROR_CODES.INVALID_REQUEST, message: "Invalid Request" },
        id: 1,
      });
    });

    it("returns invalid request for non-finite numeric ids", () => {
      expect(parseMessage('{"jsonrpc":"2.0","id":1e999,"method":"test"}')).toEqual({
        success: false,
        error: { code: JSON_RPC_ERROR_CODES.INVALID_REQUEST, message: "Invalid Request" },
        id: null,
      });
    });

    it("returns invalid request for missing jsonrpc field", () => {
      const result = parseMessage('{"id":1,"method":"test"}');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
        expect(result.error.message).toBe("Invalid Request");
        expect(result.id).toBe(1);
      }
    });

    it("returns invalid request for wrong jsonrpc version 1.0", () => {
      const result = parseMessage('{"jsonrpc":"1.0","id":1,"method":"test"}');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it("returns invalid request for wrong jsonrpc version 2.1", () => {
      const result = parseMessage('{"jsonrpc":"2.1","id":1,"method":"test"}');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it("returns invalid request for numeric jsonrpc", () => {
      const result = parseMessage('{"jsonrpc":2.0,"id":1,"method":"test"}');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it("returns invalid request for missing method", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":1}');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it("returns invalid request for numeric method", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":1,"method":123}');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it("returns invalid request for null method", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":1,"method":null}');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it("returns invalid request for array input", () => {
      const result = parseMessage("[]");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it("returns invalid request for batch array", () => {
      const result = parseMessage(
        '[{"jsonrpc":"2.0","id":1,"method":"test"}]'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it("returns invalid request for null input", () => {
      const result = parseMessage("null");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it("returns invalid request for string input", () => {
      const result = parseMessage('"hello"');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it("returns invalid request for number input", () => {
      const result = parseMessage("42");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it("returns invalid request for boolean input", () => {
      const result = parseMessage("true");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it("preserves id in error when available", () => {
      const result = parseMessage('{"id":123,"method":"test"}');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.id).toBe(123);
      }
    });

    it("preserves string id in error when available", () => {
      const result = parseMessage('{"id":"my-id","method":"test"}');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.id).toBe("my-id");
      }
    });

    it("returns null id when id is invalid type", () => {
      const result = parseMessage('{"id":true,"method":"test"}');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.id).toBeNull();
      }
    });
  });

  describe("edge cases", () => {
    it("handles extra fields in request", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":1,"method":"test","extra":"field","another":123}'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.method).toBe("test");
      }
    });

    it("handles unicode in method name", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":1,"method":"测试方法"}'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.method).toBe("测试方法");
      }
    });

    it("handles unicode in params", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":1,"method":"test","params":{"name":"日本語"}}'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.params).toEqual({ name: "日本語" });
      }
    });

    it("handles escaped characters in strings", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":1,"method":"test","params":{"text":"line1\\nline2\\ttab"}}'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.params).toEqual({ text: "line1\nline2\ttab" });
      }
    });

    it("handles very long method name", () => {
      const longMethod = "a".repeat(1000);
      const result = parseMessage(
        `{"jsonrpc":"2.0","id":1,"method":"${longMethod}"}`
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.method).toBe(longMethod);
      }
    });

    it("handles deeply nested params", () => {
      const deep = { a: { b: { c: { d: { e: { f: "deep" } } } } } };
      const result = parseMessage(
        `{"jsonrpc":"2.0","id":1,"method":"test","params":${JSON.stringify(deep)}}`
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.params).toEqual(deep);
      }
    });
  });
});

describe("formatSuccessResponse", () => {
  describe("basic formatting", () => {
    it("formats success response with object result", () => {
      const response = formatSuccessResponse(1, { data: "test" });
      const parsed = JSON.parse(response);

      expect(parsed).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: { data: "test" },
      });
    });

    it("formats response with null result", () => {
      const response = formatSuccessResponse(1, null);
      const parsed = JSON.parse(response);

      expect(parsed.result).toBeNull();
    });

    it("formats response with empty object result", () => {
      const response = formatSuccessResponse(1, {});
      const parsed = JSON.parse(response);

      expect(parsed.result).toEqual({});
    });

    it("formats response with array result", () => {
      const response = formatSuccessResponse(1, [1, 2, 3]);
      const parsed = JSON.parse(response);

      expect(parsed.result).toEqual([1, 2, 3]);
    });

    it("formats response with string result", () => {
      const response = formatSuccessResponse(1, "success");
      const parsed = JSON.parse(response);

      expect(parsed.result).toBe("success");
    });

    it("formats response with number result", () => {
      const response = formatSuccessResponse(1, 42);
      const parsed = JSON.parse(response);

      expect(parsed.result).toBe(42);
    });

    it("formats response with boolean result", () => {
      const response = formatSuccessResponse(1, true);
      const parsed = JSON.parse(response);

      expect(parsed.result).toBe(true);
    });
  });

  describe("id handling", () => {
    it("formats response with null id", () => {
      const response = formatSuccessResponse(null, {});
      const parsed = JSON.parse(response);

      expect(parsed.id).toBeNull();
    });

    it("formats response with string id", () => {
      const response = formatSuccessResponse("abc", {});
      const parsed = JSON.parse(response);

      expect(parsed.id).toBe("abc");
    });

    it("formats response with zero id", () => {
      const response = formatSuccessResponse(0, {});
      const parsed = JSON.parse(response);

      expect(parsed.id).toBe(0);
    });

    it("formats response with negative id", () => {
      const response = formatSuccessResponse(-1, {});
      const parsed = JSON.parse(response);

      expect(parsed.id).toBe(-1);
    });

    it("formats response with empty string id", () => {
      const response = formatSuccessResponse("", {});
      const parsed = JSON.parse(response);

      expect(parsed.id).toBe("");
    });
  });

  describe("complex results", () => {
    it("formats response with nested result", () => {
      const response = formatSuccessResponse(1, {
        tools: [{ name: "test", description: "desc" }],
      });
      const parsed = JSON.parse(response);

      expect(parsed.result.tools[0].name).toBe("test");
    });

    it("formats response with special characters", () => {
      const response = formatSuccessResponse(1, {
        text: 'Contains "quotes" and\nnewlines',
      });
      const parsed = JSON.parse(response);

      expect(parsed.result.text).toBe('Contains "quotes" and\nnewlines');
    });

    it("formats response with unicode", () => {
      const response = formatSuccessResponse(1, { message: "こんにちは" });
      const parsed = JSON.parse(response);

      expect(parsed.result.message).toBe("こんにちは");
    });
  });

  describe("JSON validity", () => {
    it("produces valid JSON string", () => {
      const response = formatSuccessResponse(1, { data: "test" });
      expect(() => JSON.parse(response)).not.toThrow();
    });

    it("always includes jsonrpc 2.0", () => {
      const response = formatSuccessResponse(1, {});
      const parsed = JSON.parse(response);
      expect(parsed.jsonrpc).toBe("2.0");
    });

    it("never includes error field in success response", () => {
      const response = formatSuccessResponse(1, {});
      const parsed = JSON.parse(response);
      expect("error" in parsed).toBe(false);
    });
  });
});

describe("formatErrorResponse", () => {
  describe("standard error codes", () => {
    it("formats parse error", () => {
      const response = formatErrorResponse(null, {
        code: JSON_RPC_ERROR_CODES.PARSE_ERROR,
        message: "Parse error",
      });
      const parsed = JSON.parse(response);

      expect(parsed.error.code).toBe(-32700);
      expect(parsed.error.message).toBe("Parse error");
    });

    it("formats invalid request error", () => {
      const response = formatErrorResponse(1, {
        code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        message: "Invalid Request",
      });
      const parsed = JSON.parse(response);

      expect(parsed.error.code).toBe(-32600);
    });

    it("formats method not found error", () => {
      const response = formatErrorResponse(1, {
        code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
        message: "Method not found",
      });
      const parsed = JSON.parse(response);

      expect(parsed.error.code).toBe(-32601);
    });

    it("formats invalid params error", () => {
      const response = formatErrorResponse(1, {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        message: "Invalid params",
      });
      const parsed = JSON.parse(response);

      expect(parsed.error.code).toBe(-32602);
    });

    it("formats internal error", () => {
      const response = formatErrorResponse(1, {
        code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        message: "Internal error",
      });
      const parsed = JSON.parse(response);

      expect(parsed.error.code).toBe(-32603);
    });
  });

  describe("error data", () => {
    it("formats error with string data", () => {
      const response = formatErrorResponse(1, {
        code: -32000,
        message: "Server error",
        data: "Additional info",
      });
      const parsed = JSON.parse(response);

      expect(parsed.error.data).toBe("Additional info");
    });

    it("formats error with object data", () => {
      const response = formatErrorResponse(1, {
        code: -32000,
        message: "Server error",
        data: { details: "something went wrong", code: "ERR_001" },
      });
      const parsed = JSON.parse(response);

      expect(parsed.error.data).toEqual({
        details: "something went wrong",
        code: "ERR_001",
      });
    });

    it("formats error without data", () => {
      const response = formatErrorResponse(1, {
        code: -32000,
        message: "Server error",
      });
      const parsed = JSON.parse(response);

      expect("data" in parsed.error).toBe(false);
    });

    it("formats error with array data", () => {
      const response = formatErrorResponse(1, {
        code: -32000,
        message: "Server error",
        data: ["error1", "error2"],
      });
      const parsed = JSON.parse(response);

      expect(parsed.error.data).toEqual(["error1", "error2"]);
    });
  });

  describe("id handling", () => {
    it("formats error with null id for parse errors", () => {
      const response = formatErrorResponse(null, {
        code: JSON_RPC_ERROR_CODES.PARSE_ERROR,
        message: "Parse error",
      });
      const parsed = JSON.parse(response);

      expect(parsed.id).toBeNull();
    });

    it("preserves original id in error response", () => {
      const response = formatErrorResponse(42, {
        code: -32600,
        message: "Invalid Request",
      });
      const parsed = JSON.parse(response);

      expect(parsed.id).toBe(42);
    });

    it("preserves string id in error response", () => {
      const response = formatErrorResponse("request-123", {
        code: -32600,
        message: "Invalid Request",
      });
      const parsed = JSON.parse(response);

      expect(parsed.id).toBe("request-123");
    });
  });

  describe("JSON validity", () => {
    it("produces valid JSON string", () => {
      const response = formatErrorResponse(1, {
        code: -32000,
        message: "Error",
      });
      expect(() => JSON.parse(response)).not.toThrow();
    });

    it("always includes jsonrpc 2.0", () => {
      const response = formatErrorResponse(1, {
        code: -32000,
        message: "Error",
      });
      const parsed = JSON.parse(response);
      expect(parsed.jsonrpc).toBe("2.0");
    });

    it("never includes result field in error response", () => {
      const response = formatErrorResponse(1, {
        code: -32000,
        message: "Error",
      });
      const parsed = JSON.parse(response);
      expect("result" in parsed).toBe(false);
    });
  });

  describe("custom error codes", () => {
    it("allows application-defined error codes", () => {
      const response = formatErrorResponse(1, {
        code: -32000,
        message: "Application error",
      });
      const parsed = JSON.parse(response);

      expect(parsed.error.code).toBe(-32000);
    });

    it("allows positive error codes", () => {
      const response = formatErrorResponse(1, {
        code: 1001,
        message: "Custom error",
      });
      const parsed = JSON.parse(response);

      expect(parsed.error.code).toBe(1001);
    });

    it("allows zero error code", () => {
      const response = formatErrorResponse(1, {
        code: 0,
        message: "Zero error",
      });
      const parsed = JSON.parse(response);

      expect(parsed.error.code).toBe(0);
    });
  });
});

describe("JSON_RPC_ERROR_CODES", () => {
  it("has correct parse error code", () => {
    expect(JSON_RPC_ERROR_CODES.PARSE_ERROR).toBe(-32700);
  });

  it("has correct invalid request code", () => {
    expect(JSON_RPC_ERROR_CODES.INVALID_REQUEST).toBe(-32600);
  });

  it("has correct method not found code", () => {
    expect(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND).toBe(-32601);
  });

  it("has correct invalid params code", () => {
    expect(JSON_RPC_ERROR_CODES.INVALID_PARAMS).toBe(-32602);
  });

  it("has correct internal error code", () => {
    expect(JSON_RPC_ERROR_CODES.INTERNAL_ERROR).toBe(-32603);
  });
});

// ---------------------------------------------------------------------------
// schema.test.ts
// ---------------------------------------------------------------------------

describe("defineSchema", () => {
  describe("basic schema creation", () => {
    it("creates schema with required string field", () => {
      const schema = defineSchema({
        name: { type: "string", description: "User name" },
      });

      expect(schema).toEqual({
        type: "object",
        properties: {
          name: { type: "string", description: "User name" },
        },
        required: ["name"],
      });
    });

    it("creates schema with optional field", () => {
      const schema = defineSchema({
        count: { type: "number", optional: true },
      });

      expect(schema).toEqual({
        type: "object",
        properties: {
          count: { type: "number" },
        },
        required: [],
      });
    });

    it("creates schema with mixed required and optional fields", () => {
      const schema = defineSchema({
        a: { type: "string" },
        b: { type: "number", optional: true },
      });

      expect(schema).toEqual({
        type: "object",
        properties: {
          a: { type: "string" },
          b: { type: "number" },
        },
        required: ["a"],
      });
    });

    it("handles empty schema", () => {
      const schema = defineSchema({});

      expect(schema).toEqual({
        type: "object",
        properties: {},
        required: [],
      });
    });

    it("preserves a declared __proto__ property", () => {
      const schema = defineSchema(
        Object.fromEntries([["__proto__", { type: "string" as const }]])
      );

      expect(Object.hasOwn(schema.properties, "__proto__")).toBe(true);
      expect(schema.properties.__proto__).toEqual({ type: "string" });
    });

    it("preserves nested array item object schemas", () => {
      const schema = defineSchema({
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              score: { type: "number" },
            },
            required: ["title", "score"],
          },
        },
      });

      expect(schema).toEqual({
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                score: { type: "number" },
              },
              required: ["title", "score"],
            },
          },
        },
        required: ["items"],
      });
    });
  });

  describe("property types", () => {
    it("creates schema with string type", () => {
      const schema = defineSchema({
        field: { type: "string" },
      });
      expect(schema.properties.field.type).toBe("string");
    });

    it("creates schema with number type", () => {
      const schema = defineSchema({
        field: { type: "number" },
      });
      expect(schema.properties.field.type).toBe("number");
    });

    it("creates schema with boolean type", () => {
      const schema = defineSchema({
        field: { type: "boolean" },
      });
      expect(schema.properties.field.type).toBe("boolean");
    });

    it("creates schema with object type", () => {
      const schema = defineSchema({
        field: { type: "object" },
      });
      expect(schema.properties.field.type).toBe("object");
    });

    it("creates schema with array type", () => {
      const schema = defineSchema({
        field: { type: "array" },
      });
      expect(schema.properties.field.type).toBe("array");
    });

    it("creates schema with all property types", () => {
      const schema = defineSchema({
        str: { type: "string" },
        num: { type: "number" },
        bool: { type: "boolean" },
        obj: { type: "object" },
        arr: { type: "array" },
      });

      expect(schema.properties).toEqual({
        str: { type: "string" },
        num: { type: "number" },
        bool: { type: "boolean" },
        obj: { type: "object" },
        arr: { type: "array" },
      });
      expect(schema.required).toEqual(["str", "num", "bool", "obj", "arr"]);
    });
  });

  describe("descriptions", () => {
    it("preserves descriptions on properties", () => {
      const schema = defineSchema({
        message: { type: "string", description: "The prompt" },
        temperature: { type: "number", description: "Sampling temperature" },
      });

      expect(schema.properties.message.description).toBe("The prompt");
      expect(schema.properties.temperature.description).toBe(
        "Sampling temperature"
      );
    });

    it("omits description when not provided", () => {
      const schema = defineSchema({
        field: { type: "string" },
      });

      expect(schema.properties.field).toEqual({ type: "string" });
      expect("description" in schema.properties.field).toBe(false);
    });

    it("handles empty string description", () => {
      const schema = defineSchema({
        field: { type: "string", description: "" },
      });

      expect(schema.properties.field.description).toBe("");
    });

    it("handles long descriptions", () => {
      const longDesc = "A".repeat(1000);
      const schema = defineSchema({
        field: { type: "string", description: longDesc },
      });

      expect(schema.properties.field.description).toBe(longDesc);
    });

    it("handles special characters in descriptions", () => {
      const schema = defineSchema({
        field: {
          type: "string",
          description: 'Contains "quotes", newlines\nand\ttabs',
        },
      });

      expect(schema.properties.field.description).toBe(
        'Contains "quotes", newlines\nand\ttabs'
      );
    });
  });

  describe("required array behavior", () => {
    it("includes all required fields in required array", () => {
      const schema = defineSchema({
        a: { type: "string" },
        b: { type: "number" },
        c: { type: "boolean" },
      });

      expect(schema.required).toContain("a");
      expect(schema.required).toContain("b");
      expect(schema.required).toContain("c");
      expect(schema.required).toHaveLength(3);
    });

    it("excludes all optional fields from required array", () => {
      const schema = defineSchema({
        a: { type: "string", optional: true },
        b: { type: "number", optional: true },
        c: { type: "boolean", optional: true },
      });

      expect(schema.required).toEqual([]);
    });

    it("correctly partitions required and optional", () => {
      const schema = defineSchema({
        required1: { type: "string" },
        optional1: { type: "number", optional: true },
        required2: { type: "boolean" },
        optional2: { type: "object", optional: true },
        required3: { type: "array" },
      });

      expect(schema.required).toContain("required1");
      expect(schema.required).toContain("required2");
      expect(schema.required).toContain("required3");
      expect(schema.required).not.toContain("optional1");
      expect(schema.required).not.toContain("optional2");
      expect(schema.required).toHaveLength(3);
    });

    it("optional: false is treated as required", () => {
      const schema = defineSchema({
        field: { type: "string", optional: false },
      });

      expect(schema.required).toContain("field");
    });
  });

  describe("field naming", () => {
    it("handles single character field names", () => {
      const schema = defineSchema({
        a: { type: "string" },
        b: { type: "number" },
      });

      expect(schema.properties.a).toBeDefined();
      expect(schema.properties.b).toBeDefined();
    });

    it("handles long field names", () => {
      const longName = "a".repeat(100);
      const schema = defineSchema({
        [longName]: { type: "string" },
      });

      expect(schema.properties[longName]).toBeDefined();
      expect(schema.required).toContain(longName);
    });

    it("handles camelCase field names", () => {
      const schema = defineSchema({
        firstName: { type: "string" },
        lastName: { type: "string" },
      });

      expect(schema.properties.firstName).toBeDefined();
      expect(schema.properties.lastName).toBeDefined();
    });

    it("handles snake_case field names", () => {
      const schema = defineSchema({
        first_name: { type: "string" },
        last_name: { type: "string" },
      });

      expect(schema.properties.first_name).toBeDefined();
      expect(schema.properties.last_name).toBeDefined();
    });

    it("handles field names with numbers", () => {
      const schema = defineSchema({
        field1: { type: "string" },
        field2: { type: "number" },
        "2field": { type: "boolean" },
      });

      expect(schema.properties.field1).toBeDefined();
      expect(schema.properties.field2).toBeDefined();
      expect(schema.properties["2field"]).toBeDefined();
    });

    it("handles field names with special characters", () => {
      const schema = defineSchema({
        "field-name": { type: "string" },
        "field.name": { type: "number" },
      });

      expect(schema.properties["field-name"]).toBeDefined();
      expect(schema.properties["field.name"]).toBeDefined();
    });
  });

  describe("schema structure", () => {
    it("always has type: object at root", () => {
      const schema = defineSchema({
        field: { type: "string" },
      });

      expect(schema.type).toBe("object");
    });

    it("always has properties object", () => {
      const schema = defineSchema({});

      expect(schema.properties).toBeDefined();
      expect(typeof schema.properties).toBe("object");
    });

    it("always has required array", () => {
      const schema = defineSchema({});

      expect(schema.required).toBeDefined();
      expect(Array.isArray(schema.required)).toBe(true);
    });

    it("does not include optional flag in output properties", () => {
      const schema = defineSchema({
        field: { type: "string", optional: true },
      });

      expect("optional" in schema.properties.field).toBe(false);
    });
  });

  describe("many fields", () => {
    it("handles 10 fields", () => {
      const schema = defineSchema({
        f1: { type: "string" },
        f2: { type: "number" },
        f3: { type: "boolean" },
        f4: { type: "object" },
        f5: { type: "array" },
        f6: { type: "string", optional: true },
        f7: { type: "number", optional: true },
        f8: { type: "boolean", optional: true },
        f9: { type: "object", optional: true },
        f10: { type: "array", optional: true },
      });

      expect(Object.keys(schema.properties)).toHaveLength(10);
      expect(schema.required).toHaveLength(5);
    });

    it("handles 50 fields", () => {
      const def: Record<string, { type: "string"; optional?: boolean }> = {};
      for (let i = 0; i < 50; i++) {
        def[`field${i}`] = { type: "string", optional: i % 2 === 0 };
      }
      const schema = defineSchema(def);

      expect(Object.keys(schema.properties)).toHaveLength(50);
      expect(schema.required).toHaveLength(25);
    });
  });

  describe("JSON Schema validity", () => {
    it("produces valid JSON Schema structure", () => {
      const schema = defineSchema({
        name: { type: "string", description: "User name" },
        age: { type: "number", optional: true },
      });

      // Verify it can be JSON stringified and parsed
      const json = JSON.stringify(schema);
      const parsed = JSON.parse(json);

      expect(parsed.type).toBe("object");
      expect(parsed.properties).toBeDefined();
      expect(parsed.required).toBeDefined();
    });

    it("produces schema that matches JSON Schema spec", () => {
      const schema = defineSchema({
        name: { type: "string" },
      });

      // JSON Schema requires these fields for object type
      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();
      // Required is an array of strings
      expect(Array.isArray(schema.required)).toBe(true);
      schema.required?.forEach((r) => expect(typeof r).toBe("string"));
    });
  });
});

// ---------------------------------------------------------------------------
// server.test.ts
// ---------------------------------------------------------------------------

function createTestTransport() {
  const output: string[] = [];
  const readable = new Readable({
    read() {},
  });
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      output.push(chunk.toString());
      callback();
    },
  });

  return {
    readable,
    writable,
    output,
    send(msg: string) {
      readable.push(msg + "\n");
    },
    close() {
      readable.push(null);
    },
    getLastResponse() {
      for (let i = output.length - 1; i >= 0; i -= 1) {
        const parsed = JSON.parse(output[i].trim());
        if ("id" in parsed) {
          return parsed;
        }
      }
      return null;
    },
    getAllResponses() {
      return output.map((line) => JSON.parse(line.trim()));
    },
  };
}

function getResponsesWithId(responses: Array<Record<string, unknown>>) {
  return responses.filter((response) => "id" in response);
}

function createSdkTransport() {
  const sent: JSONRPCMessage[] = [];
  const transport = {
    onmessage: undefined,
    onclose: undefined,
    start: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    send: vi.fn(async (message: JSONRPCMessage) => {
      sent.push(message);
    }),
  } as unknown as SDKTransport;

  return { sent, transport };
}

describe("createServer", () => {
  describe("server creation", () => {
    it("creates a server with options", () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      expect(server).toBeDefined();
      expect(server.tool).toBeDefined();
      expect(server.listen).toBeDefined();
      expect(server.connect).toBeDefined();
      expect(server.connectSDK).toBeDefined();
    });

    it("creates server with minimal options", () => {
      const server = createServer({ name: "s", version: "0" });
      expect(server).toBeDefined();
    });

    it("creates server with long name and version", () => {
      const server = createServer({
        name: "my-very-long-server-name-for-testing",
        version: "1.0.0-beta.1+build.123",
      });
      expect(server).toBeDefined();
    });
  });

  describe("fluent API", () => {
    it("supports fluent tool chaining", () => {
      const schema = defineSchema({ name: { type: "string" } });
      const server = createServer({ name: "test", version: "1.0.0" })
        .tool("a", "Tool A", schema, async () => "a")
        .tool("b", "Tool B", schema, async () => "b")
        .tool("c", "Tool C", schema, async () => "c");

      expect(server).toBeDefined();
    });

    it("returns same server instance from tool()", () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" });
      const returned = server.tool("test", "Test", schema, async () => ({
        text: "",
      }));

      expect(returned).toBe(server);
    });

    it("allows registering many tools", () => {
      const schema = defineSchema({});
      let server = createServer({ name: "test", version: "1.0.0" });

      for (let i = 0; i < 50; i++) {
        server = server.tool(`tool${i}`, `Tool ${i}`, schema, async () => ({
          text: String(i),
        }));
      }

      expect(server).toBeDefined();
    });
  });

  describe("removeTool", () => {
    it("removes a registered tool", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" })
        .tool("tool1", "First", schema, async () => "1")
        .tool("tool2", "Second", schema, async () => "2");

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","method":"notifications/initialized"}');
      transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');

      // Wait for messages to process
      await new Promise((resolve) => setTimeout(resolve, 10));

      const removed = server.removeTool("tool1");
      expect(removed).toBe(true);

      transport.send('{"jsonrpc":"2.0","id":3,"method":"tools/list"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.tools).toHaveLength(2);
      expect(responses[2].result.tools).toHaveLength(1);
      expect(responses[2].result.tools[0].name).toBe("tool2");
    });

    it("returns false when removing non-existent tool", () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      const removed = server.removeTool("nonexistent");
      expect(removed).toBe(false);
    });

    it("returns true when removing existing tool", () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "test",
        "Test",
        schema,
        async () => ""
      );

      const removed = server.removeTool("test");
      expect(removed).toBe(true);
    });

    it("tool is no longer callable after removal", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "test",
        "Test",
        schema,
        async () => "ok"
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","method":"notifications/initialized"}');

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      server.removeTool("test");

      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"test","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].error.code).toBe(-32602);
      expect(responses[1].error.message).toContain("Tool not found");
    });
  });

  describe("notifyToolsChanged", () => {
    it("sends notifications/tools/list_changed via stdio transport", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "test",
        "Test",
        schema,
        async () => "ok"
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","method":"notifications/initialized"}'
      );

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      await server.notifyToolsChanged();

      transport.close();

      await connectPromise;

      // Check raw output for notification
      const allOutput = transport.output;
      const hasNotification = allOutput.some((line) => {
        const parsed = JSON.parse(line.trim());
        return (
          parsed.method === "notifications/tools/list_changed" &&
          parsed.jsonrpc === "2.0" &&
          !("id" in parsed)
        );
      });
      expect(hasNotification).toBe(true);
    });

    it("does not send notification before initialization", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);

      // Should not throw or send notification
      await server.notifyToolsChanged();

      transport.close();

      await connectPromise;

      // No output should be sent
      expect(transport.output).toHaveLength(0);
    });

    it("notification is proper JSON-RPC 2.0 format", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "test",
        "Test",
        schema,
        async () => "ok"
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","method":"notifications/initialized"}'
      );

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      await server.notifyToolsChanged();

      transport.close();

      await connectPromise;

      // Find the notification in output
      const notification = transport.output.find((line) => {
        const parsed = JSON.parse(line.trim());
        return parsed.method === "notifications/tools/list_changed";
      });

      expect(notification).toBeDefined();
      const parsed = JSON.parse(notification!.trim());
      expect(parsed.jsonrpc).toBe("2.0");
      expect(parsed.method).toBe("notifications/tools/list_changed");
      expect(parsed.id).toBeUndefined();
    });
  });

  describe("onNotification", () => {
    it("R11: listener receives notifications/tools/list_changed after notifyToolsChanged()", async () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      const notifications: JSONRPCNotification[] = [];

      server.onNotification((notification) => {
        notifications.push(notification);
      });

      await server.handleMessage("initialize", {});
      await server.handleMessage("notifications/initialized", {});
      await server.notifyToolsChanged();

      expect(notifications).toEqual([
        {
          jsonrpc: "2.0",
          method: "notifications/tools/list_changed",
        },
      ]);
    });

    it("R12: multiple listeners all receive notification", async () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      const first: JSONRPCNotification[] = [];
      const second: JSONRPCNotification[] = [];

      server.onNotification((notification) => {
        first.push(notification);
      });
      server.onNotification((notification) => {
        second.push(notification);
      });

      await server.handleMessage("initialize", {});
      await server.handleMessage("notifications/initialized", {});
      await server.notifyToolsChanged();

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(first[0]).toEqual(second[0]);
    });

    it("R13: unsubscribe prevents further notifications", async () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      const notifications: JSONRPCNotification[] = [];
      const unsubscribe = server.onNotification((notification) => {
        notifications.push(notification);
      });

      await server.handleMessage("initialize", {});
      await server.handleMessage("notifications/initialized", {});
      await server.notifyToolsChanged();

      unsubscribe();
      await server.notifyToolsChanged();

      expect(notifications).toHaveLength(1);
    });

    it("R14: notifyToolsChanged() before initialize is silent", async () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      const listener = vi.fn();

      server.onNotification(listener);

      await server.notifyToolsChanged();

      expect(listener).not.toHaveBeenCalled();
    });

    it("R15: listener added after initialize receives future notifications", async () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      const notifications: JSONRPCNotification[] = [];

      await server.handleMessage("initialize", {});
      await server.handleMessage("notifications/initialized", {});

      server.onNotification((notification) => {
        notifications.push(notification);
      });

      await server.notifyToolsChanged();

      expect(notifications).toEqual([
        {
          jsonrpc: "2.0",
          method: "notifications/tools/list_changed",
        },
      ]);
    });

    it("R16: notification has correct JSON-RPC shape", async () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      const notifications: JSONRPCNotification[] = [];

      server.onNotification((notification) => {
        notifications.push(notification);
      });

      await server.handleMessage("initialize", {});
      await server.handleMessage("notifications/initialized", {});
      await server.notifyToolsChanged();

      expect(notifications[0]).toEqual({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
      });
    });

    it("R17: unsubscribe is idempotent", () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      const unsubscribe = server.onNotification(() => undefined);

      unsubscribe();

      expect(() => unsubscribe()).not.toThrow();
    });
  });
});

describe("server protocol handlers", () => {
  describe("handleMessage", () => {
    it('R1: handleMessage("ping") returns { result: {} }', async () => {
      const server = createServer({ name: "test", version: "1.0.0" });

      await expect(server.handleMessage("ping")).resolves.toEqual({
        result: {},
      });
    });

    it('R2: handleMessage("initialize", {}) returns InitializeResult', async () => {
      const server = createServer({ name: "test-server", version: "2.0.0" });

      const response = await server.handleMessage("initialize", {});

      expect(response.error).toBeUndefined();
      expect(response.result).toEqual({
        protocolVersion: expect.any(String),
        capabilities: {
          tools: {
            listChanged: true,
          },
          prompts: {
            listChanged: true,
          },
          resources: {
            listChanged: true,
            subscribe: true,
          },
        },
        serverInfo: {
          name: "test-server",
          version: "2.0.0",
        },
      });
    });

    it('R3: handleMessage("tools/list") after initialize returns tool list', async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "greet",
        "Greets",
        schema,
        async () => "hello"
      );

      await server.handleMessage("initialize", {});

      await expect(server.handleMessage("tools/list")).resolves.toEqual({
        result: {
          tools: [
            {
              name: "greet",
              description: "Greets",
              inputSchema: schema,
            },
          ],
        },
      });
    });

    it('R4: handleMessage("tools/list") before initialize returns error', async () => {
      const server = createServer({ name: "test", version: "1.0.0" });

      await expect(server.handleMessage("tools/list")).resolves.toEqual({
        error: {
          code: -32600,
          message: "Server not initialized",
        },
      });
    });

    it('R5: handleMessage("tools/call", { name, arguments }) invokes handler', async () => {
      const schema = defineSchema({ name: { type: "string" } });
      const handler = async ({ name }: { name: string }) => `Hello, ${name}!`;
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "greet",
        "Greets",
        schema,
        handler
      );

      await server.handleMessage("initialize", {});

      await expect(
        server.handleMessage("tools/call", {
          name: "greet",
          arguments: { name: "World" },
        })
      ).resolves.toEqual({
        result: {
          content: [{ type: "text", text: "Hello, World!" }],
        },
      });
    });

    it('R5a: handleMessage("tools/call") preserves CallToolResult returned by the handler', async () => {
      const schema = defineSchema({ name: { type: "string" } });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "greet",
        "Greets",
        schema,
        async ({ name }: { name: string }) => ({
          content: [{ type: "text", text: `Queued ${name}` }],
          isError: true,
        })
      );

      await server.handleMessage("initialize", {});

      await expect(
        server.handleMessage("tools/call", {
          name: "greet",
          arguments: { name: "World" },
        })
      ).resolves.toEqual({
        result: {
          content: [{ type: "text", text: "Queued World" }],
          isError: true,
        },
      });
    });

    it('R6: handleMessage("tools/call", { name: "missing" }) returns tool not found error', async () => {
      const server = createServer({ name: "test", version: "1.0.0" });

      await server.handleMessage("initialize", {});

      await expect(
        server.handleMessage("tools/call", { name: "missing" })
      ).resolves.toEqual({
        error: {
          code: -32602,
          message: "Tool not found: missing",
        },
      });
    });

    it('R7: handleMessage("tools/call", {}) returns tool name required error', async () => {
      const server = createServer({ name: "test", version: "1.0.0" });

      await server.handleMessage("initialize", {});

      await expect(server.handleMessage("tools/call", {})).resolves.toEqual({
        error: {
          code: -32602,
          message: "Tool name required",
        },
      });
    });

    it('R8: handleMessage("unknown/method") returns METHOD_NOT_FOUND (-32601)', async () => {
      const server = createServer({ name: "test", version: "1.0.0" });

      await server.handleMessage("initialize", {});

      await expect(
        server.handleMessage("unknown/method")
      ).resolves.toEqual({
        error: {
          code: -32601,
          message: "Method not found",
        },
      });
    });

    it('R9: handleMessage("notifications/initialized") returns { result: undefined }', async () => {
      const server = createServer({ name: "test", version: "1.0.0" });

      await server.handleMessage("initialize", {});

      await expect(
        server.handleMessage("notifications/initialized")
      ).resolves.toEqual({
        result: undefined,
      });
    });

    it('rejects handleMessage("notifications/initialized") before initialize', async () => {
      const server = createServer({ name: "test", version: "1.0.0" });

      await expect(server.handleMessage("notifications/initialized")).resolves.toEqual({
        error: {
          code: -32600,
          message: "Server not initialized",
        },
      });
    });

    it("accepts an idempotent re-initialize on the same connection", async () => {
      // Real MCP clients (e.g. kimi-cli via fastmcp) re-enter the client and
      // re-send `initialize` on a persistent connection per tool call. The
      // official MCP SDK server re-responds with InitializeResult rather than
      // erroring, so this server must do the same.
      const server = createServer({ name: "test", version: "1.0.0" });

      await server.handleMessage("initialize", {});
      await server.handleMessage("notifications/initialized", {});

      const response = await server.handleMessage("initialize", {});
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual({
        protocolVersion: expect.any(String),
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true, subscribe: true },
        },
        serverInfo: { name: "test", version: "1.0.0" },
      });
    });

    it("R10: handleMessage with throwing tool handler returns isError result", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "fail",
        "Fails",
        schema,
        async () => {
          throw new Error("boom");
        }
      );

      await server.handleMessage("initialize", {});

      await expect(
        server.handleMessage("tools/call", {
          name: "fail",
          arguments: {},
        })
      ).resolves.toEqual({
        result: {
          content: [{ type: "text", text: "Error: boom" }],
          isError: true,
        },
      });
    });

    it("R11: handleMessage with ToolError returns JSON-RPC error", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "invalid",
        "Fails with invalid params",
        schema,
        async () => {
          throw new ToolError(
            JSON_RPC_ERROR_CODES.INVALID_PARAMS,
            "Missing required parameter"
          );
        }
      );

      await server.handleMessage("initialize", {});

      await expect(
        server.handleMessage("tools/call", {
          name: "invalid",
          arguments: {},
        })
      ).resolves.toEqual({
        error: {
          code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
          message: "Missing required parameter",
        },
      });
    });

    it("does not invoke tools with invalid schema arguments", async () => {
      const handler = vi.fn(async () => "unexpected");
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "validated",
        "Validated",
        defineSchema({ name: { type: "string" }, count: { type: "number" } }),
        handler
      );

      await server.handleMessage("initialize", {});

      await expect(
        server.handleMessage("tools/call", {
          name: "validated",
          arguments: { count: "many" },
        })
      ).resolves.toEqual({ error: { code: -32602, message: "Invalid tool arguments" } });
      expect(handler).not.toHaveBeenCalled();
    });

    it("allows handlers to provide detailed validation errors when schema prevalidation is disabled", async () => {
      const server = createServer({
        name: "test",
        version: "1.0.0",
        validateToolArguments: false
      }).tool(
        "validated",
        "Validated",
        defineSchema({ name: { type: "string" } }),
        async () => {
          throw new ToolError(JSON_RPC_ERROR_CODES.INVALID_PARAMS, 'Missing required parameter "name".');
        }
      );

      await server.handleMessage("initialize", {});

      await expect(
        server.handleMessage("tools/call", {
          name: "validated",
          arguments: {}
        })
      ).resolves.toEqual({
        error: { code: JSON_RPC_ERROR_CODES.INVALID_PARAMS, message: 'Missing required parameter "name".' }
      });
    });

    it("accepts integer and nullable values declared by MCP JSON schemas", async () => {
      const handler = vi.fn(async () => "validated");
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "validated",
        "Validated",
        {
          type: "object",
          properties: {
            count: { type: "integer" },
            optionalCount: { type: "integer", nullable: true }
          },
          required: ["count"]
        },
        handler
      );

      await server.handleMessage("initialize", {});

      await expect(
        server.handleMessage("tools/call", {
          name: "validated",
          arguments: { count: 2, optionalCount: null }
        })
      ).resolves.toEqual({ result: { content: [{ type: "text", text: "validated" }] } });
      expect(handler).toHaveBeenCalledWith({ count: 2, optionalCount: null });

      await expect(
        server.handleMessage("tools/call", {
          name: "validated",
          arguments: { count: 2.5 }
        })
      ).resolves.toEqual({ error: { code: -32602, message: "Invalid tool arguments" } });
    });

    it("rejects malformed direct CallToolResult values", async () => {
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "malformed",
        "Malformed",
        defineSchema({}),
        async () => ({ content: [{ type: "text" }] } as never)
      );

      await server.handleMessage("initialize", {});

      await expect(
        server.handleMessage("tools/call", { name: "malformed", arguments: {} })
      ).resolves.toEqual({
        result: {
          content: [{ type: "text", text: "Error: Invalid tool result" }],
          isError: true,
        },
      });
    });

    it("rejects non-finite ToolError codes", () => {
      expect(() => new ToolError(Number.POSITIVE_INFINITY, "overflow")).toThrow(
        "ToolError code must be a finite number"
      );
    });
  });

  describe("ping", () => {
    it("responds to ping", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.result).toEqual({});
      expect(response.id).toBe(1);
    });

    it("responds to ping before initialize", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual({});
    });

    it("responds to multiple pings", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');
      transport.send('{"jsonrpc":"2.0","id":2,"method":"ping"}');
      transport.send('{"jsonrpc":"2.0","id":3,"method":"ping"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses).toHaveLength(3);
      expect(responses[0].id).toBe(1);
      expect(responses[1].id).toBe(2);
      expect(responses[2].id).toBe(3);
    });
  });

  describe("initialize", () => {
    it("responds to initialize", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "my-server", version: "2.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.result.serverInfo.name).toBe("my-server");
      expect(response.result.serverInfo.version).toBe("2.0.0");
      expect(response.result.capabilities.tools).toEqual({ listChanged: true });
      expect(response.result.protocolVersion).toBeDefined();
    });

    it("returns listChanged capability", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.result.capabilities.tools.listChanged).toBe(true);
    });

    it("returns correct server info", async () => {
      const transport = createTestTransport();
      const server = createServer({
        name: "special-server",
        version: "3.1.4-alpha",
      });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.result.serverInfo).toEqual({
        name: "special-server",
        version: "3.1.4-alpha",
      });
    });

    it("returns tools capability", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.result.capabilities).toHaveProperty("tools");
    });

    it("accepts initialize with client info params", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"test-client","version":"1.0.0"}}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.error).toBeUndefined();
      expect(response.result.serverInfo).toBeDefined();
    });

    it("echoes a supported requested protocol version", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.result.protocolVersion).toBe("2025-06-18");
    });

    it("returns its latest supported protocol version for an unsupported request", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"not-a-supported-version"}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.result.protocolVersion).toBe("2025-11-25");
    });
  });

  describe("notifications/initialized", () => {
    it("accepts notifications/initialized notification", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","method":"notifications/initialized"}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"ping"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      // Should only have 2 responses (initialize and ping), not 3
      // notifications/initialized is a notification (no id) and returns undefined
      expect(responses).toHaveLength(2);
      expect(responses[0].id).toBe(1);
      expect(responses[1].id).toBe(2);
    });

    it("does not respond to notifications/initialized", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","method":"notifications/initialized"}'
      );
      transport.close();

      await connectPromise;

      expect(transport.output).toHaveLength(0);
    });

    it("accepts notifications/initialized before full initialization", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      // notifications/initialized is allowed even before initialize
      transport.send(
        '{"jsonrpc":"2.0","method":"notifications/initialized"}'
      );
      transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses).toHaveLength(1);
      expect(responses[0].result).toEqual({});
    });
  });

  describe("initialization state", () => {
    it("rejects tools/list before initialize", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.error.code).toBe(-32600);
      expect(response.error.message).toBe("Server not initialized");
    });

    it("rejects tools/call before initialize", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test"}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.error.code).toBe(-32600);
      expect(response.error.message).toBe("Server not initialized");
    });

    it("allows tools/list after initialize", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].error).toBeUndefined();
      expect(responses[1].result.tools).toBeDefined();
    });
  });

  describe("tools/list", () => {
    it("responds to tools/list after initialize", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({ name: { type: "string" } });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "greet",
        "Say hello",
        schema,
        async () => "hello"
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      const toolsResponse = responses[1];
      expect(toolsResponse.result.tools).toHaveLength(1);
      expect(toolsResponse.result.tools[0].name).toBe("greet");
      expect(toolsResponse.result.tools[0].description).toBe("Say hello");
    });

    it("returns empty array when no tools registered", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.tools).toEqual([]);
    });

    it("returns all registered tools", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" })
        .tool("tool1", "First tool", schema, async () => "1")
        .tool("tool2", "Second tool", schema, async () => "2")
        .tool("tool3", "Third tool", schema, async () => "3");

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.tools).toHaveLength(3);
    });

    it("includes inputSchema for each tool", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({
        name: { type: "string", description: "The name" },
        count: { type: "number", optional: true },
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "test",
        "Test tool",
        schema,
        async () => ""
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      const tool = responses[1].result.tools[0];
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties.name.type).toBe("string");
      expect(tool.inputSchema.required).toContain("name");
    });
  });

  describe("tools/call", () => {
    it("responds to tools/call", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({ name: { type: "string" } });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "greet",
        "Say hello",
        schema,
        async (args) => `Hello, ${args.name}!`
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"greet","arguments":{"name":"World"}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      const callResponse = responses[1];
      expect(callResponse.result.content).toEqual([
        { type: "text", text: "Hello, World!" },
      ]);
    });

    it("calls correct tool handler", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" })
        .tool("tool1", "First", schema, async () => "first")
        .tool("tool2", "Second", schema, async () => "second")
        .tool("tool3", "Third", schema, async () => "third");

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tool2","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content[0].text).toBe("second");
    });

    it("passes arguments to handler", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({
        a: { type: "number" },
        b: { type: "number" },
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "add",
        "Add numbers",
        schema,
        async (args) => String(args.a + args.b)
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"add","arguments":{"a":5,"b":3}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content[0].text).toBe("8");
    });

    it("handles empty arguments", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "noop",
        "No-op",
        schema,
        async () => "done"
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"noop","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content[0].text).toBe("done");
    });

    it("handles missing arguments (defaults to empty)", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "noop",
        "No-op",
        schema,
        async () => "done"
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"noop"}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content[0].text).toBe("done");
    });
  });

  describe("tool errors", () => {
    it("handles tool handler errors", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "fail",
        "Always fails",
        schema,
        async () => {
          throw new Error("Something went wrong");
        }
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fail","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      const callResponse = responses[1];
      expect(callResponse.result.isError).toBe(true);
      expect(callResponse.result.content[0].text).toContain(
        "Something went wrong"
      );
    });

    it("handles sync throw", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "fail",
        "Fails sync",
        schema,
        () => {
          throw new Error("Sync error");
        }
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fail","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.isError).toBe(true);
      expect(responses[1].result.content[0].text).toContain("Sync error");
    });

    it("handles rejected promise", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "fail",
        "Rejects",
        schema,
        async () => {
          await Promise.resolve(); // ensure async
          throw new Error("Rejected");
        }
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fail","arguments":{}}}'
      );
      // Wait for async processing before closing
      await new Promise((resolve) => setTimeout(resolve, 10));
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.isError).toBe(true);
      expect(responses[1].result.content[0].text).toContain("Rejected");
    });

    it("handles non-Error throws", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "fail",
        "Throws string",
        schema,
        () => {
          throw "string error";
        }
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fail","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.isError).toBe(true);
      expect(responses[1].result.content[0].text).toContain("string error");
    });

    it("returns error for unknown tool", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"unknown","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      const callResponse = responses[1];
      expect(callResponse.error.code).toBe(-32602);
      expect(callResponse.error.message).toContain("Tool not found");
    });

    it("returns error when tool name missing", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].error.code).toBe(-32602);
    });
  });

  describe("unknown methods", () => {
    it("returns method not found for unknown method", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"unknown/method"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      const unknownResponse = responses[1];
      expect(unknownResponse.error.code).toBe(-32601);
      expect(unknownResponse.error.message).toBe("Method not found");
    });

    it("returns method not found for various unknown methods", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"unknown/resources"}');
      transport.send('{"jsonrpc":"2.0","id":3,"method":"unknown/prompts"}');
      transport.send('{"jsonrpc":"2.0","id":4,"method":"sampling/complete"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].error.code).toBe(-32601);
      expect(responses[2].error.code).toBe(-32601);
      expect(responses[3].error.code).toBe(-32601);
    });
  });

  describe("JSON-RPC errors", () => {
    it("returns error for invalid JSON", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send("{invalid}");
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.error.code).toBe(-32700);
    });

    it("returns error for missing jsonrpc field", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send('{"id":1,"method":"ping"}');
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.error.code).toBe(-32600);
    });

    it("returns error for missing method", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1}');
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.error.code).toBe(-32600);
    });

    it("handles multiple errors in sequence", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send("{invalid}");
      transport.send('{"id":1,"method":"test"}');
      transport.send('{"jsonrpc":"2.0","id":2,"method":"ping"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[0].error.code).toBe(-32700);
      expect(responses[1].error.code).toBe(-32600);
      expect(responses[2].result).toEqual({});
    });
  });
});

describe("server with multiple content items", () => {
  it("returns multiple content items from handler", async () => {
    const transport = createTestTransport();
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "multi",
      "Multiple items",
      schema,
      async () => [
        { type: "text", text: "A" } as const,
        { type: "text", text: "B" } as const,
      ]
    );

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    transport.send(
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"multi","arguments":{}}}'
    );
    transport.close();

    await connectPromise;

    const responses = getResponsesWithId(transport.getAllResponses());
    const callResponse = responses[1];
    expect(callResponse.result.content).toEqual([
      { type: "text", text: "A" },
      { type: "text", text: "B" },
    ]);
  });

  it("returns many content items", async () => {
    const transport = createTestTransport();
    const schema = defineSchema({});
    const items = Array.from({ length: 10 }, (_, i) => ({
      type: "text" as const,
      text: `Item ${i}`,
    }));
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "many",
      "Many items",
      schema,
      async () => items
    );

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    transport.send(
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"many","arguments":{}}}'
    );
    transport.close();

    await connectPromise;

    const responses = getResponsesWithId(transport.getAllResponses());
    expect(responses[1].result.content).toHaveLength(10);
  });

  it("returns empty text when handler returns empty text", async () => {
    const transport = createTestTransport();
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "empty",
      "Empty result",
      schema,
      async () => ""
    );

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    transport.send(
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"empty","arguments":{}}}'
    );
    transport.close();

    await connectPromise;

    const responses = getResponsesWithId(transport.getAllResponses());
    expect(responses[1].result.content[0].text).toBe("");
  });
});

describe("async handlers", () => {
  it("handles async operations", async () => {
    const transport = createTestTransport();
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "delay",
      "Delayed response",
      schema,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "delayed";
      }
    );

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    transport.send(
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"delay","arguments":{}}}'
    );

    let responses = getResponsesWithId(transport.getAllResponses());
    for (let attempts = 0; responses.length < 2 && attempts < 100; attempts += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      responses = getResponsesWithId(transport.getAllResponses());
    }

    transport.close();

    await connectPromise;

    responses = getResponsesWithId(transport.getAllResponses());
    expect(responses).toHaveLength(2);
    expect(responses[1].result.content[0].text).toBe("delayed");
  });

  it("handles sync handlers", async () => {
    const transport = createTestTransport();
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "sync",
      "Sync response",
      schema,
      () => "sync"
    );

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    transport.send(
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sync","arguments":{}}}'
    );
    transport.close();

    await connectPromise;

    const responses = getResponsesWithId(transport.getAllResponses());
    expect(responses[1].result.content[0].text).toBe("sync");
  });
});

describe("transport connection", () => {
  it("closes cleanly on EOF", async () => {
    const transport = createTestTransport();
    const server = createServer({ name: "test", version: "1.0.0" });

    const connectPromise = server.connect(transport);
    transport.close();

    await expect(connectPromise).resolves.toBeUndefined();
  });

  it("processes all messages before closing", async () => {
    const transport = createTestTransport();
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "test",
      "Test",
      schema,
      async () => "ok"
    );

    const connectPromise = server.connect(transport);

    transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    transport.send(
      '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{}}'
    );
    transport.send('{"jsonrpc":"2.0","id":3,"method":"tools/list"}');
    transport.close();

    await connectPromise;

    const responses = getResponsesWithId(transport.getAllResponses());
    expect(responses).toHaveLength(3);
  });

  it("waits for accepted tool responses before resolving connect", async () => {
    const transport = createTestTransport();
    let finishTool: ((value: string) => void) | undefined;
    let markToolStarted: (() => void) | undefined;
    const toolStarted = new Promise<void>((resolve) => {
      markToolStarted = resolve;
    });
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "slow",
      "Slow",
      defineSchema({}),
      () => new Promise<string>((resolve) => {
        markToolStarted?.();
        finishTool = resolve;
      })
    );
    const connectPromise = server.connect(transport);

    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    await vi.waitFor(() => {
      expect(getResponsesWithId(transport.getAllResponses()).some((response) => response.id === 1)).toBe(true);
    });
    transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"slow","arguments":{}}}');
    await toolStarted;
    transport.close();

    await Promise.resolve();
    let resolved = false;
    void connectPromise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    finishTool?.("finished");
    await connectPromise;
    expect(getResponsesWithId(transport.getAllResponses()).find((response) => response.id === 2)).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: { content: [{ type: "text", text: "finished" }] },
    });
  });

  it("does not unlock tools from notification-form initialize", async () => {
    const transport = createTestTransport();
    const server = createServer({ name: "test", version: "1.0.0" });
    const connectPromise = server.connect(transport);

    transport.send('{"jsonrpc":"2.0","method":"initialize","params":{}}');
    transport.send('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
    transport.close();

    await connectPromise;

    expect(getResponsesWithId(transport.getAllResponses())).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32600, message: "Server not initialized" },
      },
    ]);
  });

  it("responds with an error to request-form notifications/initialized", async () => {
    const transport = createTestTransport();
    const server = createServer({ name: "test", version: "1.0.0" });
    const connectPromise = server.connect(transport);

    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    transport.send('{"jsonrpc":"2.0","id":2,"method":"notifications/initialized"}');
    transport.close();

    await connectPromise;

    expect(
      getResponsesWithId(transport.getAllResponses()).find((response) => response.id === 2)
    ).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32600, message: "Invalid Request" },
    });
  });
});

describe("SDK connection lifecycle", () => {
  it("keeps initialization state isolated per connection", async () => {
    const server = createServer({ name: "test", version: "1.0.0" });
    const first = createSdkTransport();
    const second = createSdkTransport();

    void server.connectSDK(first.transport);
    void server.connectSDK(second.transport);

    await first.transport.onmessage?.({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await first.transport.onmessage?.({ jsonrpc: "2.0", method: "notifications/initialized" });
    await second.transport.onmessage?.({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    expect(second.sent).toEqual([
      {
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32600, message: "Server not initialized" },
      },
    ]);

    first.transport.onclose?.();
    second.transport.onclose?.();
  });

  it("rejects when SDK transport startup fails", async () => {
    const server = createServer({ name: "test", version: "1.0.0" });
    const transport = createSdkTransport().transport;
    transport.start = vi.fn(async () => {
      throw new Error("start failed");
    });

    await expect(server.connectSDK(transport)).rejects.toThrow("start failed");
  });

  it("rejects notifyToolsChanged when SDK notification delivery fails", async () => {
    const server = createServer({ name: "test", version: "1.0.0" });
    const sdk = createSdkTransport();
    sdk.transport.send = vi.fn(async (message: JSONRPCMessage) => {
      if ("method" in message && message.method === "notifications/tools/list_changed") {
        throw new Error("transport closed");
      }
      sdk.sent.push(message);
    });

    void server.connectSDK(sdk.transport);
    await sdk.transport.onmessage?.({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await sdk.transport.onmessage?.({ jsonrpc: "2.0", method: "notifications/initialized" });

    await expect(server.notifyToolsChanged()).rejects.toThrow("transport closed");
    sdk.transport.onclose?.();
  });
});

describe("request id handling", () => {
  it("preserves numeric request id", async () => {
    const transport = createTestTransport();
    const server = createServer({ name: "test", version: "1.0.0" });

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":42,"method":"ping"}');
    transport.close();

    await connectPromise;

    expect(transport.getLastResponse().id).toBe(42);
  });

  it("preserves string request id", async () => {
    const transport = createTestTransport();
    const server = createServer({ name: "test", version: "1.0.0" });

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":"request-abc","method":"ping"}');
    transport.close();

    await connectPromise;

    expect(transport.getLastResponse().id).toBe("request-abc");
  });

  it("preserves zero id", async () => {
    const transport = createTestTransport();
    const server = createServer({ name: "test", version: "1.0.0" });

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":0,"method":"ping"}');
    transport.close();

    await connectPromise;

    expect(transport.getLastResponse().id).toBe(0);
  });
});

describe("content helpers integration", () => {
  describe("string return type", () => {
    it("handles tool returning plain string", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "greet",
        "Say hello",
        schema,
        async () => "Hello, World!"
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"greet","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content).toEqual([
        { type: "text", text: "Hello, World!" },
      ]);
    });
  });

  describe("Image helper return type", () => {
    it("handles tool returning Image instance", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const base64Data = "iVBORw0KGgo=";
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "get-image",
        "Get image",
        schema,
        async () => Image.fromBase64(base64Data, "image/png")
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get-image","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content).toEqual([
        { type: "image", data: base64Data, mimeType: "image/png" },
      ]);
    });

    it("handles tool returning Image from bytes", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const pngData = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
      ]);
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "get-image",
        "Get image",
        schema,
        async () => Image.fromBytes(pngData)
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get-image","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content[0].type).toBe("image");
      expect(responses[1].result.content[0].mimeType).toBe("image/png");
    });
  });

  describe("Audio helper return type", () => {
    it("handles tool returning Audio instance", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const base64Data = "SUQzBAAAAAA=";
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "get-audio",
        "Get audio",
        schema,
        async () => Audio.fromBase64(base64Data, "audio/mpeg")
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get-audio","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content).toEqual([
        { type: "audio", data: base64Data, mimeType: "audio/mpeg" },
      ]);
    });
  });

  describe("File helper return type", () => {
    it("handles tool returning File instance (binary)", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "get-file",
        "Get file",
        schema,
        async () => File.fromBytes(data, "video/mp4")
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get-file","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content[0].type).toBe("resource");
      expect(responses[1].result.content[0].resource.mimeType).toBe("video/mp4");
      expect(responses[1].result.content[0].resource.blob).toBe(
        Buffer.from(data).toString("base64")
      );
    });

    it("handles tool returning File instance (text)", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "get-file",
        "Get file",
        schema,
        async () => File.fromText("Hello, world!", "text/plain")
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get-file","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content[0].type).toBe("resource");
      expect(responses[1].result.content[0].resource.mimeType).toBe("text/plain");
      expect(responses[1].result.content[0].resource.text).toBe("Hello, world!");
    });
  });

  describe("array return type", () => {
    it("handles tool returning array of strings", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "multi",
        "Multiple strings",
        schema,
        async () => ["First", "Second", "Third"]
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"multi","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content).toEqual([
        { type: "text", text: "First" },
        { type: "text", text: "Second" },
        { type: "text", text: "Third" },
      ]);
    });

    it("handles tool returning mixed array with Image", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "mixed",
        "Mixed content",
        schema,
        async () => [
          "Here is an image:",
          Image.fromBase64("iVBORw0KGgo=", "image/png"),
        ]
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"mixed","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content).toHaveLength(2);
      expect(responses[1].result.content[0]).toEqual({
        type: "text",
        text: "Here is an image:",
      });
      expect(responses[1].result.content[1]).toEqual({
        type: "image",
        data: "iVBORw0KGgo=",
        mimeType: "image/png",
      });
    });

    it("handles tool returning array with Image, Audio, and File", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "all",
        "All content types",
        schema,
        async () => [
          "Content:",
          Image.fromBase64("iVBORw0KGgo=", "image/png"),
          Audio.fromBase64("SUQzBAAAAAA=", "audio/mpeg"),
          File.fromText("data", "text/plain"),
        ]
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"all","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content).toHaveLength(4);
      expect(responses[1].result.content[0].type).toBe("text");
      expect(responses[1].result.content[1].type).toBe("image");
      expect(responses[1].result.content[2].type).toBe("audio");
      expect(responses[1].result.content[3].type).toBe("resource");
    });
  });

  describe("raw ContentBlock passthrough", () => {
    it("handles tool returning raw content block", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "raw",
        "Raw content",
        schema,
        async () => ({ type: "text", text: "raw block" })
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"raw","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content).toEqual([
        { type: "text", text: "raw block" },
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// testing.test.ts
// ---------------------------------------------------------------------------

describe("SDK Client integration", () => {
  let testPair: TestPair | null = null;

  afterEach(async () => {
    if (testPair) {
      await testPair.cleanup();
      testPair = null;
    }
  });

  describe("initialization", () => {
    it("completes initialize handshake with SDK Client", async () => {
      const server = createServer({ name: "test-server", version: "1.0.0" });
      testPair = await createTestPair(server);

      const serverInfo = testPair.client.getServerVersion();
      expect(serverInfo?.name).toBe("test-server");
      expect(serverInfo?.version).toBe("1.0.0");
    });

    it("returns correct server info with special characters", async () => {
      const server = createServer({
        name: "test-server-with-dashes",
        version: "1.0.0-beta.1+build.123"
      });
      testPair = await createTestPair(server);

      const serverInfo = testPair.client.getServerVersion();
      expect(serverInfo?.name).toBe("test-server-with-dashes");
      expect(serverInfo?.version).toBe("1.0.0-beta.1+build.123");
    });

    it("client receives tools capability", async () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      testPair = await createTestPair(server);

      const capabilities = testPair.client.getServerCapabilities();
      expect(capabilities?.tools).toBeDefined();
    });
  });

  describe("tools/list", () => {
    it("lists tools via SDK Client", async () => {
      const schema = defineSchema({
        name: { type: "string", description: "Name to greet" }
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "greet",
        "Say hello",
        schema,
        async (args) => `Hello, ${args.name}!`
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.listTools();

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe("greet");
      expect(result.tools[0].description).toBe("Say hello");
      expect(result.tools[0].inputSchema).toBeDefined();
    });

    it("returns empty tools array when no tools registered", async () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      testPair = await createTestPair(server);

      const result = await testPair.client.listTools();
      expect(result.tools).toEqual([]);
    });

    it("lists many tools", async () => {
      const schema = defineSchema({});
      let server = createServer({ name: "test", version: "1.0.0" });

      for (let i = 0; i < 20; i++) {
        server = server.tool(`tool${i}`, `Tool number ${i}`, schema, async () => String(i));
      }

      testPair = await createTestPair(server);
      const result = await testPair.client.listTools();

      expect(result.tools).toHaveLength(20);
    });

    it("returns correct schema for each tool", async () => {
      const schema1 = defineSchema({
        name: { type: "string", description: "User name" }
      });
      const schema2 = defineSchema({
        count: { type: "number" },
        enabled: { type: "boolean", optional: true }
      });

      const server = createServer({ name: "test", version: "1.0.0" })
        .tool("tool1", "First", schema1, async () => "")
        .tool("tool2", "Second", schema2, async () => "");

      testPair = await createTestPair(server);
      const result = await testPair.client.listTools();

      const tool1 = result.tools.find((t) => t.name === "tool1");
      const tool2 = result.tools.find((t) => t.name === "tool2");

      expect(tool1?.inputSchema.properties?.name?.type).toBe("string");
      expect(tool1?.inputSchema.required).toContain("name");

      expect(tool2?.inputSchema.properties?.count?.type).toBe("number");
      expect(tool2?.inputSchema.properties?.enabled?.type).toBe("boolean");
      expect(tool2?.inputSchema.required).toContain("count");
      expect(tool2?.inputSchema.required).not.toContain("enabled");
    });
  });

  describe("tools/call", () => {
    it("calls tools via SDK Client", async () => {
      const schema = defineSchema({
        name: { type: "string" }
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "greet",
        "Say hello",
        schema,
        async (args) => `Hello, ${args.name}!`
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "greet",
        arguments: { name: "World" }
      });

      expect(result.content).toEqual([{ type: "text", text: "Hello, World!" }]);
    });

    it("calls tool with empty arguments", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "noop",
        "No-op tool",
        schema,
        async () => "done"
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "noop",
        arguments: {}
      });

      expect(result.content).toEqual([{ type: "text", text: "done" }]);
    });

    it("serializes object tool results to JSON text", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "structured",
        "Structured result",
        schema,
        async () => ({ sessionId: "session-1", pid: 1234 })
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "structured",
        arguments: {}
      });

      expect(result.content).toEqual([
        { type: "text", text: '{"sessionId":"session-1","pid":1234}' }
      ]);
    });

    it("allows tools to return no content", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "empty",
        "Empty result",
        schema,
        async () => undefined
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "empty",
        arguments: {}
      });

      expect(result.content).toEqual([]);
    });

    it("passes complex arguments correctly", async () => {
      const schema = defineSchema({
        str: { type: "string" },
        num: { type: "number" },
        bool: { type: "boolean" }
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "complex",
        "Complex args",
        schema,
        async (args) => `str=${args.str}, num=${args.num}, bool=${args.bool}`
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "complex",
        arguments: { str: "test", num: 42, bool: true }
      });

      expect(result.content).toEqual([{ type: "text", text: "str=test, num=42, bool=true" }]);
    });

    it("handles numeric calculations", async () => {
      const schema = defineSchema({
        a: { type: "number" },
        b: { type: "number" }
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "add",
        "Add numbers",
        schema,
        async (args) => String(args.a + args.b)
      );

      testPair = await createTestPair(server);

      const result1 = await testPair.client.callTool({
        name: "add",
        arguments: { a: 2, b: 3 }
      });
      expect(result1.content).toEqual([{ type: "text", text: "5" }]);

      const result2 = await testPair.client.callTool({
        name: "add",
        arguments: { a: -10, b: 5 }
      });
      expect(result2.content).toEqual([{ type: "text", text: "-5" }]);

      const result3 = await testPair.client.callTool({
        name: "add",
        arguments: { a: 0.1, b: 0.2 }
      });
      expect(parseFloat((result3.content[0] as { text: string }).text)).toBeCloseTo(0.3);
    });

    it("handles string with special characters", async () => {
      const schema = defineSchema({ text: { type: "string" } });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "echo",
        "Echo text",
        schema,
        async (args) => args.text
      );

      testPair = await createTestPair(server);

      const specialStrings = [
        'Contains "quotes"',
        "Has\nnewlines",
        "Has\ttabs",
        "Unicode: 日本語",
        "Emoji: 🎉",
        "Backslash: \\",
        'Mixed: "hello"\n\tworld\\end'
      ];

      for (const str of specialStrings) {
        const result = await testPair.client.callTool({
          name: "echo",
          arguments: { text: str }
        });
        expect(result.content).toEqual([{ type: "text", text: str }]);
      }
    });
  });

  describe("tool schema validation", () => {
    it("validates tool schema accepted by SDK Client", async () => {
      const schema = defineSchema({
        strField: { type: "string", description: "A string" },
        numField: { type: "number", optional: true },
        boolField: { type: "boolean", optional: true }
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "typed",
        "Typed tool",
        schema,
        async () => "ok"
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.listTools();

      const tool = result.tools[0];
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
      expect(tool.inputSchema.required).toContain("strField");
    });

    it("schema includes all property types", async () => {
      const schema = defineSchema({
        str: { type: "string" },
        num: { type: "number" },
        bool: { type: "boolean" },
        obj: { type: "object" },
        arr: { type: "array" }
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "allTypes",
        "All types",
        schema,
        async () => "ok"
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.listTools();

      const tool = result.tools[0];
      expect(tool.inputSchema.properties?.str?.type).toBe("string");
      expect(tool.inputSchema.properties?.num?.type).toBe("number");
      expect(tool.inputSchema.properties?.bool?.type).toBe("boolean");
      expect(tool.inputSchema.properties?.obj?.type).toBe("object");
      expect(tool.inputSchema.properties?.arr?.type).toBe("array");
    });

    it("schema includes descriptions", async () => {
      const schema = defineSchema({
        name: { type: "string", description: "The user's name" },
        age: { type: "number", description: "Age in years" }
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "user",
        "User tool",
        schema,
        async () => "ok"
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.listTools();

      const tool = result.tools[0];
      expect(tool.inputSchema.properties?.name?.description).toBe("The user's name");
      expect(tool.inputSchema.properties?.age?.description).toBe("Age in years");
    });
  });

  describe("tool error handling", () => {
    it("handles tool errors via SDK Client", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "fail",
        "Always fails",
        schema,
        async () => {
          throw new Error("Intentional failure");
        }
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "fail",
        arguments: {}
      });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: "Error: Intentional failure" }]);
    });

    it("handles async rejection", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "reject",
        "Rejects",
        schema,
        async () => {
          await Promise.resolve();
          throw new Error("Async rejection");
        }
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "reject",
        arguments: {}
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("Async rejection");
    });

    it("handles sync throw", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "syncFail",
        "Sync fail",
        schema,
        () => {
          throw new Error("Sync throw");
        }
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "syncFail",
        arguments: {}
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("Sync throw");
    });
  });

  describe("multiple content items", () => {
    it("returns multiple content items", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "multi",
        "Multiple items",
        schema,
        async () => [
          { type: "text", text: "First" } as const,
          { type: "text", text: "Second" } as const
        ]
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "multi",
        arguments: {}
      });

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({ type: "text", text: "First" });
      expect(result.content[1]).toEqual({ type: "text", text: "Second" });
    });

    it("returns many content items", async () => {
      const schema = defineSchema({});
      const items = Array.from({ length: 10 }, (_, i) => ({
        type: "text" as const,
        text: `Item ${i}`
      }));
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "many",
        "Many items",
        schema,
        async () => items
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "many",
        arguments: {}
      });

      expect(result.content).toHaveLength(10);
      for (let i = 0; i < 10; i++) {
        expect(result.content[i]).toEqual({ type: "text", text: `Item ${i}` });
      }
    });

    it("returns single item via text shorthand", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "single",
        "Single text",
        schema,
        async () => "Just one"
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "single",
        arguments: {}
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({ type: "text", text: "Just one" });
    });
  });

  describe("multiple tools", () => {
    it("supports multiple tools", async () => {
      const schema1 = defineSchema({
        a: { type: "number" },
        b: { type: "number" }
      });
      const schema2 = defineSchema({ name: { type: "string" } });

      const server = createServer({ name: "test", version: "1.0.0" })
        .tool("add", "Add numbers", schema1, async (args) => String(args.a + args.b))
        .tool("greet", "Say hello", schema2, async (args) => `Hi ${args.name}`);

      testPair = await createTestPair(server);

      const addResult = await testPair.client.callTool({
        name: "add",
        arguments: { a: 2, b: 3 }
      });
      expect(addResult.content).toEqual([{ type: "text", text: "5" }]);

      const greetResult = await testPair.client.callTool({
        name: "greet",
        arguments: { name: "Alice" }
      });
      expect(greetResult.content).toEqual([{ type: "text", text: "Hi Alice" }]);
    });

    it("calls same tool multiple times", async () => {
      let callCount = 0;
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "counter",
        "Count calls",
        schema,
        async () => {
          callCount++;
          return String(callCount);
        }
      );

      testPair = await createTestPair(server);

      const result1 = await testPair.client.callTool({
        name: "counter",
        arguments: {}
      });
      expect(result1.content).toEqual([{ type: "text", text: "1" }]);

      const result2 = await testPair.client.callTool({
        name: "counter",
        arguments: {}
      });
      expect(result2.content).toEqual([{ type: "text", text: "2" }]);

      const result3 = await testPair.client.callTool({
        name: "counter",
        arguments: {}
      });
      expect(result3.content).toEqual([{ type: "text", text: "3" }]);
    });

    it("maintains separate state per tool", async () => {
      const counters = { tool1: 0, tool2: 0 };
      const schema = defineSchema({});

      const server = createServer({ name: "test", version: "1.0.0" })
        .tool("tool1", "Tool 1", schema, async () => {
          counters.tool1++;
          return `tool1: ${counters.tool1}`;
        })
        .tool("tool2", "Tool 2", schema, async () => {
          counters.tool2++;
          return `tool2: ${counters.tool2}`;
        });

      testPair = await createTestPair(server);

      await testPair.client.callTool({ name: "tool1", arguments: {} });
      await testPair.client.callTool({ name: "tool1", arguments: {} });
      await testPair.client.callTool({ name: "tool2", arguments: {} });

      expect(counters.tool1).toBe(2);
      expect(counters.tool2).toBe(1);
    });
  });

  describe("async behavior", () => {
    it("handles delayed responses", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "delay",
        "Delayed",
        schema,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "delayed";
        }
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "delay",
        arguments: {}
      });

      expect(result.content).toEqual([{ type: "text", text: "delayed" }]);
    });

    it("handles sync handlers", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "sync",
        "Sync",
        schema,
        () => "sync"
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "sync",
        arguments: {}
      });

      expect(result.content).toEqual([{ type: "text", text: "sync" }]);
    });
  });

  describe("edge cases", () => {
    it("handles empty text response", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "empty",
        "Empty",
        schema,
        async () => ""
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "empty",
        arguments: {}
      });

      expect(result.content).toEqual([{ type: "text", text: "" }]);
    });

    it("handles very long text response", async () => {
      const longText = "x".repeat(100000);
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "long",
        "Long response",
        schema,
        async () => longText
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "long",
        arguments: {}
      });

      expect((result.content[0] as { text: string }).text).toBe(longText);
    });

    it("handles tool with long name", async () => {
      const longName = "a".repeat(100);
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        longName,
        "Long name tool",
        schema,
        async () => "ok"
      );

      testPair = await createTestPair(server);
      const listResult = await testPair.client.listTools();
      expect(listResult.tools[0].name).toBe(longName);

      const callResult = await testPair.client.callTool({
        name: longName,
        arguments: {}
      });
      expect(callResult.content).toEqual([{ type: "text", text: "ok" }]);
    });

    it("handles tool with unicode name", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "工具",
        "Unicode tool",
        schema,
        async () => "ok"
      );

      testPair = await createTestPair(server);
      const listResult = await testPair.client.listTools();
      expect(listResult.tools[0].name).toBe("工具");
    });
  });
});

describe("createTestPair", () => {
  it("creates connected client and server", async () => {
    const server = createServer({ name: "test", version: "1.0.0" });
    const pair = await createTestPair(server);

    expect(pair.client).toBeDefined();
    expect(pair.cleanup).toBeDefined();
    expect(typeof pair.cleanup).toBe("function");

    await pair.cleanup();
  });

  it("cleanup function can be called multiple times safely", async () => {
    const server = createServer({ name: "test", version: "1.0.0" });
    const pair = await createTestPair(server);

    await pair.cleanup();
    await pair.cleanup();
    await pair.cleanup();
  });
});

describe("removeTool via SDK", () => {
  let testPair: TestPair | null = null;

  afterEach(async () => {
    if (testPair) {
      await testPair.cleanup();
      testPair = null;
    }
  });

  it("removes tool and reflects in tools/list", async () => {
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" })
      .tool("tool1", "First", schema, async () => "1")
      .tool("tool2", "Second", schema, async () => "2");

    testPair = await createTestPair(server);

    const before = await testPair.client.listTools();
    expect(before.tools).toHaveLength(2);

    const removed = server.removeTool("tool1");
    expect(removed).toBe(true);

    const after = await testPair.client.listTools();
    expect(after.tools).toHaveLength(1);
    expect(after.tools[0].name).toBe("tool2");
  });

  it("calling removed tool returns error", async () => {
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "test",
      "Test",
      schema,
      async () => "ok"
    );

    testPair = await createTestPair(server);

    // Call tool successfully first
    const before = await testPair.client.callTool({
      name: "test",
      arguments: {}
    });
    expect(before.content).toEqual([{ type: "text", text: "ok" }]);

    // Remove the tool
    server.removeTool("test");

    // Calling again should fail
    await expect(testPair.client.callTool({ name: "test", arguments: {} })).rejects.toThrow();
  });
});

describe("dynamic tool management via SDK", () => {
  let testPair: TestPair | null = null;

  afterEach(async () => {
    if (testPair) {
      await testPair.cleanup();
      testPair = null;
    }
  });

  it("adding tool dynamically reflects in tools/list", async () => {
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" });

    testPair = await createTestPair(server);

    // Initially no tools
    const before = await testPair.client.listTools();
    expect(before.tools).toHaveLength(0);

    // Add tool dynamically
    server.tool("dynamic", "Dynamic tool", schema, async () => "dynamic");

    // Verify tool is now available
    const after = await testPair.client.listTools();
    expect(after.tools).toHaveLength(1);
    expect(after.tools[0].name).toBe("dynamic");
  });

  it("dynamically added tool is callable", async () => {
    const schema = defineSchema({ msg: { type: "string" } });
    const server = createServer({ name: "test", version: "1.0.0" });

    testPair = await createTestPair(server);

    // Add tool dynamically
    server.tool("echo", "Echo message", schema, async (args) => args.msg);

    // Call the dynamically added tool
    const result = await testPair.client.callTool({
      name: "echo",
      arguments: { msg: "hello" }
    });

    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("removing tool reflects in tools/list", async () => {
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "test",
      "Test",
      schema,
      async () => "ok"
    );

    testPair = await createTestPair(server);

    // Initially one tool
    const before = await testPair.client.listTools();
    expect(before.tools).toHaveLength(1);

    // Remove tool
    server.removeTool("test");

    // Verify tool is removed
    const after = await testPair.client.listTools();
    expect(after.tools).toHaveLength(0);
  });
});

describe("listChanged capability via SDK", () => {
  let testPair: TestPair | null = null;

  afterEach(async () => {
    if (testPair) {
      await testPair.cleanup();
      testPair = null;
    }
  });

  it("client receives listChanged capability", async () => {
    const server = createServer({ name: "test", version: "1.0.0" });
    testPair = await createTestPair(server);

    const capabilities = testPair.client.getServerCapabilities();
    expect(capabilities?.tools?.listChanged).toBe(true);
  });
});
