// JSON-RPC 2.0 types
export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

// JSON-RPC error codes
export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
} as const;

export class ToolError extends Error {
  constructor(
    public readonly code: number,
    message: string
  ) {
    super(message);
    this.name = "ToolError";
  }
}

// MCP protocol types
export interface ToolsCapability {
  listChanged?: boolean;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: ToolsCapability;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface CallToolResult {
  content: ContentItem[];
  isError?: boolean;
}

export interface HandleResult {
  result?: unknown;
  error?: { code: number; message: string };
}

// ContentItem is a union of all possible content block types
export type ContentItem =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | {
      type: "resource";
      resource:
        | { uri: string; mimeType: string; text: string }
        | { uri: string; mimeType: string; blob: string };
    };

export interface JSONSchema {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface JSONSchemaProperty {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
}

// Server types
export interface ServerOptions {
  name: string;
  version: string;
}

import type { ToolReturn } from "./content/index.js";

export type ToolHandler<T = Record<string, unknown>> = (
  args: T
) => Promise<ToolReturn | CallToolResult> | ToolReturn | CallToolResult;

export interface ToolDefinition<T = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: ToolHandler<T>;
}

// Transport types
export interface Transport {
  readable: NodeJS.ReadableStream;
  writable: NodeJS.WritableStream;
}

// SDK-compatible transport interface
export interface SDKTransport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  start: () => Promise<void>;
  close: () => Promise<void>;
  send: (message: JSONRPCMessage) => Promise<void>;
}

export type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

export interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}
