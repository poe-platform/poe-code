import type { Readable, Writable } from "node:stream";
import { AcpError, type RequestId } from "./types.js";
export interface JsonRpcRequestMessage {
  jsonrpc: "2.0";
  id: RequestId;
  method: string;
  params?: unknown;
}
export interface JsonRpcNotificationMessage {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}
export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}
export interface JsonRpcSuccessResponseMessage {
  jsonrpc: "2.0";
  id: RequestId;
  result: unknown;
}
export interface JsonRpcErrorResponseMessage {
  jsonrpc: "2.0";
  id: RequestId;
  error: JsonRpcErrorObject;
}
export type JsonRpcResponseMessage = JsonRpcSuccessResponseMessage | JsonRpcErrorResponseMessage;
export type JsonRpcOutgoingMessage =
  JsonRpcRequestMessage | JsonRpcNotificationMessage | JsonRpcResponseMessage;
export type ParsedJsonRpcMessage =
  | {
      type: "request";
      message: JsonRpcRequestMessage;
    }
  | {
      type: "notification";
      message: JsonRpcNotificationMessage;
    }
  | {
      type: "response";
      message: JsonRpcResponseMessage;
    }
  | {
      type: "invalid";
      id: RequestId;
      error: AcpError;
    };
export interface JsonRpcRequestOptions {
  id?: RequestId;
}
export interface JsonRpcMessageLayerOptions {
  input: Readable;
  output: Writable;
  firstRequestId?: number;
}
export type JsonRpcRequestHandler = (
  params: unknown,
  context: {
    id: RequestId;
    method: string;
  }
) => Promise<unknown> | unknown;
export type JsonRpcNotificationHandler = (
  params: unknown,
  context: {
    method: string;
  }
) => Promise<void> | void;
export declare function createJsonRpcErrorResponse(
  id: RequestId,
  error: AcpError
): JsonRpcErrorResponseMessage;
export declare function serializeJsonRpcMessage(message: JsonRpcOutgoingMessage): string;
export declare function parseJsonRpcMessage(line: string): ParsedJsonRpcMessage;
export declare class JsonRpcMessageLayer {
  constructor(options: JsonRpcMessageLayerOptions);
  onRequest(method: string, handler: JsonRpcRequestHandler): void;
  onNotification(method: string, handler: JsonRpcNotificationHandler): void;
  pendingRequestCount(): number;
  sendNotification(method: string, params?: unknown): void;
  sendRequest(method: string, params?: unknown, options?: JsonRpcRequestOptions): Promise<unknown>;
  dispose(reason?: Error): void;
}
