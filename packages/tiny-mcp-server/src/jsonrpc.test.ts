import { describe, it, expect } from "vitest";
import {
  parseMessage,
  formatSuccessResponse,
  formatErrorResponse,
} from "./jsonrpc.js";
import { JSON_RPC_ERROR_CODES } from "./types.js";

describe("parseMessage", () => {
  describe("valid requests", () => {
    it("parses valid JSON-RPC request with numeric id", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":1,"method":"ping"}');

      expect(result.success).toBe(true);
      if (result.success) {
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
      if (result.success) {
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
      if (result.success) {
        expect(result.request.id).toBe(0);
      }
    });

    it("parses request with negative id", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":-1,"method":"test"}');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.id).toBe(-1);
      }
    });

    it("parses request with large id", () => {
      const result = parseMessage(
        '{"jsonrpc":"2.0","id":9007199254740991,"method":"test"}'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.id).toBe(9007199254740991);
      }
    });

    it("parses request with empty string id", () => {
      const result = parseMessage('{"jsonrpc":"2.0","id":"","method":"test"}');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.id).toBe("");
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
