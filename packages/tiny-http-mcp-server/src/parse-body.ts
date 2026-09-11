import type { IncomingMessage } from "node:http";
import { parseMessage } from "tiny-stdio-mcp-server/jsonrpc";
import type {
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
} from "tiny-stdio-mcp-server";

export interface ClassifiedBody {
  entries: Array<JSONRPCMessage | null>;
  messages: JSONRPCMessage[];
  hasRequests: boolean;
  hasNotifications: boolean;
  hasResponses: boolean;
  requests: JSONRPCRequest[];
  notifications: JSONRPCNotification[];
  responses: JSONRPCResponse[];
}

export interface BodyReadOptions {
  maxBytes?: number;
  maxBatchSize?: number;
}

export class JsonRpcMessageError extends Error {
  constructor(
    readonly id: string | number | null,
    readonly code: number,
    message: string
  ) {
    super(message);
  }
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

function isValidResponse(value: unknown): value is JSONRPCResponse {
  if (!isObjectRecord(value) || value.jsonrpc !== "2.0" || hasOwn(value, "method")) {
    return false;
  }

  if (!hasOwn(value, "id")) {
    return false;
  }

  if (
    value.id !== null &&
    typeof value.id !== "string" &&
    typeof value.id !== "number"
  ) {
    return false;
  }

  const hasResult = hasOwn(value, "result");
  const hasError = hasOwn(value, "error");
  if (hasResult === hasError) {
    return false;
  }

  if (!hasError) {
    return true;
  }

  return (
    isObjectRecord(value.error) &&
    typeof value.error.code === "number" &&
    typeof value.error.message === "string"
  );
}

function hasResponseFields(value: unknown): boolean {
  return isObjectRecord(value) && (hasOwn(value, "result") || hasOwn(value, "error"));
}

async function readStreamBody(
  req: IncomingMessage,
  maxBytes: number | undefined
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for await (const chunk of req as AsyncIterable<unknown>) {
    let bytes: Uint8Array;
    if (typeof chunk === "string") {
      bytes = Buffer.from(chunk);
    } else if (chunk instanceof Uint8Array) {
      bytes = chunk;
    } else {
      bytes = Buffer.from(String(chunk));
    }

    totalBytes += bytes.byteLength;
    if (maxBytes !== undefined && totalBytes > maxBytes) {
      throw new Error("Payload too large");
    }
    chunks.push(bytes);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readRawBody(
  req: IncomingMessage,
  preParsed: unknown | undefined,
  options: BodyReadOptions
): Promise<unknown> {
  const reqWithBody = req as IncomingMessage & { body?: unknown };
  const body = preParsed !== undefined ? preParsed : reqWithBody.body;
  if (body !== undefined) {
    if (options.maxBytes !== undefined) {
      const serialized = JSON.stringify(body);
      if (serialized === undefined) {
        throw new Error("Invalid Request");
      }
      if (Buffer.byteLength(serialized, "utf8") > options.maxBytes) {
        throw new Error("Payload too large");
      }
    }
    return body;
  }

  const raw = await readStreamBody(req, options.maxBytes);

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Parse error");
  }
}

function toMessageList(body: unknown, maxBatchSize: number | undefined): unknown[] {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      throw new Error("Invalid Request");
    }

    if (maxBatchSize !== undefined && body.length > maxBatchSize) {
      throw new Error("Batch size exceeds configured limit");
    }

    return body;
  }

  if (isObjectRecord(body)) {
    return [body];
  }

  throw new Error("Invalid Request");
}

export async function readAndClassifyBody(
  req: IncomingMessage,
  preParsed?: unknown,
  options: BodyReadOptions = {}
): Promise<ClassifiedBody> {
  const body = await readRawBody(req, preParsed, options);
  const inputMessages = toMessageList(body, options.maxBatchSize);
  const isBatch = Array.isArray(body);
  const entries: Array<JSONRPCMessage | null> = [];
  const requests: JSONRPCRequest[] = [];
  const notifications: JSONRPCNotification[] = [];
  const responses: JSONRPCResponse[] = [];
  const messages: JSONRPCMessage[] = [];

  for (const message of inputMessages) {
    if (isValidResponse(message)) {
      responses.push(message);
      messages.push(message);
      entries.push(message);
      continue;
    }

    if (hasResponseFields(message)) {
      if (!isBatch) {
        throw new Error("Invalid Request");
      }

      entries.push(null);
      continue;
    }

    const parsed = parseMessage(JSON.stringify(message));

    if (!parsed.success) {
      if (!isBatch) {
        throw new JsonRpcMessageError(
          parsed.id,
          parsed.error.code,
          parsed.error.message
        );
      }

      entries.push(null);
      continue;
    }

    if (parsed.isNotification) {
      const notification = parsed.request as JSONRPCNotification;
      notifications.push(notification);
      messages.push(notification);
      entries.push(notification);
      continue;
    }

    const request = parsed.request as JSONRPCRequest;
    requests.push(request);
    messages.push(request);
    entries.push(request);
  }

  return {
    entries,
    messages,
    hasRequests: requests.length > 0,
    hasNotifications: notifications.length > 0,
    hasResponses: responses.length > 0,
    requests,
    notifications,
    responses,
  };
}
