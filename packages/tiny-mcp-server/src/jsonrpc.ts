import type { JSONRPCRequest, JSONRPCResponse, JSONRPCError } from "./types.js";
import { JSON_RPC_ERROR_CODES } from "./types.js";

export interface ParseResult {
  success: true;
  request: JSONRPCRequest;
}

export interface ParseError {
  success: false;
  error: JSONRPCError;
  id: string | number | null;
}

export function parseMessage(line: string): ParseResult | ParseError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {
      success: false,
      error: {
        code: JSON_RPC_ERROR_CODES.PARSE_ERROR,
        message: "Parse error",
      },
      id: null,
    };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return {
      success: false,
      error: {
        code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        message: "Invalid Request",
      },
      id: null,
    };
  }

  const obj = parsed as Record<string, unknown>;
  const id = typeof obj.id === "string" || typeof obj.id === "number" ? obj.id : null;

  if (obj.jsonrpc !== "2.0") {
    return {
      success: false,
      error: {
        code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        message: "Invalid Request",
      },
      id,
    };
  }

  if (typeof obj.method !== "string") {
    return {
      success: false,
      error: {
        code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        message: "Invalid Request",
      },
      id,
    };
  }

  return {
    success: true,
    request: {
      jsonrpc: "2.0",
      id: id as string | number,
      method: obj.method,
      params: obj.params as Record<string, unknown> | undefined,
    },
  };
}

export function formatSuccessResponse(
  id: string | number | null,
  result: unknown
): string {
  const response: JSONRPCResponse = {
    jsonrpc: "2.0",
    id,
    result,
  };
  return JSON.stringify(response);
}

export function formatErrorResponse(
  id: string | number | null,
  error: JSONRPCError
): string {
  const response: JSONRPCResponse = {
    jsonrpc: "2.0",
    id,
    error,
  };
  return JSON.stringify(response);
}
