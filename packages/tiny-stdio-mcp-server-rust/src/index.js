import { createRequire } from "node:module";
import { connectStreams } from "./stdio.js";
import { prepareToolValue } from "./media.js";
export {
  Image,
  Audio,
  File,
  toContentBlocks,
  fileTypeFromBuffer,
  DEFAULT_FROM_URL_MAX_BYTES
} from "./media.js";

const { NativeServer, NativeUriTemplate } = createRequire(import.meta.url)(
  "./tiny-stdio-mcp-server-rust.node"
);
export const { validateProtocolValue, defineSchema } = createRequire(import.meta.url)(
  "./tiny-stdio-mcp-server-rust.node"
);

export function parseUriTemplate(source) {
  if (typeof source !== "string") throw new Error("URI template must be a string.");
  return new NativeUriTemplate(source);
}

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
  const featureHandlers = new Map();
  const notificationListeners = new Set();
  const sessionListeners = new Map();
  const toolWaiters = new Map();
  const toolCallTimeoutMs = native.toolCallTimeoutMs;
  function acquireTool(token, signal) {
    signal.throwIfAborted();
    const admitted = native.acquireTool(token);
    if (admitted === true) return Promise.resolve();
    if (admitted !== false) throw new ToolError(-32000, "Too many queued tool calls");
    return new Promise((resolve, reject) => {
      const abort = () => {
        native.cancelQueuedTool(token);
        toolWaiters.delete(token);
        reject(signal.reason);
      };
      toolWaiters.set(token, { resolve, signal, abort });
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  function releaseTool(token) {
    const next = native.releaseTool(token);
    const waiting = toolWaiters.get(next);
    if (waiting === undefined) return;
    toolWaiters.delete(next);
    waiting.signal.removeEventListener("abort", waiting.abort);
    waiting.resolve();
  }
  function registerTool(definition, handler) {
    if (typeof handler !== "function") throw new TypeError("Tool handler must be a function");
    const { handler: id, name } = native.setTool(definition, false);
    handlers.delete(toolHandlers.get(name));
    handlers.set(id, handler);
    toolHandlers.set(name, id);
    return server;
  }
  function createMessageSession(listener) {
    const id = native.createSession();
    if (listener !== undefined) sessionListeners.set(id, listener);
    const controller = new AbortController();
    const requests = new Map();
    const listening = new Set();
    controller.signal.addEventListener(
      "abort",
      () => {
        for (const request of requests.values()) request.abort(controller.signal.reason);
      },
      { once: true }
    );
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
      if (action.type === "listen") listening.add(request);
      const directLegacy = context === undefined && !action.modern;
      const abortCaller = () => request.abort(context.signal.reason);
      if (controller.signal.aborted) request.abort(controller.signal.reason);
      context?.signal?.addEventListener("abort", abortCaller, { once: true });
      if (context?.signal?.aborted) abortCaller();
      const cancelSubscription = () => native.cancelSubscription(id, action.token);
      if (action.type === "listen") {
        request.signal.addEventListener("abort", cancelSubscription, { once: true });
        if (request.signal.aborted) cancelSubscription();
      }
      let pendingWork;
      const operation = Promise.resolve()
        .then(async () => {
          if (request.signal.aborted) return { result: undefined };
          if (action.type === "listen") {
            await listener?.(action.acknowledgment);
            if (!request.signal.aborted) native.acknowledgeSubscription(id, action.token);
            await new Promise((resolve) => {
              const abort = () => {
                request.signal.removeEventListener("abort", abort);
                resolve();
              };
              request.signal.addEventListener("abort", abort, { once: true });
              if (request.signal.aborted) abort();
            });
            return { result: undefined };
          }
          try {
            const handlerContext = {
              ...action.context,
              signal: directLegacy ? controller.signal : request.signal
            };
            if (action.handlerKind === "custom") {
              handlerContext.notify = async (method, params) => {
                if (
                  handlerContext.signal.aborted ||
                  listener === undefined ||
                  !native.canNotify(id, action.modern)
                )
                  return;
                await listener({
                  jsonrpc: "2.0",
                  method,
                  ...(params === undefined ? {} : { params })
                });
              };
            }
            let result;
            if (action.handlerKind === "tool") {
              const admission = new AbortController();
              const cancel = () => admission.abort(request.signal.reason);
              request.signal.addEventListener("abort", cancel, { once: true });
              if (request.signal.aborted) cancel();
              handlerContext.signal = admission.signal;
              const work = (async () => {
                await acquireTool(action.token, admission.signal);
                try {
                  admission.signal.throwIfAborted();
                  return await handler(action.arguments, handlerContext);
                } finally {
                  releaseTool(action.token);
                }
              })();
              pendingWork = work;
              let timeout;
              try {
                result =
                  toolCallTimeoutMs === undefined || toolCallTimeoutMs === null
                    ? await work
                    : await Promise.race([
                        work,
                        new Promise((_resolve, reject) => {
                          timeout = setTimeout(() => {
                            const error = new ToolError(
                              -32603,
                              `Tool call timed out: ${action.toolName}`
                            );
                            admission.abort(error);
                            reject(error);
                          }, toolCallTimeoutMs);
                        })
                      ]);
              } finally {
                if (timeout !== undefined) clearTimeout(timeout);
                request.signal.removeEventListener("abort", cancel);
              }
            } else result = await handler(action.arguments, handlerContext);
            if (
              action.modern &&
              result !== null &&
              typeof result === "object" &&
              !Array.isArray(result) &&
              Object.getOwnPropertyDescriptor(result, "resultType")?.value === "input_required"
            )
              return native.completeInputRequired(result, action.token);
            if (action.handlerKind === "tool")
              return native.completeTool(prepareToolValue(result), action.modern, action.token);
            if (action.handlerKind === "custom" && !action.modern) return { result };
            return native.completeFeature(
              result,
              action.modern,
              action.handlerKind,
              action.allowResourceLinks
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (
              error instanceof ToolError &&
              (action.handlerKind === "tool" || action.handlerKind === "custom")
            ) {
              return {
                error: {
                  code: error.code,
                  message,
                  ...(error.data === undefined ? {} : { data: error.data })
                }
              };
            }
            if (action.handlerKind !== "tool") return { error: { code: -32603, message } };
            return {
              result: native.normalizeResult(
                { content: [{ type: "text", text: `Error: ${message}` }], isError: true },
                action.modern
              )
            };
          }
        })
        .finally(() => {
          const finish = () => {
            native.finishRequest(action.token);
            requests.delete(action.token);
            listening.delete(request);
            request.signal.removeEventListener("abort", cancelSubscription);
          };
          if (pendingWork === undefined) finish();
          else pendingWork.then(finish, finish);
        });
      try {
        if (directLegacy) return await operation;
        return await new Promise((resolve, reject) => {
          const abort = () => resolve({ result: undefined });
          request.signal.addEventListener("abort", abort, { once: true });
          if (request.signal.aborted) abort();
          operation.then(
            (value) => {
              request.signal.removeEventListener("abort", abort);
              resolve(value);
            },
            (error) => {
              request.signal.removeEventListener("abort", abort);
              reject(error);
            }
          );
        });
      } finally {
        context?.signal?.removeEventListener("abort", abortCaller);
        request.abort();
      }
    }
    function handleParsed(parsed) {
      function complete(handled) {
        if (parsed.isNotification || (handled.error === undefined && handled.result === undefined))
          return undefined;
        return { jsonrpc: "2.0", id: parsed.id, ...handled };
      }
      if (parsed.action.type === "reply") return complete({ result: parsed.action.value });
      if (parsed.action.type === "error") return complete({ error: parsed.action.value });
      if (parsed.action.type === "none") return undefined;
      return executeAction(
        parsed.action,
        parsed.isNotification || parsed.id === null ? undefined : { requestId: parsed.id }
      ).then(complete, () => complete({ error: { code: -32603, message: "Internal error" } }));
    }
    const session = {
      async handleMessage(method, params, context) {
        if (context?.signal?.aborted) return { result: undefined };
        const action = native.dispatch(
          id,
          method,
          params,
          context === undefined
            ? undefined
            : { requestId: context.requestId, parameterHeaders: context.parameterHeaders }
        );
        return executeAction(action, context);
      },
      async handleLine(line, write) {
        const parsed = native.dispatchLine(id, line);
        const pending = handleParsed(parsed);
        const handled = pending instanceof Promise ? await pending : pending;
        if (handled === undefined) return undefined;
        const response = `${JSON.stringify(handled)}\n`;
        if (write !== undefined) await write(response);
        return response;
      },
      async handleSDKMessage(message) {
        if (controller.signal.aborted || !("method" in message)) return undefined;
        let parsed;
        try {
          parsed = native.dispatchSdk(id, message.method, message.params, message.id);
        } catch {
          if (message.id === undefined) return undefined;
          return {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32603, message: "Internal error" }
          };
        }
        return handleParsed(parsed);
      },
      close() {
        controller.abort();
        native.closeSession(id);
        sessionListeners.delete(id);
      },
      endInput() {
        for (const request of listening) request.abort(new Error("Stdio input closed"));
      }
    };
    return session;
  }
  const defaultSession = createMessageSession();
  const server = {
    tool(name, description, inputSchema, handler, outputSchema) {
      return registerTool(
        { name, description, inputSchema, ...(outputSchema === undefined ? {} : { outputSchema }) },
        handler
      );
    },
    registerTool,
    removeTool(name) {
      if (!native.removeTool(name)) return false;
      handlers.delete(toolHandlers.get(name));
      toolHandlers.delete(name);
      return true;
    },
    createMessageSession,
    onNotification(listener) {
      notificationListeners.add(listener);
      return () => notificationListeners.delete(listener);
    },
    handleMessage: defaultSession.handleMessage,
    connect(transport) {
      return connectStreams(transport, createMessageSession, native.stdioOptions);
    },
    connectSDK(transport) {
      return new Promise((resolve, reject) => {
        const session = createMessageSession((notification) => transport.send(notification));
        transport.onmessage = async (message) => {
          const response = await session.handleSDKMessage(message);
          if (response !== undefined) await transport.send(response);
        };
        transport.onclose = () => {
          session.close();
          resolve();
        };
        Promise.resolve()
          .then(() => transport.start())
          .catch((error) => {
            session.close();
            reject(error);
          });
      });
    },
    listen() {
      return connectStreams(
        { readable: process.stdin, writable: process.stdout },
        createMessageSession,
        native.stdioOptions
      );
    }
  };
  for (const [method, kind] of [
    ["notifyToolsChanged", "tools"],
    ["notifyPromptsChanged", "prompts"],
    ["notifyResourcesChanged", "resources"],
    ["notifyResourceUpdated", "resource"]
  ]) {
    server[method] = async (uri) => {
      const delivery = native.notification(kind, uri);
      if (delivery === null) return;
      for (const listener of notificationListeners) listener(delivery.notification);
      const current = native.notification(kind, uri);
      await Promise.all(
        (current?.subscriptions ?? []).map(async (delivery) => {
          const listener = sessionListeners.get(delivery.session);
          if (listener !== undefined) await listener(delivery.notification);
        })
      );
      const legacy = native.notification(kind, uri);
      await Promise.all(
        (legacy?.sessions ?? []).map(async (id) => {
          const listener = sessionListeners.get(id);
          if (listener !== undefined && native.canNotify(id, false))
            await listener(delivery.notification);
        })
      );
    };
  }
  for (const kind of ["prompt", "resource", "resourceTemplate", "method"]) {
    const registered = new Map();
    featureHandlers.set(kind, registered);
    server[kind] = (definition, handler) => {
      if (typeof handler !== "function") throw new TypeError("Feature handler must be a function");
      const { handler: id, name } = native.setFeature(kind, definition);
      handlers.delete(registered.get(name));
      handlers.set(id, handler);
      registered.set(name, id);
      return server;
    };
  }
  for (const [method, kind] of [
    ["removePrompt", "prompt"],
    ["removeResource", "resource"],
    ["removeResourceTemplate", "resourceTemplate"]
  ]) {
    server[method] = (name) => {
      const handler = native.removeFeature(kind, name);
      if (handler === null || handler === undefined) return false;
      handlers.delete(handler);
      featureHandlers.get(kind).delete(name);
      return true;
    };
  }
  return server;
}
