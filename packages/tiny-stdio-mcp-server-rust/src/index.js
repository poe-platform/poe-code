import { createRequire } from "node:module";
import { connectStreams } from "./stdio.js";

const { NativeServer } = createRequire(import.meta.url)("./tiny-stdio-mcp-server-rust.node");

export class ToolError extends Error {
  constructor(code, message, data) {
    if (!Number.isFinite(code)) throw new Error("ToolError code must be a finite number");
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.data = data;
  }
}

export function createServer(options) {
  const native = new NativeServer(options);
  const handlers = new Map();
  const toolHandlers = new Map();
  function registerTool(definition, handler, replace = false) {
    if (typeof handler !== "function") throw new TypeError("Tool handler must be a function");
    const id = native.setTool(definition, replace);
    handlers.delete(toolHandlers.get(definition.name));
    handlers.set(id, handler);
    toolHandlers.set(definition.name, id);
    return server;
  }
  function createMessageSession() {
    const id = native.createSession();
    const controller = new AbortController();
    const requests = new Map();
    async function executeAction(action, context) {
      if (action.type === "cancel") {
        requests.get(action.token)?.abort(new Error("Request cancelled"));
        return { result: undefined };
      }
      if (action.type === "reply") return { result: action.value };
      if (action.type === "error") return { error: action.value };
      if (action.type === "none") return { result: undefined };
      const handler = handlers.get(action.handler);
      const request = new AbortController();
      requests.set(action.token, request);
      const directLegacy = context === undefined && !action.modern;
      const abortSession = () => request.abort(controller.signal.reason);
      const abortCaller = () => request.abort(context.signal.reason);
      controller.signal.addEventListener("abort", abortSession, { once: true });
      if (controller.signal.aborted) abortSession();
      context?.signal?.addEventListener("abort", abortCaller, { once: true });
      if (context?.signal?.aborted) abortCaller();
      const operation = Promise.resolve()
        .then(async () => {
          if (request.signal.aborted) return { result: undefined };
          try {
            const result = await handler(action.arguments, {
              ...action.context,
              signal: directLegacy ? controller.signal : request.signal
            });
            try {
              return { result: native.normalizeResult(result, action.modern) };
            } catch (error) {
              if (error?.code === "InvalidMcpResult") {
                return { error: { code: -32603, message: error.message } };
              }
              throw error;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (error instanceof ToolError) {
              return {
                error: {
                  code: error.code,
                  message,
                  ...(error.data === undefined ? {} : { data: error.data })
                }
              };
            }
            return {
              result: native.normalizeResult(
                { content: [{ type: "text", text: `Error: ${message}` }], isError: true },
                action.modern
              )
            };
          }
        })
        .finally(() => {
          native.finishRequest(action.token);
          requests.delete(action.token);
        });
      try {
        if (directLegacy) return await operation;
        return await new Promise((resolve) => {
          const abort = () => resolve({ result: undefined });
          request.signal.addEventListener("abort", abort, { once: true });
          if (request.signal.aborted) abort();
          operation.then((value) => {
            request.signal.removeEventListener("abort", abort);
            resolve(value);
          });
        });
      } finally {
        controller.signal.removeEventListener("abort", abortSession);
        context?.signal?.removeEventListener("abort", abortCaller);
        request.abort();
      }
    }
    const session = {
      async handleMessage(method, params, context) {
        if (context?.signal?.aborted) return { result: undefined };
        const action = native.dispatch(
          id,
          method,
          params,
          context === undefined ? undefined : { requestId: context.requestId }
        );
        return executeAction(action, context);
      },
      async handleLine(line, write) {
        const parsed = native.dispatchLine(id, line);
        let handled;
        try {
          if (parsed.action.type === "reply") handled = { result: parsed.action.value };
          else if (parsed.action.type === "error") handled = { error: parsed.action.value };
          else
            handled = await executeAction(
              parsed.action,
              parsed.isNotification || parsed.id === null ? undefined : { requestId: parsed.id }
            );
        } catch {
          handled = { error: { code: -32603, message: "Internal error" } };
        }
        if (parsed.isNotification || (handled.error === undefined && handled.result === undefined))
          return undefined;
        const response = `${JSON.stringify({ jsonrpc: "2.0", id: parsed.id, ...handled })}\n`;
        if (write !== undefined) await write(response);
        return response;
      },
      close() {
        controller.abort();
        native.closeSession(id);
      }
    };
    return session;
  }
  const defaultSession = createMessageSession();
  const server = {
    tool(name, description, inputSchema, handler) {
      return registerTool({ name, description, inputSchema }, handler, true);
    },
    registerTool,
    removeTool(name) {
      if (!native.removeTool(name)) return false;
      handlers.delete(toolHandlers.get(name));
      toolHandlers.delete(name);
      return true;
    },
    createMessageSession,
    handleMessage: defaultSession.handleMessage,
    connect(transport) {
      return connectStreams(transport, createMessageSession(), native.stdioOptions);
    },
    listen() {
      return connectStreams(
        { readable: process.stdin, writable: process.stdout },
        createMessageSession(),
        native.stdioOptions
      );
    }
  };
  return server;
}
