import { native } from "./native.js";
import { AcpError } from "./types.js";
import { isAcpError } from "./types.js";
import { StringDecoder } from "node:string_decoder";
export function parseJsonRpcMessage(line) {
  const parsed = native.acpParsePacket(line);
  if (parsed.type === "invalid")
    parsed.error = new AcpError(parsed.error.code, parsed.error.message, parsed.error.data);
  return parsed;
}
export function serializeJsonRpcMessage(message) {
  return JSON.stringify(message) + "\n";
}
export function createJsonRpcErrorResponse(id, error) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: error.code,
      message: error.message,
      ...(error.data === undefined ? {} : { data: error.data })
    }
  };
}
export class JsonRpcMessageLayer {
  constructor({ input, output, firstRequestId }) {
    this.input = input;
    this.output = output;
    this.native = new native.NativeAcpLayer(firstRequestId);
    this.handlers = new Map();
    this.pending = new Map();
    this.handlerId = 0;
    const decoder = new StringDecoder("utf8");
    this.onData = (chunk) => {
      try {
        const text =
          typeof chunk === "string"
            ? chunk
            : chunk instanceof Uint8Array
              ? decoder.write(Buffer.from(chunk))
              : String(chunk);
        this.apply(this.native.pushText(text));
      } catch (error) {
        this.dispose(error instanceof Error ? error : new Error(String(error)));
      }
    };
    this.onEnd = () => {
      try {
        this.apply(this.native.pushText(decoder.end()));
        this.apply(this.native.finishText());
      } catch (error) {
        this.dispose(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      queueMicrotask(() => this.dispose(new Error("JSON-RPC input stream closed")));
    };
    this.onError = (error) =>
      this.dispose(
        error instanceof Error ? error : new Error(`JSON-RPC input stream failed: ${String(error)}`)
      );
    input.on("error", this.onError);
    input.on("end", this.onEnd);
    input.on("data", this.onData);
  }
  onRequest(method, handler) {
    const id = ++this.handlerId,
      old = this.native.register(method, false, id);
    if (old != null) this.handlers.delete(old);
    this.handlers.set(id, handler);
  }
  onNotification(method, handler) {
    const id = ++this.handlerId,
      old = this.native.register(method, true, id);
    if (old != null) this.handlers.delete(old);
    this.handlers.set(id, handler);
  }
  pendingRequestCount() {
    return this.native.pendingCount;
  }
  sendNotification(method, params) {
    this.output.write(this.native.notification(method, JSON.stringify(params)));
  }
  sendRequest(method, params, options = {}) {
    const action = this.native.request(method, JSON.stringify(params), options.id);
    return new Promise((resolve, reject) => {
      this.pending.set(action.token, { resolve, reject });
      try {
        this.output.write(action.line);
      } catch (error) {
        this.native.cancel(action.token);
        this.pending.delete(action.token);
        reject(error);
      }
    });
  }
  apply(actions) {
    for (const action of actions) {
      if (typeof action === "string") {
        this.apply([this.native.incoming(action)]);
        continue;
      }
      if (action.type === "none") continue;
      if (action.type === "write") {
        this.native.assertOpen();
        this.output.write(action.line);
        continue;
      }
      if (action.type === "response") {
        const pending = this.pending.get(action.token);
        this.pending.delete(action.token);
        if (action.message.error !== undefined) {
          const error = action.message.error;
          pending?.reject(new AcpError(error.code, error.message, error.data));
        } else pending?.resolve(action.message.result);
        continue;
      }
      const handler = this.handlers.get(action.handler),
        message = action.message;
      if (action.type === "notification") {
        try {
          Promise.resolve(handler(message.params, { method: message.method })).catch(() => {});
        } catch {}
      } else {
        (async () => {
          let response;
          try {
            const result = await handler(message.params, {
              id: message.id,
              method: message.method
            });
            response = {
              jsonrpc: "2.0",
              id: message.id,
              result: result === undefined ? null : result
            };
          } catch (error) {
            const fault = isAcpError(error)
              ? error
              : new AcpError(
                  -32603,
                  error instanceof Error && error.message.length > 0
                    ? error.message
                    : "Internal error"
                );
            response = createJsonRpcErrorResponse(message.id, fault);
          }
          this.native.assertOpen();
          this.output.write(serializeJsonRpcMessage(response));
        })().catch((error) =>
          this.dispose(error instanceof Error ? error : new Error(String(error)))
        );
      }
    }
  }
  dispose(reason = new Error("JSON-RPC message layer disposed")) {
    this.native.dispose();
    this.input.off("data", this.onData);
    this.input.off("end", this.onEnd);
    this.input.off("error", this.onError);
    for (const pending of this.pending.values()) pending.reject(reason);
    this.pending.clear();
    this.handlers.clear();
  }
}
