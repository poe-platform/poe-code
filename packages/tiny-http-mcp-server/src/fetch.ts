import {
  createProtocolServer,
  ToolError,
  type CallToolResult,
  type HandlerRequestContext,
  type InputRequiredResult,
  type ServerOptions,
  type ToolDefinition,
  type ToolReturn,
  type TypedSchema,
  type TypedOutputSchema
} from "tiny-stdio-mcp-server/core";
import { parseMessage } from "tiny-stdio-mcp-server/jsonrpc";
import { MODERN_PROTOCOL_VERSION } from "tiny-stdio-mcp-server/protocol";
import { FetchBodyError, readFetchBody } from "./fetch-body.js";
import { validateModernHeaders } from "./modern-headers.js";

export { defineSchema, ToolError } from "tiny-stdio-mcp-server/core";
export type { CallToolResult, TypedSchema, TypedOutputSchema } from "tiny-stdio-mcp-server/core";

export interface FetchServerOptions extends ServerOptions {
  /** Defaults to 1 MiB. Enforced while reading the stream. */
  maxRequestBytes?: number;
  /** Defaults to 1 MiB. */
  maxResponseBytes?: number;
  /** Browser origins allowed to call this endpoint; absent rejects all Origin headers. */
  allowedOrigins?: readonly string[];
}

export interface FetchToolContext<TContext> extends HandlerRequestContext {
  readonly request: Request;
  readonly context: TContext;
}

export type FetchToolHandler<TIn, TContext, TOut = ToolReturn> = (
  input: TIn, context: FetchToolContext<TContext>
) => TOut | CallToolResult | InputRequiredResult | Promise<TOut | CallToolResult | InputRequiredResult>;

export interface FetchServer<TContext = undefined> {
  tool<TIn, TOut = never>(name: string, description: string, schema: TypedSchema<TIn>,
    handler: FetchToolHandler<TIn, TContext, TOut>, outputSchema?: TypedOutputSchema<TOut>): FetchServer<TContext>;
  registerTool<TIn, TOut = never>(definition: Omit<ToolDefinition<TIn, TOut>, "handler">,
    handler: FetchToolHandler<TIn, TContext, TOut>): FetchServer<TContext>;
  fetch(request: Request, ...context: undefined extends TContext ? [context?: TContext] : [context: TContext]): Promise<Response>;
}

const versions = new Set(["2025-03-26", "2025-06-18", "2025-11-25", MODERN_PROTOCOL_VERSION]);
const unsupportedMethods = new Set(["resources/subscribe", "resources/unsubscribe", "subscriptions/listen"]);

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

function failure(code: number, message: string, status = 400, id: string | number | null = null): Response {
  return json({ jsonrpc: "2.0", id, error: { code, message } }, status);
}

function validateRequest(request: Request, options: FetchServerOptions): Response | undefined {
  const origin = request.headers.get("origin");
  if (origin !== null && !options.allowedOrigins?.includes(origin)) return failure(-32600, "Origin not allowed", 403);
  if (request.method !== "POST") {
    const response = failure(-32600, "Method not allowed", 405);
    response.headers.set("allow", "POST");
    return response;
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    return failure(-32600, "Content-Type must be application/json", 415);
  const accepted = request.headers.get("accept")?.split(",").map(value => value.split(";")[0]?.trim().toLowerCase());
  if (!accepted?.includes("application/json") || !accepted.includes("text/event-stream"))
    return failure(-32600, "Accept must include application/json and text/event-stream", 406);
  const version = request.headers.get("mcp-protocol-version");
  if (version !== null && !versions.has(version)) return failure(-32600, "Unsupported protocol version");
  if (request.headers.has("mcp-session-id")) return failure(-32600, "This endpoint is stateless", 400);
}

/** Stateless Streamable HTTP. Authentication must run in the host before fetch(). */
export function createFetchServer<TContext = undefined>(options: FetchServerOptions): FetchServer<TContext> {
  const maxRequestBytes = options.maxRequestBytes ?? 1024 * 1024;
  const maxResponseBytes = options.maxResponseBytes ?? 1024 * 1024;
  for (const bound of [maxRequestBytes, maxResponseBytes]) {
    if (!Number.isSafeInteger(bound) || bound < 1) throw new Error("Fetch byte limits must be positive safe integers");
  }
  const protocol = createProtocolServer({ ...options, supportNotifications: false, supportResourceSubscriptions: false });
  function wrap<TIn, TOut>(handler: FetchToolHandler<TIn, TContext, TOut>) {
    return async (input: TIn, context: HandlerRequestContext) => {
      const local = context.localContext as { request: Request; context: TContext };
      try {
        return await handler(input, { ...context, ...local });
      } catch {
        // Tool-authored error results are public; thrown exceptions may contain credentials.
        throw new ToolError(-32603, "Tool execution failed");
      }
    };
  }
  const server: FetchServer<TContext> = {
    tool(name, description, schema, handler, outputSchema) {
      protocol.tool(name, description, schema, wrap(handler), outputSchema);
      return server;
    },
    registerTool(definition, handler) {
      protocol.registerTool(definition, wrap(handler));
      return server;
    },
    async fetch(request, ...[context]) {
      const invalid = validateRequest(request, options);
      if (invalid !== undefined) return invalid;
      let raw: string;
      try { raw = await readFetchBody(request, maxRequestBytes); }
      catch (error) {
        if (request.signal.aborted) throw error;
        return failure(-32600, error instanceof FetchBodyError ? error.message : "Invalid request body", error instanceof FetchBodyError ? error.status : 400);
      }
      // MCP 2025-06-18 and later prohibit batches. Reject before any side effects.
      const parsed = parseMessage(raw);
      if (!parsed.success) return failure(parsed.error.code, parsed.error.message, 400, parsed.id);
      if (parsed.isNotification) return new Response(null, { status: 202 });
      const message = parsed.request;
      if (!("id" in message)) return failure(-32600, "Invalid Request");
      if (message.method.startsWith("notifications/")) return failure(-32600, "Invalid Request", 400, message.id);
      if (unsupportedMethods.has(message.method)) return failure(-32601, "Method not found", 200, message.id);
      const headers = Object.fromEntries(request.headers);
      const metadata = message.params?._meta as Record<string, unknown> | undefined;
      const modern = request.headers.get("mcp-protocol-version") === MODERN_PROTOCOL_VERSION ||
        metadata?.["io.modelcontextprotocol/protocolVersion"] === MODERN_PROTOCOL_VERSION;
      if (modern) {
        const error = validateModernHeaders(headers, message);
        if (error !== undefined) return json({ jsonrpc: "2.0", id: message.id, error }, 400);
      }
      // Fresh lifecycle per request isolates duplicate IDs and cancellation across callers.
      const session = protocol.createMessageSession();
      try {
        if (!modern && message.method !== "initialize") {
          await session.handleMessage("initialize", { protocolVersion: request.headers.get("mcp-protocol-version") ?? "2025-03-26" });
        }
        const handled = await session.handleMessage(message.method, message.params, {
          ...(message.id !== null ? { requestId: message.id } : {}),
          signal: request.signal,
          parameterHeaders: headers,
          localContext: { request, context }
        });
        request.signal.throwIfAborted();
        const response = { jsonrpc: "2.0", id: message.id, ...handled };
        const body = JSON.stringify(response);
        if (new TextEncoder().encode(body).byteLength > maxResponseBytes)
          return failure(-32603, "Response exceeds byte limit", 200, message.id);
        return json(response);
      } catch (error) {
        if (request.signal.aborted) throw error;
        return failure(-32603, "Internal error", 200, message.id);
      } finally { session.close(); }
    }
  };
  return server;
}
