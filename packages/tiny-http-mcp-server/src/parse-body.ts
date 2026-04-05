import type { IncomingMessage } from "node:http";
import { parseMessage } from "tiny-stdio-mcp-server/jsonrpc";
import type {
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
} from "tiny-stdio-mcp-server";

export interface ClassifiedBody {
  messages: JSONRPCMessage[];
  hasRequests: boolean;
  hasNotifications: boolean;
  hasResponses: boolean;
  requests: JSONRPCRequest[];
  notifications: JSONRPCNotification[];
  responses: JSONRPCResponse[];
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

async function readStreamBody(req: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of req as AsyncIterable<unknown>) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    if (chunk instanceof Uint8Array) {
      chunks.push(chunk);
      continue;
    }

    chunks.push(Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readRawBody(
  req: IncomingMessage,
  preParsed?: unknown
): Promise<unknown> {
  if (preParsed !== undefined) {
    return preParsed;
  }

  const reqWithBody = req as IncomingMessage & { body?: unknown };
  if (reqWithBody.body !== undefined) {
    return reqWithBody.body;
  }

  const raw = await readStreamBody(req);

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Parse error");
  }
}

function toMessageList(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      throw new Error("Invalid Request");
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
  preParsed?: unknown
): Promise<ClassifiedBody> {
  const body = await readRawBody(req, preParsed);
  const inputMessages = toMessageList(body);
  const requests: JSONRPCRequest[] = [];
  const notifications: JSONRPCNotification[] = [];
  const responses: JSONRPCResponse[] = [];
  const messages: JSONRPCMessage[] = [];

  for (const message of inputMessages) {
    if (isValidResponse(message)) {
      responses.push(message);
      messages.push(message);
      continue;
    }

    if (hasResponseFields(message)) {
      throw new Error("Invalid Request");
    }

    const parsed = parseMessage(JSON.stringify(message));

    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    if (parsed.isNotification) {
      const notification = parsed.request as JSONRPCNotification;
      notifications.push(notification);
      messages.push(notification);
      continue;
    }

    const request = parsed.request as JSONRPCRequest;
    requests.push(request);
    messages.push(request);
  }

  return {
    messages,
    hasRequests: requests.length > 0,
    hasNotifications: notifications.length > 0,
    hasResponses: responses.length > 0,
    requests,
    notifications,
    responses,
  };
}
