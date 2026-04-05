import type { IncomingMessage, ServerResponse } from "node:http";
import type { JSONRPCMessage, JSONRPCRequest, Server } from "tiny-stdio-mcp-server";
import { JSON_RPC_ERROR_CODES } from "tiny-stdio-mcp-server";
import {
  formatErrorResponse,
  formatSuccessResponse,
} from "tiny-stdio-mcp-server/jsonrpc";
import { readAndClassifyBody } from "./parse-body.js";
import { createSessionStore, defaultSessionIdGenerator } from "./session.js";
import { formatSseEvent, SSE_HEADERS } from "./sse.js";

export interface StreamableHttpTransportOptions {
  sessionIdGenerator?: (() => string) | undefined;
  enableJsonResponse?: boolean;
}

const ALLOWED_METHODS = "POST, GET, DELETE";
const MCP_SESSION_ID_HEADER = "Mcp-Session-Id";

export class StreamableHttpTransport {
  private readonly sessionIdGenerator: (() => string) | undefined;
  private readonly enableJsonResponse: boolean;
  private readonly sessionStore = createSessionStore();
  private readonly sseStreams = new Map<string, Set<ServerResponse>>();
  private notificationUnsubscribe: (() => void) | undefined;

  constructor(
    private readonly server: Server,
    options: StreamableHttpTransportOptions = {}
  ) {
    this.sessionIdGenerator =
      Object.prototype.hasOwnProperty.call(options, "sessionIdGenerator")
        ? options.sessionIdGenerator
        : defaultSessionIdGenerator;
    this.enableJsonResponse = options.enableJsonResponse ?? false;
    this.notificationUnsubscribe = this.server.onNotification((notification) => {
      const event = formatSseEvent({ data: JSON.stringify(notification) });

      for (const streams of this.sseStreams.values()) {
        for (const response of streams) {
          if (!response.writableEnded) {
            response.write(event);
          }
        }
      }
    });
  }

  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    switch (req.method) {
      case "POST":
        await this.handlePost(req, res);
        return;
      case "GET":
        this.handleGet(req, res);
        return;
      case "DELETE":
        this.handleDelete(req, res);
        return;
      default:
        this.respondWithStatus(res, 405, undefined, {
          Allow: ALLOWED_METHODS,
        });
    }
  }

  async close(): Promise<void> {
    if (this.notificationUnsubscribe !== undefined) {
      this.notificationUnsubscribe();
      this.notificationUnsubscribe = undefined;
    }

    for (const sessionId of [...this.sseStreams.keys()]) {
      this.closeStreamsForSession(sessionId);
    }
  }

  private async handlePost(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    if (!this.isJsonRequest(req)) {
      this.respondWithJsonRpcError(
        res,
        400,
        JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        "Invalid Request"
      );
      return;
    }

    let classified;
    try {
      classified = await readAndClassifyBody(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Request";
      const code =
        message === "Parse error"
          ? JSON_RPC_ERROR_CODES.PARSE_ERROR
          : JSON_RPC_ERROR_CODES.INVALID_REQUEST;

      this.respondWithJsonRpcError(res, 400, code, message);
      return;
    }

    const initMessage = classified.messages.find(
      (message) => "method" in message && message.method === "initialize"
    );
    let sessionId: string | undefined;

    if (this.sessionIdGenerator !== undefined) {
      const headerSessionId = this.readSessionId(req);

      if (headerSessionId === undefined) {
        if (initMessage === undefined) {
          this.respondWithStatus(res, 400);
          return;
        }

        sessionId = this.sessionIdGenerator();
        this.sessionStore.create(sessionId);
      } else if (!this.sessionStore.has(headerSessionId)) {
        this.respondWithStatus(res, 404);
        return;
      } else {
        sessionId = headerSessionId;
      }
    }

    const formattedResponses: string[] = [];

    for (const message of classified.messages) {
      if (!("method" in message)) {
        continue;
      }

      const { error, result } = await this.server.handleMessage(
        message.method,
        message.params
      );

      if (message.method === "initialize" && sessionId !== undefined) {
        const session = this.sessionStore.get(sessionId);
        if (session !== undefined) {
          session.initialized = error === undefined;
        }
      }

      if (!this.isRequest(message)) {
        continue;
      }

      if (error !== undefined) {
        formattedResponses.push(formatErrorResponse(message.id, error));
        continue;
      }

      if (result !== undefined) {
        formattedResponses.push(formatSuccessResponse(message.id, result));
      }
    }

    if (formattedResponses.length === 0) {
      this.respondWithStatus(res, 202, sessionId);
      return;
    }

    if (this.enableJsonResponse) {
      const body =
        formattedResponses.length === 1
          ? formattedResponses[0]
          : JSON.stringify(
              formattedResponses.map((responseText) => JSON.parse(responseText))
            );

      this.respondWithStatus(
        res,
        200,
        sessionId,
        { "Content-Type": "application/json" },
        body
      );
      return;
    }

    res.writeHead(200, this.withSessionHeader(SSE_HEADERS, sessionId));
    for (const formattedResponse of formattedResponses) {
      res.write(formatSseEvent({ data: formattedResponse }));
    }
    res.end();
  }

  private handleGet(req: IncomingMessage, res: ServerResponse): void {
    if (this.sessionIdGenerator === undefined) {
      this.respondWithStatus(res, 405, undefined, {
        Allow: ALLOWED_METHODS,
      });
      return;
    }

    const sessionId = this.readSessionId(req);
    if (sessionId === undefined) {
      this.respondWithStatus(res, 400);
      return;
    }

    if (!this.sessionStore.has(sessionId)) {
      this.respondWithStatus(res, 404);
      return;
    }

    let streams = this.sseStreams.get(sessionId);
    if (streams === undefined) {
      streams = new Set();
      this.sseStreams.set(sessionId, streams);
    }

    streams.add(res);
    const cleanup = () => {
      const activeStreams = this.sseStreams.get(sessionId);
      if (activeStreams === undefined) {
        return;
      }

      activeStreams.delete(res);
      if (activeStreams.size === 0) {
        this.sseStreams.delete(sessionId);
      }
    };

    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("finish", cleanup);
    res.writeHead(200, this.withSessionHeader(SSE_HEADERS, sessionId));
    res.flushHeaders();
  }

  private handleDelete(req: IncomingMessage, res: ServerResponse): void {
    if (this.sessionIdGenerator === undefined) {
      this.respondWithStatus(res, 405, undefined, {
        Allow: ALLOWED_METHODS,
      });
      return;
    }

    const sessionId = this.readSessionId(req);
    if (sessionId === undefined) {
      this.respondWithStatus(res, 400);
      return;
    }

    if (!this.sessionStore.delete(sessionId)) {
      this.respondWithStatus(res, 404);
      return;
    }

    this.closeStreamsForSession(sessionId);
    this.respondWithStatus(res, 204);
  }

  private readSessionId(req: IncomingMessage): string | undefined {
    const value = req.headers["mcp-session-id"];
    const id = Array.isArray(value) ? value[0] : value;
    return id !== undefined && id.length > 0 ? id : undefined;
  }

  private closeStreamsForSession(sessionId: string): void {
    const streams = this.sseStreams.get(sessionId);
    if (streams === undefined) {
      return;
    }

    for (const response of streams) {
      if (!response.writableEnded) {
        response.end();
      }
    }

    this.sseStreams.delete(sessionId);
  }

  private isJsonRequest(req: IncomingMessage): boolean {
    const contentType = req.headers["content-type"];

    if (contentType === undefined) {
      return true;
    }

    const value = Array.isArray(contentType) ? contentType[0] : contentType;
    const type = value.split(";")[0]?.trim().toLowerCase();

    return type === "application/json";
  }

  private isRequest(message: JSONRPCMessage): message is JSONRPCRequest {
    return "method" in message && "id" in message;
  }

  private respondWithJsonRpcError(
    res: ServerResponse,
    statusCode: number,
    errorCode: number,
    message: string
  ): void {
    this.respondWithStatus(
      res,
      statusCode,
      undefined,
      { "Content-Type": "application/json" },
      formatErrorResponse(null, { code: errorCode, message })
    );
  }

  private respondWithStatus(
    res: ServerResponse,
    statusCode: number,
    sessionId?: string,
    headers?: Record<string, string>,
    body?: string
  ): void {
    res.writeHead(statusCode, this.withSessionHeader(headers, sessionId));
    res.end(body);
  }

  private withSessionHeader(
    headers: Record<string, string> | undefined,
    sessionId: string | undefined
  ): Record<string, string> {
    if (sessionId === undefined) {
      return headers ?? {};
    }

    return {
      ...(headers ?? {}),
      [MCP_SESSION_ID_HEADER]: sessionId,
    };
  }
}
