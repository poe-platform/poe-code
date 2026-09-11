import { validateHeaderValue, type IncomingMessage, type ServerResponse } from "node:http";
import type { JSONRPCMessage, JSONRPCRequest, MessageSession, Server } from "tiny-stdio-mcp-server";
import { JSON_RPC_ERROR_CODES } from "tiny-stdio-mcp-server";
import { formatErrorResponse, formatSuccessResponse } from "tiny-stdio-mcp-server/jsonrpc";
import type { AuthenticatedIncomingMessage } from "./auth.js";
import { JsonRpcMessageError, readAndClassifyBody } from "./parse-body.js";
import {
  createSessionStore,
  defaultSessionIdGenerator,
  type Session,
  type SessionStore
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
      reason?: string;
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
      challenge?: string;
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
  /** Maximum sessions per authenticated subject or client ID; defaults to 16. */
  maxSessionsPerSubject?: number;
  sessionTtlMs?: number;
  maxStreamsPerSession?: number;
  maxStreamBufferBytes?: number;
  maxSseEventHistory?: number;
  sseKeepAliveMs?: number;
  maxConcurrentToolCalls?: number;
  sessionStore?: SessionStore;
  requestIdGenerator?: () => string;
  observability?: HttpObservabilityOptions;
  trustedProxy?: boolean;
}

type RequestContextRunner = <T>(req: IncomingMessage, callback: () => Promise<T>) => Promise<T>;

const ALLOWED_METHODS = "POST, GET, DELETE, OPTIONS";
const MCP_SESSION_ID_HEADER = "Mcp-Session-Id";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"] as const;
const DEFAULT_ALLOWED_HEADERS =
  "Accept, Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version";

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
  private readonly maxSessions: number;
  private readonly maxSessionsPerSubject: number;
  private readonly sessionTtlMs: number;
  private readonly maxStreamsPerSession: number;
  private readonly maxStreamBufferBytes: number;
  private readonly maxSseEventHistory: number;
  private readonly sseKeepAliveMs: number;
  private readonly maxConcurrentToolCalls: number | undefined;
  private readonly sessionStore: SessionStore;
  private readonly requestIdGenerator: () => string;
  private readonly observability: HttpObservabilityOptions;
  private readonly trustedProxy: boolean;
  private readonly sessionMessages = new Map<string, MessageSession>();
  private readonly sseStreams = new Map<string, Set<ServerResponse>>();
  private readonly sseExpiryTimers = new Map<ServerResponse, ReturnType<typeof setTimeout>>();
  private readonly sseEventHistory = new Map<string, Array<{ id: number; data: string }>>();
  private readonly responseRequestIds = new WeakMap<ServerResponse, string>();
  private readonly responseOrigins = new WeakMap<ServerResponse, string>();
  private readonly responseRejectionReasons = new WeakMap<ServerResponse, string>();
  private nextNotificationEventId = 1;
  private nextRequestId = 1;
  private activeToolCalls = 0;
  private closed = false;
  private sessionExpiryInterval: ReturnType<typeof setInterval> | undefined;
  private sseKeepAliveInterval: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly server: Server,
    options: StreamableHttpTransportOptions = {},
    private readonly runWithRequestContext: RequestContextRunner = async (_req, callback) =>
      callback()
  ) {
    this.sessionIdGenerator = hasOwnProperty(options, "sessionIdGenerator")
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
    this.maxBatchSize = validateOptionalIntegerOption("maxBatchSize", options.maxBatchSize, 1);
    this.maxSessions = validateOptionalIntegerOption("maxSessions", options.maxSessions, 1) ?? 128;
    this.maxSessionsPerSubject =
      validateOptionalIntegerOption("maxSessionsPerSubject", options.maxSessionsPerSubject, 1) ?? 16;
    this.sessionTtlMs = validateOptionalIntegerOption("sessionTtlMs", options.sessionTtlMs, 1) ?? 15 * 60_000;
    this.maxStreamsPerSession =
      validateOptionalIntegerOption("maxStreamsPerSession", options.maxStreamsPerSession, 1) ?? 1;
    this.maxStreamBufferBytes =
      validateOptionalIntegerOption("maxStreamBufferBytes", options.maxStreamBufferBytes, 0) ??
      1024 * 1024;
    this.maxSseEventHistory =
      validateOptionalIntegerOption("maxSseEventHistory", options.maxSseEventHistory, 0) ?? 100;
    this.sseKeepAliveMs =
      validateOptionalIntegerOption("sseKeepAliveMs", options.sseKeepAliveMs, 0) ?? 30_000;
    this.maxConcurrentToolCalls = validateOptionalIntegerOption(
      "maxConcurrentToolCalls",
      options.maxConcurrentToolCalls,
      1
    );
    this.sessionStore = options.sessionStore ?? createSessionStore();
    this.requestIdGenerator = options.requestIdGenerator ?? (() => `req-${this.nextRequestId++}`);
    this.observability = options.observability ?? {};
    this.trustedProxy = options.trustedProxy ?? false;

    if (this.sessionIdGenerator !== undefined) {
      this.sessionExpiryInterval = setInterval(
        () => {
          try {
            this.purgeExpiredSessions();
          } catch {
            return;
          }
        },
        Math.min(this.sessionTtlMs, 60_000)
      );
      this.sessionExpiryInterval.unref();
    }
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      sessionId: this.readSessionId(req)
    });

    try {
      if (this.closed) {
        this.respondWithRejection(
          res,
          503,
          "transport_closed",
          "The transport is closed; create or use an active transport."
        );
        return;
      }

      if (!this.acceptsHost(req)) {
        this.respondWithRejection(
          res,
          403,
          "host_not_allowed",
          `Host ${JSON.stringify(this.readRequestHost(req))} is not allowed; add it to allowedHosts.`
        );
        return;
      }

      if (!this.acceptsOrigin(req)) {
        this.respondWithRejection(
          res,
          403,
          "origin_not_allowed",
          `Origin ${JSON.stringify(this.readOrigin(req) ?? "")} is not allowed; add it to allowedOrigins.`
        );
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
            Allow: ALLOWED_METHODS
          });
      }
    } catch (error) {
      this.emit({
        type: "request.error",
        requestId,
        method: req.method ?? "",
        durationMs: Date.now() - startedAt,
        error,
        sessionId: this.readSessionId(req)
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
        ...(res.statusCode < 200 || res.statusCode >= 300
          ? { reason: this.responseRejectionReasons.get(res) ?? "http_error" }
          : {})
      });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.sessionExpiryInterval !== undefined) {
      clearInterval(this.sessionExpiryInterval);
      this.sessionExpiryInterval = undefined;
    }
    this.stopSseKeepAlive();
    for (const timer of this.sseExpiryTimers.values()) {
      clearTimeout(timer);
    }
    this.sseExpiryTimers.clear();
    for (const sessionId of [...this.sseStreams.keys()]) {
      this.closeStreamsForSession(sessionId);
    }

    for (const sessionId of [...this.sessionMessages.keys()]) {
      this.deleteSession(sessionId, "closed");
    }
    this.sessionMessages.clear();
  }

  private async handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      const expectedType = this.enableJsonResponse ? "application/json" : "text/event-stream";
      this.respondWithRejection(
        res,
        406,
        "response_type_not_acceptable",
        `Accept must allow ${expectedType}.`
      );
      return;
    }

    let classified;
    try {
      classified = await readAndClassifyBody(req, undefined, {
        maxBytes: this.maxRequestBytes,
        maxBatchSize: this.maxBatchSize
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Request";
      if (message === "Payload too large") {
        this.respondWithJsonRpcError(res, 413, JSON_RPC_ERROR_CODES.INVALID_REQUEST, message);
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
    let activeSession: Session | undefined;

    if (this.sessionIdGenerator !== undefined) {
      const headerSessionId = this.readSessionId(req);

      if (headerSessionId === undefined) {
        if (initMessage === undefined) {
          this.respondWithRejection(
            res,
            400,
            "session_id_required",
            "Mcp-Session-Id is required; initialize a session first."
          );
          return;
        }

        this.purgeExpiredSessions();
        if (this.sessionCount() >= this.maxSessions) {
          this.respondWithRejection(
            res,
            503,
            "session_limit_reached",
            "The server has reached its session limit; close a session or retry later."
          );
          return;
        }

        const authSubject = this.readAuthSubject(req);
        if (authSubject !== undefined && this.sessionCount(authSubject) >= this.maxSessionsPerSubject) {
          this.respondWithRejection(
            res,
            429,
            "subject_session_limit_reached",
            "The authenticated subject has reached its session limit; close a session or retry later."
          );
          return;
        }

        const newSessionId = this.sessionIdGenerator();
        if (!this.isValidNewSessionId(newSessionId)) {
          this.respondWithStatus(res, 500);
          return;
        }

        sessionId = newSessionId;
        activeSession = this.sessionStore.create(newSessionId);
        if (authSubject !== undefined) {
          activeSession.authSubject = authSubject;
        }
        this.emit({ type: "session.created", sessionId: newSessionId });
        this.createLocalMessageSession(newSessionId);
      } else {
        activeSession = this.getActiveSession(headerSessionId, req);
        if (activeSession === undefined) {
          this.respondWithRejection(
            res,
            404,
            "session_not_found",
            "Session was not found or has expired; reinitialize the session."
          );
          return;
        }

        sessionId = headerSessionId;
        this.touchSession(sessionId);
        if (
          activeSession.protocolVersion !== undefined &&
          !this.acceptsProtocolVersion(req, activeSession.protocolVersion)
        ) {
          this.respondWithRejection(
            res,
            400,
            "protocol_version_mismatch",
            `MCP-Protocol-Version must match the session protocol version ${activeSession.protocolVersion}.`
          );
          return;
        }
        await this.ensureLocalMessageSession(sessionId, activeSession);
      }
    }

    const formattedResponses = await this.runWithRequestContext(req, async () => {
      const responses: string[] = [];

      for (const message of classified.entries) {
        if (message === null) {
          responses.push(
            formatErrorResponse(null, {
              code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
              message: "Invalid Request"
            })
          );
          continue;
        }

        if (!("method" in message)) {
          continue;
        }

        const session = activeSession;
        if (
          session !== undefined &&
          message.method !== "initialize" &&
          message.method !== "notifications/initialized" &&
          message.method !== "ping" &&
          !session.initialized
        ) {
          if (this.isRequest(message)) {
            responses.push(
              formatErrorResponse(message.id, {
                code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
                message: "Session not initialized"
              })
            );
          }
          continue;
        }

        const requestId = this.responseRequestIds.get(res) ?? "";
        const toolName = this.readToolName(message);
        if (
          message.method === "tools/call" &&
          this.maxConcurrentToolCalls !== undefined &&
          this.activeToolCalls >= this.maxConcurrentToolCalls
        ) {
          if (this.isRequest(message)) {
            responses.push(
              formatErrorResponse(message.id, {
                code: -32000,
                message: "Too many concurrent tool calls"
              })
            );
          }
          continue;
        }

        const messageHandler =
          sessionId === undefined
            ? this.server.handleMessage
            : (this.sessionMessages.get(sessionId)?.handleMessage ?? this.server.handleMessage);
        const isToolCall = message.method === "tools/call";
        const toolStartedAt = Date.now();
        if (isToolCall) {
          this.activeToolCalls += 1;
          this.emit({
            type: "tool.start",
            requestId,
            sessionId,
            toolName
          });
        }
        let handled;
        try {
          handled = await messageHandler(message.method, message.params);
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
            durationMs: Date.now() - toolStartedAt
          });
        }

        if (session !== undefined && error === undefined) {
          if (message.method === "initialize" && this.isRequest(message)) {
            const initializeResult = result as { protocolVersion?: unknown } | undefined;
            if (typeof initializeResult?.protocolVersion === "string") {
              session.protocolVersion = initializeResult.protocolVersion;
            }
          } else if (
            message.method === "notifications/initialized" &&
            session.protocolVersion !== undefined
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
          : JSON.stringify(formattedResponses.map((responseText) => JSON.parse(responseText)));

      this.respondWithStatus(res, 200, sessionId, { "Content-Type": "application/json" }, body);
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
        Allow: ALLOWED_METHODS
      });
      return;
    }

    if (!this.acceptsResponseType(req, "text/event-stream")) {
      this.respondWithRejection(
        res,
        406,
        "response_type_not_acceptable",
        "Accept must allow text/event-stream."
      );
      return;
    }

    const sessionId = this.readSessionId(req);
    if (sessionId === undefined) {
      this.respondWithRejection(
        res,
        400,
        "session_id_required",
        "Mcp-Session-Id is required; initialize a session first."
      );
      return;
    }

    const session = this.getActiveSession(sessionId, req);
    if (session === undefined) {
      this.respondWithRejection(
        res,
        404,
        "session_not_found",
        "Session was not found or has expired; reinitialize the session."
      );
      return;
    }

    this.touchSession(sessionId);
    if (
      session.initialized &&
      session.protocolVersion !== undefined &&
      !this.acceptsProtocolVersion(req, session.protocolVersion)
    ) {
      this.respondWithRejection(
        res,
        400,
        "protocol_version_mismatch",
        `MCP-Protocol-Version must match the session protocol version ${session.protocolVersion}.`
      );
      return;
    }
    await this.ensureLocalMessageSession(sessionId, session);

    const existingStreams = this.sseStreams.get(sessionId);
    if ((existingStreams?.size ?? 0) >= this.maxStreamsPerSession) {
      this.respondWithRejection(
        res,
        409,
        "stream_limit_reached",
        "This session already has the maximum number of streams; close a stream and retry."
      );
      return;
    }

    let streams = this.sseStreams.get(sessionId);
    if (streams === undefined) {
      streams = new Set();
      this.sseStreams.set(sessionId, streams);
    }

    streams.add(res);
    this.startSseKeepAlive();
    this.emit({
      type: "stream.opened",
      sessionId,
      streamCount: streams.size
    });
    const cleanup = () => {
      this.clearSseExpiryTimer(res);
      const activeStreams = this.sseStreams.get(sessionId);
      if (activeStreams === undefined) {
        return;
      }

      const deleted = activeStreams.delete(res);
      if (deleted) {
        this.emit({
          type: "stream.closed",
          sessionId,
          streamCount: activeStreams.size
        });
      }
      if (activeStreams.size === 0) {
        this.sseStreams.delete(sessionId);
      }
      this.stopSseKeepAliveIfIdle();
    };

    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("finish", cleanup);
    const expiresAt = (req as AuthenticatedIncomingMessage).auth?.expiresAt;
    if (expiresAt !== undefined) {
      this.scheduleSseExpiry(res, expiresAt);
    }
    res.writeHead(200, this.withSessionHeader(SSE_HEADERS, sessionId, res));
    this.replaySseEvents(req, res, sessionId);
    res.flushHeaders();
  }

  private handleDelete(req: IncomingMessage, res: ServerResponse): void {
    if (this.sessionIdGenerator === undefined) {
      this.respondWithStatus(res, 405, undefined, {
        Allow: ALLOWED_METHODS
      });
      return;
    }

    const sessionId = this.readSessionId(req);
    if (sessionId === undefined) {
      this.respondWithRejection(
        res,
        400,
        "session_id_required",
        "Mcp-Session-Id is required; initialize a session first."
      );
      return;
    }

    const session = this.getActiveSession(sessionId, req);
    if (session === undefined) {
      this.respondWithRejection(
        res,
        404,
        "session_not_found",
        "Session was not found or has expired; reinitialize the session."
      );
      return;
    }

    if (
      session.protocolVersion !== undefined &&
      !this.acceptsProtocolVersion(req, session.protocolVersion)
    ) {
      this.respondWithRejection(
        res,
        400,
        "protocol_version_mismatch",
        `MCP-Protocol-Version must match the session protocol version ${session.protocolVersion}.`
      );
      return;
    }

    if (!this.deleteSession(sessionId, "client")) {
      this.respondWithRejection(
        res,
        404,
        "session_not_found",
        "Session was not found or has expired; reinitialize the session."
      );
      return;
    }

    this.respondWithStatus(res, 204);
  }

  private handleOptions(req: IncomingMessage, res: ServerResponse): void {
    const requestedMethod = req.headers["access-control-request-method"];
    const method = Array.isArray(requestedMethod) ? requestedMethod[0] : requestedMethod;

    if (method !== undefined && !ALLOWED_METHODS.split(", ").includes(method)) {
      this.respondWithStatus(res, 405, undefined, {
        Allow: ALLOWED_METHODS
      });
      return;
    }

    const requestedHeaders = req.headers["access-control-request-headers"];
    this.respondWithStatus(res, 204, undefined, {
      Allow: ALLOWED_METHODS,
      "Access-Control-Allow-Methods": ALLOWED_METHODS,
      "Access-Control-Allow-Headers": Array.isArray(requestedHeaders)
        ? requestedHeaders.join(", ")
        : (requestedHeaders ?? DEFAULT_ALLOWED_HEADERS),
      "Access-Control-Max-Age": "600"
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

  private getActiveSession(sessionId: string, req: IncomingMessage): Session | undefined {
    const session = this.sessionStore.get(sessionId);
    if (session === undefined) {
      return undefined;
    }

    if (this.isExpired(session)) {
      this.deleteSession(sessionId, "expired");
      return undefined;
    }

    if (session.authSubject !== undefined && session.authSubject !== this.readAuthSubject(req)) {
      return undefined;
    }

    return session;
  }

  private readAuthSubject(req: IncomingMessage): string | undefined {
    const auth = (req as AuthenticatedIncomingMessage).auth;
    const authSubject = auth?.subject ?? auth?.clientId;
    return authSubject !== undefined && authSubject.length > 0 ? authSubject : undefined;
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
    return Date.now() - session.lastSeenAt.getTime() > this.sessionTtlMs;
  }

  private purgeExpiredSessions(): void {
    for (const session of [...this.sessions()]) {
      if (this.isExpired(session)) {
        this.deleteSession(session.id, "expired");
      }
    }
  }

  private *sessions(): Iterable<Session> {
    if (this.sessionStore.entries !== undefined) {
      yield* this.sessionStore.entries();
    } else {
      for (const id of this.sessionMessages.keys()) {
        const session = this.sessionStore.get(id);
        if (session !== undefined) yield session;
      }
    }
  }

  private sessionCount(authSubject?: string): number {
    if (authSubject === undefined && this.sessionStore.entries === undefined) {
      return this.sessionMessages.size;
    }
    let count = 0;
    for (const session of this.sessions()) {
      if (authSubject === undefined || session.authSubject === authSubject) count++;
    }
    return count;
  }

  private deleteSession(sessionId: string, reason: "client" | "expired" | "closed"): boolean {
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
        protocolVersion: session.protocolVersion
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
      this.clearSseExpiryTimer(response);
      if (!response.writableEnded) {
        response.end();
      }
    }

    this.sseStreams.delete(sessionId);
    this.stopSseKeepAliveIfIdle();
  }

  private scheduleSseExpiry(response: ServerResponse, expiresAt: number): void {
    const remainingMs = Math.max(0, expiresAt * 1_000 - Date.now());
    const timer = setTimeout(() => {
      this.sseExpiryTimers.delete(response);
      if (!response.writableEnded) {
        response.end();
      }
    }, remainingMs);
    timer.unref();
    this.sseExpiryTimers.set(response, timer);
  }

  private clearSseExpiryTimer(response: ServerResponse): void {
    const timer = this.sseExpiryTimers.get(response);
    if (timer === undefined) {
      return;
    }

    clearTimeout(timer);
    this.sseExpiryTimers.delete(response);
  }

  private startSseKeepAlive(): void {
    if (this.sseKeepAliveMs === 0 || this.sseKeepAliveInterval !== undefined) {
      return;
    }

    this.sseKeepAliveInterval = setInterval(() => {
      for (const streams of this.sseStreams.values()) {
        for (const response of streams) {
          if (!response.writableEnded) {
            this.writeToLiveGetStream(response, ": keepalive\n\n");
          }
        }
      }
    }, this.sseKeepAliveMs);
    this.sseKeepAliveInterval.unref();
  }

  private stopSseKeepAliveIfIdle(): void {
    if ([...this.sseStreams.values()].some((streams) => streams.size > 0)) {
      return;
    }

    this.stopSseKeepAlive();
  }

  private stopSseKeepAlive(): void {
    if (this.sseKeepAliveInterval === undefined) {
      return;
    }

    clearInterval(this.sseKeepAliveInterval);
    this.sseKeepAliveInterval = undefined;
  }

  private sendNotificationToSession(sessionId: string, notification: JSONRPCMessage): void {
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
      data
    });
    let latestResponse: ServerResponse | undefined;
    for (const response of streams) {
      if (!response.writableEnded) {
        latestResponse = response;
      }
    }
    if (latestResponse !== undefined) {
      this.writeToLiveGetStream(latestResponse, event);
    }
  }

  private writeToLiveGetStream(response: ServerResponse, data: string): void {
    if ((response.writableLength ?? 0) > this.maxStreamBufferBytes) {
      response.end();
      return;
    }

    response.write(data);
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

  private replaySseEvents(req: IncomingMessage, res: ServerResponse, sessionId: string): void {
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
        this.writeToLiveGetStream(res, formatSseEvent({ id: String(event.id), data: event.data }));
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
    return Array.isArray(host) ? (host[0] ?? "127.0.0.1") : (host ?? "127.0.0.1");
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

    return this.allowedHosts.has(this.normalizeHost(this.readRequestHost(req)));
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

    return normalized.includes(":") ? (normalized.split(":")[0] ?? normalized) : normalized;
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
      hasOwnProperty(result, "isError") && (result as { isError?: unknown }).isError === true
    );
  }

  private respondWithJsonRpcError(
    res: ServerResponse,
    statusCode: number,
    errorCode: number,
    message: string,
    id: string | number | null = null
  ): void {
    this.responseRejectionReasons.set(res, "json_rpc_error");
    this.respondWithStatus(
      res,
      statusCode,
      undefined,
      { "Content-Type": "application/json" },
      formatErrorResponse(id, { code: errorCode, message })
    );
  }

  private respondWithRejection(
    res: ServerResponse,
    statusCode: number,
    reason: string,
    message: string
  ): void {
    this.responseRejectionReasons.set(res, reason);
    this.respondWithStatus(
      res,
      statusCode,
      undefined,
      { "Content-Type": "application/json" },
      JSON.stringify({ error: reason, message })
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
            "Access-Control-Expose-Headers": "Mcp-Session-Id, X-Request-Id"
          })
    };

    if (sessionId === undefined) {
      return {
        ...baseHeaders,
        ...(headers ?? {})
      };
    }

    return {
      ...baseHeaders,
      ...(headers ?? {}),
      [MCP_SESSION_ID_HEADER]: sessionId
    };
  }

  private emit(event: HttpObservabilityEvent): void {
    this.observability.onEvent?.(event);
  }
}

function hasOwnProperty(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
