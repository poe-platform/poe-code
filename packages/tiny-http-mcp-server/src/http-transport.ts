import { validateHeaderValue, type IncomingMessage, type ServerResponse } from "node:http";
import type { JSONRPCMessage, JSONRPCRequest, MessageSession, Server } from "tiny-stdio-mcp-server";
import { JSON_RPC_ERROR_CODES } from "tiny-stdio-mcp-server";
import {
  formatErrorResponse,
  formatSuccessResponse,
} from "tiny-stdio-mcp-server/jsonrpc";
import {
  JsonRpcMessageError,
  readAndClassifyBody,
} from "./parse-body.js";
import {
  createSessionStore,
  defaultSessionIdGenerator,
  type Session,
  type SessionStore,
} from "./session.js";
import { formatSseEvent, SSE_HEADERS } from "./sse.js";

export type HttpObservabilityEvent =
  | {
      type: "request.start";
      requestId: string;
      method: string;
      path: string;
      sessionId?: string;
    }
  | {
      type: "request.end";
      requestId: string;
      method: string;
      statusCode: number;
      durationMs: number;
      sessionId?: string;
    }
  | {
      type: "request.error";
      requestId: string;
      method: string;
      durationMs: number;
      error: unknown;
      sessionId?: string;
    }
  | {
      type: "auth.failure";
      statusCode: number;
      challenge: string;
      sessionId?: string;
    }
  | { type: "session.created"; sessionId: string }
  | { type: "session.deleted"; sessionId: string; reason: "client" | "expired" | "closed" }
  | { type: "stream.opened"; sessionId: string; streamCount: number }
  | { type: "stream.closed"; sessionId: string; streamCount: number }
  | {
      type: "tool.start";
      requestId: string;
      sessionId?: string;
      toolName?: string;
    }
  | {
      type: "tool.end";
      requestId: string;
      sessionId?: string;
      toolName?: string;
      ok: boolean;
      durationMs: number;
    };

export interface HttpObservabilityOptions {
  onEvent?(event: HttpObservabilityEvent): void;
}

export interface StreamableHttpTransportOptions {
  sessionIdGenerator?: (() => string) | undefined;
  enableJsonResponse?: boolean;
  allowedOrigins?: readonly string[];
  allowedHosts?: readonly string[];
  maxRequestBytes?: number;
  maxBatchSize?: number;
  maxSessions?: number;
  sessionTtlMs?: number;
  maxStreamsPerSession?: number;
  maxSseEventHistory?: number;
  maxConcurrentToolCalls?: number;
  sessionStore?: SessionStore;
  requestIdGenerator?: () => string;
  observability?: HttpObservabilityOptions;
  trustedProxy?: boolean;
}

type RequestContextRunner = <T>(
  req: IncomingMessage,
  callback: () => Promise<T>
) => Promise<T>;

const ALLOWED_METHODS = "POST, GET, DELETE, OPTIONS";
const MCP_SESSION_ID_HEADER = "Mcp-Session-Id";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"] as const;
const DEFAULT_ALLOWED_HEADERS = "Accept, Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version";

function validateOptionalIntegerOption(
  name: string,
  value: number | undefined,
  minimum: number
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }

  return value;
}

export class StreamableHttpTransport {
  private readonly sessionIdGenerator: (() => string) | undefined;
  private readonly enableJsonResponse: boolean;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly maxRequestBytes: number | undefined;
  private readonly maxBatchSize: number | undefined;
  private readonly maxSessions: number | undefined;
  private readonly sessionTtlMs: number | undefined;
  private readonly maxStreamsPerSession: number;
  private readonly maxSseEventHistory: number;
  private readonly maxConcurrentToolCalls: number | undefined;
  private readonly sessionStore: SessionStore;
  private readonly requestIdGenerator: () => string;
  private readonly observability: HttpObservabilityOptions;
  private readonly trustedProxy: boolean;
  private readonly sessionMessages = new Map<string, MessageSession>();
  private readonly sseStreams = new Map<string, Set<ServerResponse>>();
  private readonly sseEventHistory = new Map<
    string,
    Array<{ id: number; data: string }>
  >();
  private readonly responseRequestIds = new WeakMap<ServerResponse, string>();
  private readonly responseOrigins = new WeakMap<ServerResponse, string>();
  private nextNotificationEventId = 1;
  private nextRequestId = 1;
  private activeToolCalls = 0;

  constructor(
    private readonly server: Server,
    options: StreamableHttpTransportOptions = {},
    private readonly runWithRequestContext: RequestContextRunner = async (
      _req,
      callback
    ) => callback()
  ) {
    this.sessionIdGenerator =
      hasOwnProperty(options, "sessionIdGenerator")
        ? options.sessionIdGenerator
        : defaultSessionIdGenerator;
    this.enableJsonResponse = options.enableJsonResponse ?? false;
    this.allowedOrigins = new Set(options.allowedOrigins ?? []);
    this.allowedHosts = new Set(
      (options.allowedHosts ?? LOCAL_HOSTS).map((host) => this.normalizeHost(host))
    );
    this.maxRequestBytes = validateOptionalIntegerOption(
      "maxRequestBytes",
      options.maxRequestBytes,
      1
    );
    this.maxBatchSize = validateOptionalIntegerOption(
      "maxBatchSize",
      options.maxBatchSize,
      1
    );
    this.maxSessions = validateOptionalIntegerOption(
      "maxSessions",
      options.maxSessions,
      1
    );
    this.sessionTtlMs = validateOptionalIntegerOption(
      "sessionTtlMs",
      options.sessionTtlMs,
      1
    );
    this.maxStreamsPerSession = validateOptionalIntegerOption(
      "maxStreamsPerSession",
      options.maxStreamsPerSession,
      1
    ) ?? 1;
    this.maxSseEventHistory =
      validateOptionalIntegerOption(
        "maxSseEventHistory",
        options.maxSseEventHistory,
        0
      ) ?? 100;
    this.maxConcurrentToolCalls = validateOptionalIntegerOption(
      "maxConcurrentToolCalls",
      options.maxConcurrentToolCalls,
      1
    );
    this.sessionStore = options.sessionStore ?? createSessionStore();
    this.requestIdGenerator =
      options.requestIdGenerator ?? (() => `req-${this.nextRequestId++}`);
    this.observability = options.observability ?? {};
    this.trustedProxy = options.trustedProxy ?? false;
  }

  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const startedAt = Date.now();
    const requestId = this.readRequestId(req) ?? this.requestIdGenerator();
    this.responseRequestIds.set(res, requestId);
    const origin = this.readOrigin(req);
    if (origin !== undefined && this.acceptsOriginValue(req, origin)) {
      this.responseOrigins.set(res, origin);
    }
    this.emit({
      type: "request.start",
      requestId,
      method: req.method ?? "",
      path: req.url ?? "",
      sessionId: this.readSessionId(req),
    });

    try {
      this.purgeExpiredSessions();
    } catch {
      // Expiry cleanup must not make otherwise valid requests fail.
    }

    try {
      if (!this.acceptsHost(req) || !this.acceptsOrigin(req)) {
        this.respondWithStatus(res, 403);
        return;
      }

      switch (req.method) {
        case "POST":
          await this.handlePost(req, res);
          return;
        case "GET":
          await this.handleGet(req, res);
          return;
        case "DELETE":
          this.handleDelete(req, res);
          return;
        case "OPTIONS":
          this.handleOptions(req, res);
          return;
        default:
          this.respondWithStatus(res, 405, undefined, {
            Allow: ALLOWED_METHODS,
          });
      }
    } catch (error) {
      this.emit({
        type: "request.error",
        requestId,
        method: req.method ?? "",
        durationMs: Date.now() - startedAt,
        error,
        sessionId: this.readSessionId(req),
      });
      if (!res.headersSent) {
        this.respondWithStatus(res, 500);
      } else if (!res.writableEnded) {
        res.end();
      }
      return;
    } finally {
      this.emit({
        type: "request.end",
        requestId,
        method: req.method ?? "",
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        sessionId: this.readSessionId(req),
      });
    }
  }

  async close(): Promise<void> {
    for (const sessionId of [...this.sseStreams.keys()]) {
      this.closeStreamsForSession(sessionId);
    }

    for (const sessionId of [...this.sessionMessages.keys()]) {
      this.deleteSession(sessionId, "closed");
    }
    this.sessionMessages.clear();
  }

  private async handlePost(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    if (!this.isJsonRequest(req)) {
      this.respondWithJsonRpcError(
        res,
        415,
        JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        "Invalid Request"
      );
      return;
    }

    if (!this.acceptsConfiguredResponse(req)) {
      this.respondWithStatus(res, 406);
      return;
    }

    let classified;
    try {
      classified = await readAndClassifyBody(req, undefined, {
        maxBytes: this.maxRequestBytes,
        maxBatchSize: this.maxBatchSize,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Request";
      if (message === "Payload too large") {
        this.respondWithJsonRpcError(
          res,
          413,
          JSON_RPC_ERROR_CODES.INVALID_REQUEST,
          message
        );
        return;
      }
      const code =
        error instanceof JsonRpcMessageError
          ? error.code
          : message === "Parse error"
          ? JSON_RPC_ERROR_CODES.PARSE_ERROR
          : JSON_RPC_ERROR_CODES.INVALID_REQUEST;
      const id = error instanceof JsonRpcMessageError ? error.id : null;

      this.respondWithJsonRpcError(res, 400, code, message, id);
      return;
    }

    const initMessage = classified.messages.find(
      (message) => this.isRequest(message) && message.method === "initialize"
    );
    let sessionId: string | undefined;

    if (this.sessionIdGenerator !== undefined) {
      const headerSessionId = this.readSessionId(req);

      if (headerSessionId === undefined) {
        if (initMessage === undefined) {
          this.respondWithStatus(res, 400);
          return;
        }

        if (this.maxSessions !== undefined && this.sessionCount() >= this.maxSessions) {
          this.respondWithStatus(res, 503);
          return;
        }

        const newSessionId = this.sessionIdGenerator();
        if (!this.isValidNewSessionId(newSessionId)) {
          this.respondWithStatus(res, 500);
          return;
        }

        sessionId = newSessionId;
        this.sessionStore.create(newSessionId);
        this.emit({ type: "session.created", sessionId: newSessionId });
        this.createLocalMessageSession(newSessionId);
      } else {
        const session = this.getActiveSession(headerSessionId);
        if (session === undefined) {
          this.respondWithStatus(res, 404);
          return;
        }

        sessionId = headerSessionId;
        this.touchSession(sessionId);
        if (session?.protocolVersion !== undefined && !this.acceptsProtocolVersion(req, session.protocolVersion)) {
          this.respondWithStatus(res, 400);
          return;
        }
        await this.ensureLocalMessageSession(sessionId, session);
      }
    }

    const formattedResponses = await this.runWithRequestContext(req, async () => {
      const responses: string[] = [];

      for (const message of classified.entries) {
        if (message === null) {
          responses.push(formatErrorResponse(null, {
            code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
            message: "Invalid Request",
          }));
          continue;
        }

        if (!("method" in message)) {
          continue;
        }

        const session = sessionId === undefined ? undefined : this.sessionStore.get(sessionId);
        if (
          session !== undefined
          && message.method !== "initialize"
          && message.method !== "notifications/initialized"
          && message.method !== "ping"
          && !session.initialized
        ) {
          if (this.isRequest(message)) {
            responses.push(formatErrorResponse(message.id, {
              code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
              message: "Session not initialized",
            }));
          }
          continue;
        }

        const requestId = this.responseRequestIds.get(res) ?? "";
        const toolName = this.readToolName(message);
        if (
          message.method === "tools/call"
          && this.maxConcurrentToolCalls !== undefined
          && this.activeToolCalls >= this.maxConcurrentToolCalls
        ) {
          if (this.isRequest(message)) {
            responses.push(formatErrorResponse(message.id, {
              code: -32000,
              message: "Too many concurrent tool calls",
            }));
          }
          continue;
        }

        const messageHandler = sessionId === undefined
          ? this.server.handleMessage
          : this.sessionMessages.get(sessionId)?.handleMessage ?? this.server.handleMessage;
        const isToolCall = message.method === "tools/call";
        const toolStartedAt = Date.now();
        if (isToolCall) {
          this.activeToolCalls += 1;
          this.emit({
            type: "tool.start",
            requestId,
            sessionId,
            toolName,
          });
        }
        let handled;
        try {
          handled = await messageHandler(
            message.method,
            message.params
          );
        } finally {
          if (isToolCall) {
            this.activeToolCalls -= 1;
          }
        }
        const { error, result } = handled;
        if (isToolCall) {
          this.emit({
            type: "tool.end",
            requestId,
            sessionId,
            toolName,
            ok: this.isToolCallOk(error, result),
            durationMs: Date.now() - toolStartedAt,
          });
        }

        if (session !== undefined && error === undefined) {
          if (message.method === "initialize" && this.isRequest(message)) {
            const initializeResult = result as { protocolVersion?: unknown } | undefined;
            if (typeof initializeResult?.protocolVersion === "string") {
              session.protocolVersion = initializeResult.protocolVersion;
            }
          } else if (
            message.method === "notifications/initialized"
            && session.protocolVersion !== undefined
          ) {
            session.initialized = true;
          }
        }

        if (!this.isRequest(message)) {
          continue;
        }

        if (error !== undefined) {
          responses.push(formatErrorResponse(message.id, error));
          continue;
        }

        if (result !== undefined) {
          responses.push(formatSuccessResponse(message.id, result));
        }
      }

      return responses;
    });

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

    res.writeHead(200, this.withSessionHeader(SSE_HEADERS, sessionId, res));
    for (const formattedResponse of formattedResponses) {
      res.write(formatSseEvent({ data: formattedResponse }));
    }
    res.end();
  }

  private async handleGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.sessionIdGenerator === undefined) {
      this.respondWithStatus(res, 405, undefined, {
        Allow: ALLOWED_METHODS,
      });
      return;
    }

    if (!this.acceptsResponseType(req, "text/event-stream")) {
      this.respondWithStatus(res, 406);
      return;
    }

    const sessionId = this.readSessionId(req);
    if (sessionId === undefined) {
      this.respondWithStatus(res, 400);
      return;
    }

    const session = this.getActiveSession(sessionId);
    if (session === undefined) {
      this.respondWithStatus(res, 404);
      return;
    }

    this.touchSession(sessionId);
    if (
      session.initialized
      && session.protocolVersion !== undefined
      && !this.acceptsProtocolVersion(req, session.protocolVersion)
    ) {
      this.respondWithStatus(res, 400);
      return;
    }
    await this.ensureLocalMessageSession(sessionId, session);

    const existingStreams = this.sseStreams.get(sessionId);
    if ((existingStreams?.size ?? 0) >= this.maxStreamsPerSession) {
      this.respondWithStatus(res, 409);
      return;
    }

    let streams = this.sseStreams.get(sessionId);
    if (streams === undefined) {
      streams = new Set();
      this.sseStreams.set(sessionId, streams);
    }

    streams.add(res);
    this.emit({
      type: "stream.opened",
      sessionId,
      streamCount: streams.size,
    });
    const cleanup = () => {
      const activeStreams = this.sseStreams.get(sessionId);
      if (activeStreams === undefined) {
        return;
      }

      const deleted = activeStreams.delete(res);
      if (deleted) {
        this.emit({
          type: "stream.closed",
          sessionId,
          streamCount: activeStreams.size,
        });
      }
      if (activeStreams.size === 0) {
        this.sseStreams.delete(sessionId);
      }
    };

    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("finish", cleanup);
    res.writeHead(200, this.withSessionHeader(SSE_HEADERS, sessionId, res));
    this.replaySseEvents(req, res, sessionId);
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

    const session = this.getActiveSession(sessionId);
    if (session?.protocolVersion !== undefined && !this.acceptsProtocolVersion(req, session.protocolVersion)) {
      this.respondWithStatus(res, 400);
      return;
    }

    if (!this.deleteSession(sessionId, "client")) {
      this.respondWithStatus(res, 404);
      return;
    }

    this.respondWithStatus(res, 204);
  }

  private handleOptions(req: IncomingMessage, res: ServerResponse): void {
    const requestedMethod = req.headers["access-control-request-method"];
    const method = Array.isArray(requestedMethod) ? requestedMethod[0] : requestedMethod;

    if (method !== undefined && !ALLOWED_METHODS.split(", ").includes(method)) {
      this.respondWithStatus(res, 405, undefined, {
        Allow: ALLOWED_METHODS,
      });
      return;
    }

    const requestedHeaders = req.headers["access-control-request-headers"];
    this.respondWithStatus(res, 204, undefined, {
      Allow: ALLOWED_METHODS,
      "Access-Control-Allow-Methods": ALLOWED_METHODS,
      "Access-Control-Allow-Headers": Array.isArray(requestedHeaders)
        ? requestedHeaders.join(", ")
        : requestedHeaders ?? DEFAULT_ALLOWED_HEADERS,
      "Access-Control-Max-Age": "600",
    });
  }

  private readSessionId(req: IncomingMessage): string | undefined {
    const value = req.headers["mcp-session-id"];
    const id = Array.isArray(value) ? value[0] : value;
    return id !== undefined && id.length > 0 ? id : undefined;
  }

  private acceptsProtocolVersion(req: IncomingMessage, protocolVersion: string): boolean {
    const value = req.headers["mcp-protocol-version"];
    const header = Array.isArray(value) ? value[0] : value;
    return header === undefined || header === protocolVersion;
  }

  private readRequestId(req: IncomingMessage): string | undefined {
    const value = req.headers["x-request-id"];
    const requestId = Array.isArray(value) ? value[0] : value;
    return requestId !== undefined && requestId.length > 0 ? requestId : undefined;
  }

  private readOrigin(req: IncomingMessage): string | undefined {
    const originHeader = req.headers.origin;
    return Array.isArray(originHeader) ? originHeader[0] : originHeader;
  }

  private readToolName(message: JSONRPCMessage): string | undefined {
    if (!("method" in message) || message.method !== "tools/call") {
      return undefined;
    }

    const params = "params" in message ? message.params : undefined;
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      return undefined;
    }

    const name = (params as { name?: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }

  private getActiveSession(sessionId: string): Session | undefined {
    const session = this.sessionStore.get(sessionId);
    if (session === undefined) {
      return undefined;
    }

    if (this.isExpired(session)) {
      this.deleteSession(sessionId, "expired");
      return undefined;
    }

    return session;
  }

  private touchSession(sessionId: string): void {
    const session = this.sessionStore.get(sessionId);
    if (session === undefined) {
      return;
    }

    if (this.sessionStore.touch !== undefined) {
      this.sessionStore.touch(sessionId);
      return;
    }

    session.lastSeenAt = new Date();
  }

  private isExpired(session: Session): boolean {
    if (this.sessionTtlMs === undefined) {
      return false;
    }

    return Date.now() - session.lastSeenAt.getTime() > this.sessionTtlMs;
  }

  private purgeExpiredSessions(): void {
    if (this.sessionTtlMs === undefined || this.sessionStore.entries === undefined) {
      return;
    }

    for (const session of [...this.sessionStore.entries()]) {
      if (this.isExpired(session)) {
        this.deleteSession(session.id, "expired");
      }
    }
  }

  private sessionCount(): number {
    if (this.sessionStore.entries !== undefined) {
      return [...this.sessionStore.entries()].length;
    }

    return this.sessionMessages.size;
  }

  private deleteSession(
    sessionId: string,
    reason: "client" | "expired" | "closed"
  ): boolean {
    const deleted = this.sessionStore.delete(sessionId);
    if (!deleted) {
      return false;
    }

    this.sessionMessages.get(sessionId)?.close();
    this.sessionMessages.delete(sessionId);
    this.closeStreamsForSession(sessionId);
    this.sseEventHistory.delete(sessionId);
    this.emit({ type: "session.deleted", sessionId, reason });
    return true;
  }

  private createLocalMessageSession(sessionId: string): MessageSession {
    const messageSession = this.server.createMessageSession((notification) => {
      this.sendNotificationToSession(sessionId, notification);
    });
    this.sessionMessages.set(sessionId, messageSession);
    return messageSession;
  }

  private async ensureLocalMessageSession(
    sessionId: string,
    session: Session
  ): Promise<MessageSession> {
    const existing = this.sessionMessages.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }

    const messageSession = this.createLocalMessageSession(sessionId);
    if (session.protocolVersion !== undefined) {
      await messageSession.handleMessage("initialize", {
        protocolVersion: session.protocolVersion,
      });
      if (session.initialized) {
        await messageSession.handleMessage("notifications/initialized");
      }
    }

    return messageSession;
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

  private sendNotificationToSession(
    sessionId: string,
    notification: JSONRPCMessage
  ): void {
    if (!this.sessionStore.get(sessionId)?.initialized) {
      return;
    }

    const id = this.nextNotificationEventId++;
    const data = JSON.stringify(notification);
    this.recordSseEvent(sessionId, id, data);
    const streams = this.sseStreams.get(sessionId);
    if (streams === undefined) {
      return;
    }

    const event = formatSseEvent({
      id: String(id),
      data,
    });
    let latestResponse: ServerResponse | undefined;
    for (const response of streams) {
      if (!response.writableEnded) {
        latestResponse = response;
      }
    }
    latestResponse?.write(event);
  }

  private recordSseEvent(sessionId: string, id: number, data: string): void {
    if (this.maxSseEventHistory <= 0) {
      return;
    }

    const history = this.sseEventHistory.get(sessionId) ?? [];
    history.push({ id, data });
    while (history.length > this.maxSseEventHistory) {
      history.shift();
    }
    this.sseEventHistory.set(sessionId, history);
  }

  private replaySseEvents(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string
  ): void {
    const value = req.headers["last-event-id"];
    const header = Array.isArray(value) ? value[0] : value;
    if (header === undefined) {
      return;
    }

    const lastEventId = Number(header);
    if (!Number.isSafeInteger(lastEventId)) {
      return;
    }

    const history = this.sseEventHistory.get(sessionId) ?? [];
    for (const event of history) {
      if (event.id > lastEventId && !res.writableEnded) {
        res.write(formatSseEvent({ id: String(event.id), data: event.data }));
      }
    }
  }

  private isJsonRequest(req: IncomingMessage): boolean {
    const contentType = req.headers["content-type"];

    if (contentType === undefined) {
      return false;
    }

    const value = Array.isArray(contentType) ? contentType[0] : contentType;
    const type = value.split(";")[0]?.trim().toLowerCase();

    return type === "application/json";
  }

  private acceptsOrigin(req: IncomingMessage): boolean {
    const origin = this.readOrigin(req);
    if (origin === undefined) {
      return true;
    }

    return this.acceptsOriginValue(req, origin);
  }

  private acceptsOriginValue(req: IncomingMessage, origin: string): boolean {
    try {
      const endpointOrigin = new URL(
        `${this.readRequestProtocol(req)}://${this.readRequestHost(req)}`
      ).origin;
      return origin === endpointOrigin || this.allowedOrigins.has(origin);
    } catch {
      return false;
    }
  }

  private readRequestProtocol(req: IncomingMessage): "http" | "https" {
    if (this.trustedProxy) {
      const forwardedProto = this.readForwardedHeader(req, "x-forwarded-proto")?.toLowerCase();
      if (forwardedProto === "http" || forwardedProto === "https") {
        return forwardedProto;
      }
    }

    return "encrypted" in req.socket && req.socket.encrypted ? "https" : "http";
  }

  private readRequestHost(req: IncomingMessage): string {
    if (this.trustedProxy) {
      const forwardedHost = this.readForwardedHeader(req, "x-forwarded-host");
      if (forwardedHost !== undefined && forwardedHost.length > 0) {
        return forwardedHost;
      }
    }

    const host = req.headers.host;
    return Array.isArray(host) ? host[0] ?? "127.0.0.1" : host ?? "127.0.0.1";
  }

  private readForwardedHeader(
    req: IncomingMessage,
    headerName: "x-forwarded-host" | "x-forwarded-proto"
  ): string | undefined {
    const value = req.headers[headerName];
    const header = Array.isArray(value) ? value[0] : value;
    return header?.split(",")[0]?.trim();
  }

  private acceptsHost(req: IncomingMessage): boolean {
    const hostHeader = req.headers.host;
    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
    if (host === undefined || host.length === 0) {
      return true;
    }

    return this.allowedHosts.has(this.normalizeHost(host));
  }

  private normalizeHost(host: string): string {
    const normalized = host.trim().toLowerCase();
    if (normalized.startsWith("[")) {
      const closing = normalized.indexOf("]");
      if (closing > 0) {
        return normalized.slice(1, closing);
      }
    }

    const colonCount = [...normalized].filter((character) => character === ":").length;
    if (colonCount > 1) {
      return normalized;
    }

    return normalized.includes(":")
      ? normalized.split(":")[0] ?? normalized
      : normalized;
  }

  private acceptsConfiguredResponse(req: IncomingMessage): boolean {
    const expectedType = this.enableJsonResponse ? "application/json" : "text/event-stream";
    return this.acceptsResponseType(req, expectedType);
  }

  private acceptsResponseType(req: IncomingMessage, expectedType: string): boolean {
    const accept = req.headers.accept;
    if (accept === undefined) {
      return true;
    }

    const value = Array.isArray(accept) ? accept.join(",") : accept;
    return value
      .split(",")
      .map((type) => type.split(";")[0]?.trim().toLowerCase())
      .some((type) => type === "*/*" || type === expectedType);
  }

  private isValidNewSessionId(sessionId: string): boolean {
    if (sessionId.length === 0 || this.sessionStore.has(sessionId)) {
      return false;
    }

    try {
      validateHeaderValue(MCP_SESSION_ID_HEADER, sessionId);
      return true;
    } catch {
      return false;
    }
  }

  private isRequest(message: JSONRPCMessage): message is JSONRPCRequest {
    return "method" in message && "id" in message;
  }

  private isToolCallOk(error: unknown, result: unknown): boolean {
    if (error !== undefined) {
      return false;
    }

    if (typeof result !== "object" || result === null || Array.isArray(result)) {
      return true;
    }

    return !(
      hasOwnProperty(result, "isError")
      && (result as { isError?: unknown }).isError === true
    );
  }

  private respondWithJsonRpcError(
    res: ServerResponse,
    statusCode: number,
    errorCode: number,
    message: string,
    id: string | number | null = null
  ): void {
    this.respondWithStatus(
      res,
      statusCode,
      undefined,
      { "Content-Type": "application/json" },
      formatErrorResponse(id, { code: errorCode, message })
    );
  }

  private respondWithStatus(
    res: ServerResponse,
    statusCode: number,
    sessionId?: string,
    headers?: Record<string, string>,
    body?: string
  ): void {
    res.writeHead(statusCode, this.withSessionHeader(headers, sessionId, res));
    res.end(body);
  }

  private withSessionHeader(
    headers: Record<string, string> | undefined,
    sessionId: string | undefined,
    res?: ServerResponse
  ): Record<string, string> {
    const requestId = res === undefined ? undefined : this.responseRequestIds.get(res);
    const origin = res === undefined ? undefined : this.responseOrigins.get(res);
    const baseHeaders = {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      Vary: "Origin",
      ...(requestId === undefined ? {} : { "X-Request-Id": requestId }),
      ...(origin === undefined
        ? {}
        : {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Expose-Headers": "Mcp-Session-Id, X-Request-Id",
          }),
    };

    if (sessionId === undefined) {
      return {
        ...baseHeaders,
        ...(headers ?? {}),
      };
    }

    return {
      ...baseHeaders,
      ...(headers ?? {}),
      [MCP_SESSION_ID_HEADER]: sessionId,
    };
  }

  private emit(event: HttpObservabilityEvent): void {
    this.observability.onEvent?.(event);
  }
}

function hasOwnProperty(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
