import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import {
  ACP_ERROR_CODE_INTERNAL,
  ACP_ERROR_CODE_INVALID_REQUEST,
  ACP_ERROR_CODE_METHOD_NOT_FOUND,
  ACP_ERROR_CODE_PARSE,
  AcpError,
  isAcpError,
  isAcpErrorCode,
  type RequestId,
} from "./types.js";

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

export type JsonRpcResponseMessage =
  | JsonRpcSuccessResponseMessage
  | JsonRpcErrorResponseMessage;

export type JsonRpcOutgoingMessage =
  | JsonRpcRequestMessage
  | JsonRpcNotificationMessage
  | JsonRpcResponseMessage;

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
  context: { id: RequestId; method: string }
) => Promise<unknown> | unknown;

export type JsonRpcNotificationHandler = (
  params: unknown,
  context: { method: string }
) => Promise<void> | void;

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface JsonRpcResponseError extends Error {
  code: number;
  data?: unknown;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(
  value: Record<string, unknown>,
  property: string
): property is keyof typeof value {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function isRequestId(value: unknown): value is RequestId {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  );
}

function toRequestId(value: unknown): RequestId {
  return isRequestId(value) ? value : null;
}

function parseError(): AcpError {
  return new AcpError(ACP_ERROR_CODE_PARSE, "Parse error");
}

function invalidRequest(): AcpError {
  return new AcpError(ACP_ERROR_CODE_INVALID_REQUEST, "Invalid Request");
}

function methodNotFound(method: string): AcpError {
  return new AcpError(
    ACP_ERROR_CODE_METHOD_NOT_FOUND,
    `Method not found: "${method}"`
  );
}

function internalError(message: string): AcpError {
  return new AcpError(ACP_ERROR_CODE_INTERNAL, message);
}

function isJsonRpcErrorObject(value: unknown): value is JsonRpcErrorObject {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (!isAcpErrorCode(value.code) || typeof value.message !== "string") {
    return false;
  }

  return value.data === undefined || hasOwn(value, "data");
}

function toResponseError(error: JsonRpcErrorObject): JsonRpcResponseError {
  return new AcpError(error.code, error.message, error.data);
}

function toDispatchError(error: unknown): AcpError {
  if (error instanceof AcpError) {
    return error;
  }

  if (isAcpError(error)) {
    return new AcpError(error.code, error.message, error.data);
  }

  if (error instanceof Error && error.message.length > 0) {
    return internalError(error.message);
  }

  return internalError("Internal error");
}

function normalizeLine(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

async function* readLines(stream: Readable): AsyncGenerator<string> {
  let buffer = "";
  const decoder = new StringDecoder("utf8");

  for await (const chunk of stream as AsyncIterable<unknown>) {
    buffer += typeof chunk === "string"
      ? chunk
      : chunk instanceof Uint8Array
        ? decoder.write(Buffer.from(chunk))
        : String(chunk);

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      yield normalizeLine(line);
    }
  }

  buffer += decoder.end();

  if (buffer.length > 0) {
    yield normalizeLine(buffer);
  }
}

function createResponseMessage(
  id: RequestId,
  result: unknown
): JsonRpcSuccessResponseMessage {
  return {
    jsonrpc: "2.0",
    id,
    result: result === undefined ? null : result,
  };
}

export function createJsonRpcErrorResponse(
  id: RequestId,
  error: AcpError
): JsonRpcErrorResponseMessage {
  const response: JsonRpcErrorResponseMessage = {
    jsonrpc: "2.0",
    id,
    error: {
      code: error.code,
      message: error.message,
    },
  };

  if (error.data !== undefined) {
    response.error.data = error.data;
  }

  return response;
}

export function serializeJsonRpcMessage(message: JsonRpcOutgoingMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseJsonRpcMessage(line: string): ParsedJsonRpcMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {
      type: "invalid",
      id: null,
      error: parseError(),
    };
  }

  if (!isObjectRecord(parsed)) {
    return {
      type: "invalid",
      id: null,
      error: invalidRequest(),
    };
  }

  const id = toRequestId(parsed.id);

  if (parsed.jsonrpc !== "2.0") {
    return {
      type: "invalid",
      id,
      error: invalidRequest(),
    };
  }

  const hasMethod = hasOwn(parsed, "method");
  const hasId = hasOwn(parsed, "id");

  if (hasMethod) {
    if (typeof parsed.method !== "string") {
      return {
        type: "invalid",
        id,
        error: invalidRequest(),
      };
    }

    if (hasId) {
      if (!isRequestId(parsed.id)) {
        return {
          type: "invalid",
          id: null,
          error: invalidRequest(),
        };
      }

      const request: JsonRpcRequestMessage = {
        jsonrpc: "2.0",
        id: parsed.id,
        method: parsed.method,
      };

      if (hasOwn(parsed, "params")) {
        request.params = parsed.params;
      }

      return { type: "request", message: request };
    }

    const notification: JsonRpcNotificationMessage = {
      jsonrpc: "2.0",
      method: parsed.method,
    };

    if (hasOwn(parsed, "params")) {
      notification.params = parsed.params;
    }

    return {
      type: "notification",
      message: notification,
    };
  }

  if (!hasId || !isRequestId(parsed.id)) {
    return {
      type: "invalid",
      id,
      error: invalidRequest(),
    };
  }

  const hasResult = hasOwn(parsed, "result");
  const hasError = hasOwn(parsed, "error");

  if (hasResult === hasError) {
    return {
      type: "invalid",
      id: parsed.id,
      error: invalidRequest(),
    };
  }

  if (hasResult) {
    return {
      type: "response",
      message: {
        jsonrpc: "2.0",
        id: parsed.id,
        result: parsed.result,
      },
    };
  }

  if (!isJsonRpcErrorObject(parsed.error)) {
    return {
      type: "invalid",
      id: parsed.id,
      error: invalidRequest(),
    };
  }

  return {
    type: "response",
    message: {
      jsonrpc: "2.0",
      id: parsed.id,
      error: parsed.error,
    },
  };
}

export class JsonRpcMessageLayer {
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly requestHandlers = new Map<string, JsonRpcRequestHandler>();
  private readonly notificationHandlers = new Map<
    string,
    JsonRpcNotificationHandler
  >();
  private readonly pending = new Map<RequestId, PendingRequest>();
  private nextRequestId: number;
  private disposed = false;

  constructor(options: JsonRpcMessageLayerOptions) {
    this.input = options.input;
    this.output = options.output;
    this.nextRequestId = options.firstRequestId ?? 1;

    if (!Number.isSafeInteger(this.nextRequestId)) {
      throw new Error("firstRequestId must be a safe integer");
    }

    void this.consumeInput();
  }

  onRequest(method: string, handler: JsonRpcRequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: JsonRpcNotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  pendingRequestCount(): number {
    return this.pending.size;
  }

  sendNotification(method: string, params?: unknown): void {
    const notification: JsonRpcNotificationMessage = {
      jsonrpc: "2.0",
      method,
    };

    if (params !== undefined) {
      notification.params = params;
    }

    this.sendMessage(notification);
  }

  sendRequest(
    method: string,
    params?: unknown,
    options: JsonRpcRequestOptions = {}
  ): Promise<unknown> {
    if (this.disposed) {
      throw new Error("JSON-RPC message layer is disposed");
    }

    const id = options.id === undefined ? this.nextRequestId++ : options.id;

    if (!isRequestId(id)) {
      throw new Error("Request id must be null, a string, or a safe integer");
    }

    if (this.pending.has(id)) {
      throw new Error(`A request with id ${JSON.stringify(id)} is already pending`);
    }

    const request: JsonRpcRequestMessage = {
      jsonrpc: "2.0",
      id,
      method,
    };

    if (params !== undefined) {
      request.params = params;
    }

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        method,
        resolve,
        reject,
      });

      try {
        this.sendMessage(request);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  dispose(reason: Error = new Error("JSON-RPC message layer disposed")): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.rejectAllPending(reason);
  }

  private async consumeInput(): Promise<void> {
    try {
      for await (const line of readLines(this.input)) {
        if (this.disposed || line.length === 0) {
          continue;
        }

        void this.handleIncomingLine(line).catch((error: unknown) => {
          if (!this.disposed) {
            this.dispose(error instanceof Error ? error : new Error(String(error)));
          }
        });
      }

      if (!this.disposed) {
        this.dispose(new Error("JSON-RPC input stream closed"));
      }
    } catch (error) {
      if (!this.disposed) {
        this.dispose(
          error instanceof Error
            ? error
            : new Error(`JSON-RPC input stream failed: ${String(error)}`)
        );
      }
    }
  }

  private async handleIncomingLine(line: string): Promise<void> {
    const parsed = parseJsonRpcMessage(line);

    if (parsed.type === "invalid") {
      this.sendMessage(createJsonRpcErrorResponse(parsed.id, parsed.error));
      return;
    }

    if (parsed.type === "response") {
      this.handleResponse(parsed.message);
      return;
    }

    if (parsed.type === "notification") {
      await this.handleNotification(parsed.message);
      return;
    }

    await this.handleRequest(parsed.message);
  }

  private handleResponse(message: JsonRpcResponseMessage): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);

    if ("error" in message) {
      pending.reject(toResponseError(message.error));
      return;
    }

    pending.resolve(message.result);
  }

  private async handleRequest(message: JsonRpcRequestMessage): Promise<void> {
    const handler = this.requestHandlers.get(message.method);
    if (!handler) {
      this.sendMessage(createJsonRpcErrorResponse(message.id, methodNotFound(message.method)));
      return;
    }

    try {
      const result = await handler(message.params, {
        id: message.id,
        method: message.method,
      });
      this.sendMessage(createResponseMessage(message.id, result));
    } catch (error) {
      this.sendMessage(createJsonRpcErrorResponse(message.id, toDispatchError(error)));
    }
  }

  private async handleNotification(
    message: JsonRpcNotificationMessage
  ): Promise<void> {
    const handler = this.notificationHandlers.get(message.method);
    if (!handler) {
      return;
    }

    try {
      await handler(message.params, { method: message.method });
    } catch {
      // Notifications are fire-and-forget per JSON-RPC.
    }
  }

  private sendMessage(message: JsonRpcOutgoingMessage): void {
    if (this.disposed) {
      throw new Error("JSON-RPC message layer is disposed");
    }

    this.output.write(serializeJsonRpcMessage(message));
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }

    this.pending.clear();
  }
}
