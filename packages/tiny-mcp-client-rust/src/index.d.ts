export type RequestId = string | number;
export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: RequestId;
  method: string;
  params?: unknown;
}
export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}
export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: RequestId;
  result: unknown;
}
export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: RequestId;
  error: JsonRpcErrorObject;
}
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;
export type ParsedJsonRpcMessage =
  | { type: "request"; message: JsonRpcRequest }
  | { type: "notification"; message: JsonRpcNotification }
  | { type: "response"; message: JsonRpcResponse }
  | { type: "invalid"; id: RequestId | null; error: McpError };
export declare class McpError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown);
}
export declare function parseJsonRpcMessage(line: string): ParsedJsonRpcMessage;
export declare const ERROR_PARSE: -32700;
export declare const ERROR_INVALID_REQUEST: -32600;
export declare const ERROR_METHOD_NOT_FOUND: -32601;
export declare const ERROR_INVALID_PARAMS: -32602;
export declare const ERROR_INTERNAL: -32603;
