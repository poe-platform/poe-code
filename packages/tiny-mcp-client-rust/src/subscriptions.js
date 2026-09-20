import { createRequire } from "node:module";
const { NativeSubscriptions } = createRequire(import.meta.url)("./tiny-mcp-client-rust.node");
function unwrap(result) {
  if (result.error !== undefined) throw new Error(result.error);
  return result;
}
export class SubscriptionManager {
  filters = new NativeSubscriptions();
  #entries = new Map();
  #layer;
  constructor(layer) {
    this.#layer = layer;
    layer.onNotification("notifications/subscriptions/acknowledged", params => {
      const ack = this.filters.acknowledge(params);
      if (ack.id === undefined) return;
      const entry = this.#entries.get(ack.id);
      if (entry === undefined) return;
      if (ack.error !== undefined) { entry.reject(new Error(ack.error)); entry.cancel(); }
      else { clearTimeout(entry.timer); entry.acknowledge(ack.filter); }
    });
  }
  async listen(filter, options = {}) {
    options.signal?.throwIfAborted();
    const requested = unwrap(this.filters.normalize(filter)).filter;
    let id;
    let canceled = false;
    let acknowledge;
    let reject;
    const acknowledged = new Promise((resolve, fail) => { acknowledge = resolve; reject = fail; });
    const entry = { acknowledge, reject, timer: undefined, cancel: undefined };
    const cancel = () => {
      if (canceled) return;
      canceled = true;
      clearTimeout(entry.timer);
      this.#entries.delete(id);
      this.filters.remove(id);
      const reason = new Error("MCP subscription canceled");
      reject(reason);
      if (this.#layer.cancelRequest(id, reason)) {
        try { this.#layer.sendNotification("notifications/cancelled", { requestId: id }); }
        catch { /* transport already disposed */ }
      }
    };
    entry.cancel = cancel;
    const completion = this.#layer.sendRequest("subscriptions/listen", { notifications: requested }, {
      timeoutMs: null,
      onRequestId: next => {
        id = next;
        unwrap(this.filters.register(id, requested));
        this.#entries.set(id, entry);
      }
    });
    entry.timer = setTimeout(() => { reject(new Error("MCP subscription acknowledgement timed out")); cancel(); }, this.#layer.requestTimeoutMs);
    const abort = () => { reject(options.signal.reason); cancel(); };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const closed = completion.then(result => { unwrap(this.filters.validateCompletion(id, result)); }).catch(error => {
      reject(error instanceof Error ? error : new Error(String(error)));
      if (!canceled) throw error;
    }).finally(() => {
      options.signal?.removeEventListener("abort", abort);
      clearTimeout(entry.timer);
      this.#entries.delete(id);
      this.filters.remove(id);
    });
    void closed.catch(() => undefined);
    try {
      const accepted = await acknowledged;
      return { id, notifications: accepted, closed, cancel };
    } catch (error) { cancel(); throw error; }
  }
  close() {
    for (const entry of this.#entries.values()) entry.cancel();
    this.#entries.clear();
    this.filters.clear();
  }
}
