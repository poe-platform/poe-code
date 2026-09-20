import { createRequire } from "node:module";

const { NativeServer } = createRequire(import.meta.url)("./tiny-stdio-mcp-server-rust.node");

export function createServer(options) {
  const native = new NativeServer(options);
  const handlers = new Map();
  const toolHandlers = new Map();
  function registerTool(definition, handler, replace = false) {
    if (typeof handler !== "function") throw new TypeError("Tool handler must be a function");
    const id = native.setTool(JSON.stringify(definition), replace);
    handlers.delete(toolHandlers.get(definition.name));
    handlers.set(id, handler);
    toolHandlers.set(definition.name, id);
    return server;
  }
  function createMessageSession() {
    const id = native.createSession();
    const controller = new AbortController();
    return {
      async handleMessage(method, params, context) {
        const action = native.dispatch(
          id,
          method,
          params === undefined ? undefined : JSON.stringify(params)
        );
        if (action.type === "reply") return { result: action.value };
        if (action.type === "error") return { error: action.value };
        if (action.type === "none") return { result: undefined };
        const handler = handlers.get(action.handler);
        const request = new AbortController();
        const abortSession = () => request.abort(controller.signal.reason);
        const abortCaller = () => request.abort(context.signal.reason);
        controller.signal.addEventListener("abort", abortSession, { once: true });
        if (controller.signal.aborted) abortSession();
        context?.signal?.addEventListener("abort", abortCaller, { once: true });
        if (context?.signal?.aborted) abortCaller();
        const operation = Promise.resolve().then(async () => {
          if (request.signal.aborted) return { result: undefined };
          try {
            const result = await handler(action.arguments, {
              ...action.context,
              signal: request.signal
            });
            return {
              result: native.normalizeResult(
                result === undefined ? undefined : JSON.stringify(result)
              )
            };
          } catch (error) {
            return {
              error: {
                code: -32603,
                message: error instanceof Error ? error.message : String(error)
              }
            };
          }
        });
        try {
          if (context === undefined) return await operation;
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
        }
      },
      close() {
        controller.abort();
        native.closeSession(id);
      }
    };
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
    handleMessage: defaultSession.handleMessage
  };
  return server;
}
