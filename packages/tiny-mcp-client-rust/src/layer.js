import { createRequire } from "node:module";
import { McpError } from "./index.js";
const { NativeMessageLayer, NativeRetryState } = createRequire(import.meta.url)(
  "./tiny-mcp-client-rust.node"
);

function unwrap(value) {
  if (value.error !== undefined) {
    const { code, message, data } = value.error;
    throw code === undefined ? new Error(message) : new McpError(code, message, data);
  }
  return value;
}

async function* readLines(input) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let parts = [];
  let bytes = 0;
  function append(text) {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > 16 * 1024 * 1024)
      throw new Error("Stdio input line byte limit exceeded (16777216 bytes)");
    if (text.length) parts.push(text);
  }
  for await (const chunk of input) {
    const decoded =
      chunk instanceof Uint8Array
        ? decoder.decode(chunk, { stream: true })
        : decoder.decode() + String(chunk);
    let start = 0;
    for (let end = decoded.indexOf("\n"); end !== -1; end = decoded.indexOf("\n", start)) {
      append(decoded.slice(start, end));
      const line = parts.join("");
      yield line.endsWith("\r") ? line.slice(0, -1) : line;
      parts = [];
      bytes = 0;
      start = end + 1;
    }
    append(decoded.slice(start));
  }
  append(decoder.decode());
  if (parts.length) {
    const line = parts.join("");
    yield line.endsWith("\r") ? line.slice(0, -1) : line;
  }
}

export class JsonRpcMessageLayer {
  requestMetadata;
  #native;
  #input;
  #output;
  #closedReason;
  #disposed;
  #pending = new Map();
  #exchanges = new Map();
  #incoming = new Map();
  #handlers = new Map();
  #notifications = new Map();
  #inputHandlers = new Map();
  constructor(
    input,
    output,
    requestTimeoutMs = 30000,
    inputClosedReason,
    maxConcurrentRequests = 128
  ) {
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 0)
      throw new Error("requestTimeoutMs must be a non-negative finite number");
    this.#native = new NativeMessageLayer(maxConcurrentRequests);
    this.#input = input;
    this.#output = output;
    this.#closedReason = inputClosedReason;
    this.requestTimeoutMs = requestTimeoutMs;
    output.once("error", (reason) => this.dispose(reason));
    output.once("close", () => {
      if (this.#disposed === undefined)
        void this.#streamReason(new Error("JSON-RPC output closed")).then((reason) =>
          this.dispose(reason)
        );
    });
    void this.#consume();
  }
  onRequest(method, handler) {
    this.#handlers.set(method, handler);
    this.#native.registerRequest(method);
  }
  onNotification(method, handler) {
    this.#notifications.set(method, handler);
  }
  onInputRequest(method, handler) {
    this.#inputHandlers.set(method, handler);
  }
  sendNotification(method, params) {
    if (this.#disposed !== undefined) throw this.#disposed;
    this.#output.write(unwrap(this.#native.notification(method, params)).line);
  }
  sendRequest(method, params, options = {}) {
    if (this.#disposed !== undefined) throw this.#disposed;
    const timeoutMs =
      options.timeoutMs === null ? null : (options.timeoutMs ?? this.requestTimeoutMs);
    if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs < 0))
      throw new Error("timeoutMs must be a non-negative finite number");
    const token = this.#native.beginExchange();
    const controller = new AbortController();
    this.#exchanges.set(token, controller);
    const forward = () => controller.abort(options.signal.reason);
    options.signal?.addEventListener("abort", forward, { once: true });
    let id;
    let rejectAbort;
    const aborted = new Promise((_resolve, reject) => {
      rejectAbort = reject;
    });
    const cancel = () => {
      if (id !== undefined) this.cancelRequest(id, controller.signal.reason);
      rejectAbort(controller.signal.reason);
    };
    controller.signal.addEventListener("abort", cancel, { once: true });
    const once = (args) =>
      new Promise((resolve, reject) => {
        try {
          const prepared = unwrap(
            this.#native.prepareRequest(token, method, args, this.requestMetadata)
          );
          id = prepared.id;
          options.onRequestId?.(id);
          if (options.signal?.aborted) forward();
          controller.signal.throwIfAborted();
          const timeout =
            timeoutMs === null
              ? undefined
              : setTimeout(() => {
                  this.#native.cancelRequest(id);
                  this.#pending.delete(id);
                  try {
                    options.onTimeout?.(id);
                  } finally {
                    reject(
                      new Error(`JSON-RPC request "${method}" timed out after ${timeoutMs}ms`)
                    );
                  }
                }, timeoutMs);
          this.#pending.set(id, { resolve, reject, timeout });
          try {
            this.#output.write(prepared.line);
          } catch (error) {
            this.cancelRequest(id, error);
          }
        } catch (error) {
          reject(error);
        }
      });
    const work = (async () => {
      let retry;
      if (this.requestMetadata !== undefined) {
        try {
          retry = new NativeRetryState(method, params);
        } catch (error) {
          throw new McpError(-32602, error.message);
        }
      }
      let args = params;
      if (options.signal?.aborted) forward();
      while (true) {
        if (this.#disposed !== undefined) throw this.#disposed;
        controller.signal.throwIfAborted();
        const result = await once(args);
        if (this.requestMetadata === undefined) return result;
        if (retry === undefined) retry = new NativeRetryState(method, params);
        const action = unwrap(
          retry.processResult(result, this.requestMetadata, [...this.#inputHandlers.keys()])
        );
        if (action.type === "complete") return action.result;
        for (const request of action.requests) {
          if (this.#disposed !== undefined) throw this.#disposed;
          controller.signal.throwIfAborted();
          const response = await this.#inputHandlers.get(request.method)(request.params, {
            id: request.key,
            method: request.method,
            signal: controller.signal
          });
          unwrap(retry.recordResponse(request.key, request.method, response));
        }
        if (this.#disposed !== undefined) throw this.#disposed;
        controller.signal.throwIfAborted();
        args = retry.nextParams();
      }
    })();
    if (options.signal?.aborted) forward();
    return Promise.race([work, aborted]).finally(() => {
      options.signal?.removeEventListener("abort", forward);
      controller.signal.removeEventListener("abort", cancel);
      this.#exchanges.delete(token);
      this.#native.finishExchange(token);
    });
  }
  cancelRequest(id, reason) {
    const pending = this.#pending.get(id);
    if (pending === undefined) return false;
    const canceled = this.#native.cancelRequest(id);
    if (!canceled) return false;
    this.#pending.delete(id);
    if (pending !== undefined) {
      clearTimeout(pending.timeout);
      pending.reject(reason);
    }
    return true;
  }
  dispose(reason = new Error("JSON-RPC message layer disposed")) {
    if (this.#disposed !== undefined) return;
    this.#disposed = reason;
    for (const controller of this.#exchanges.values()) controller.abort(reason);
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(reason);
    }
    this.#pending.clear();
    for (const controller of this.#incoming.values()) controller.abort(reason);
    this.#incoming.clear();
    this.#native.dispose();
  }
  async #streamReason(fallback = new Error("JSON-RPC input stream closed")) {
    if (this.#closedReason === undefined) return fallback;
    let timeout;
    try {
      return await Promise.race([
        this.#closedReason,
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve(fallback), 50);
        })
      ]);
    } catch {
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  }
  async #consume() {
    try {
      for await (const line of readLines(this.#input)) {
        if (this.#disposed !== undefined) break;
        this.#native.feed(line);
        while (this.#disposed === undefined) {
          this.#native.setModern(this.requestMetadata !== undefined);
          const event = this.#native.nextEvent();
          if (event === null || event === undefined) break;
          if (event.type === "write") this.#output.write(event.line);
          else if (event.type === "settle") {
            const pending = this.#pending.get(event.id);
            this.#pending.delete(event.id);
            if (pending === undefined) continue;
            clearTimeout(pending.timeout);
            if (Object.hasOwn(event, "result")) pending.resolve(event.result);
            else
              pending.reject(new McpError(event.error.code, event.error.message, event.error.data));
          } else if (event.type === "cancel")
            this.#incoming.get(event.token)?.abort(new Error(event.reason));
          else if (event.type === "notification") {
            try {
              await this.#notifications.get(event.method)?.(event.params, { method: event.method });
            } catch {
              // Observer failures do not terminate message input.
            }
          } else if (event.type === "invoke")
            void this.#invoke(event).catch((error) => this.dispose(error));
        }
      }
      if (this.#disposed === undefined) this.dispose(await this.#streamReason());
    } catch (error) {
      this.dispose(
        error instanceof Error ? error : new Error(`JSON-RPC input stream failed: ${String(error)}`)
      );
    }
  }
  async #invoke(event) {
    const controller = new AbortController();
    this.#incoming.set(event.token, controller);
    try {
      const invalid = this.#native.validateIncoming(event.token, event.params);
      if (invalid !== undefined && invalid !== null) {
        this.#output.write(invalid);
        return;
      }
      const result = await this.#handlers.get(event.method)(event.params, {
        id: event.id,
        method: event.method,
        signal: controller.signal
      });
      if (this.#disposed !== undefined || controller.signal.aborted) return;
      const line = this.#native.completeIncoming(event.token, result, false);
      if (line !== undefined && line !== null) this.#output.write(line);
    } catch (error) {
      if (this.#disposed !== undefined || controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      const line = this.#native.completeIncoming(
        event.token,
        { code: error instanceof McpError ? error.code : -32603, message },
        true
      );
      if (line !== undefined && line !== null) this.#output.write(line);
    } finally {
      this.#incoming.delete(event.token);
      this.#native.finishIncoming(event.token);
    }
  }
}
