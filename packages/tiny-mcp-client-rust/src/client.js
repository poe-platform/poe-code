import { createRequire } from "node:module";
import { JsonRpcMessageLayer, McpError } from "./index.js";
import { SubscriptionManager } from "./subscriptions.js";
const { NativeClient, validateProtocolPin } = createRequire(import.meta.url)("./tiny-mcp-client-rust.node");
function unwrap(value) {
  if (value.error !== undefined) {
    const { code, message } = value.error;
    throw code === undefined ? new Error(message) : new McpError(code, message);
  }
  return value;
}
export class McpClient {
  #core = new NativeClient();
  #options;
  #layer;
  #transport;
  #generation;
  #subscriptions;
  #resources = new Map();
  constructor(options) {
    this.#options = options;
  }
  get state() {
    return this.#core.status;
  }
  get serverCapabilities() {
    return this.#core.serverCapabilities;
  }
  get serverInfo() {
    return this.#core.serverInfo;
  }
  get instructions() {
    return this.#core.instructions ?? undefined;
  }
  async connect(transport, options = {}) {
    if (this.#options.protocolVersion !== undefined) {
      if (typeof this.#options.protocolVersion !== "string")
        throw new Error("Unsupported protocolVersion; use 2025-03-26 or 2026-07-28");
      validateProtocolPin(this.#options.protocolVersion);
    }
    options.signal?.throwIfAborted();
    const generation = unwrap(this.#core.beginConnect()).generation;
    let layer;
    try {
      const closedReason = transport.closed
        .then((event) => event.reason)
        .catch((error) => (error instanceof Error ? error : new Error(String(error))));
      layer = new JsonRpcMessageLayer(
        transport.readable,
        transport.writable,
        this.#options.requestTimeoutMs,
        closedReason,
        this.#options.maxConcurrentRequests
      );
      this.#layer = layer;
      this.#transport = transport;
      this.#generation = generation;
      this.#subscriptions = undefined;
      this.#resources.clear();
      transport.closed.then(
        (event) => {
          if (this.#transport !== transport || this.#generation !== generation) return;
          layer.dispose(event.reason);
          this.#layer = undefined;
          this.#transport = undefined;
          this.#core.connectionClosed(generation);
        },
        (error) => {
          if (this.#transport !== transport || this.#generation !== generation) return;
          layer.dispose(error instanceof Error ? error : new Error(String(error)));
          this.#layer = undefined;
          this.#transport = undefined;
          this.#core.connectionClosed(generation);
        }
      );
      layer.onRequest("ping", () => ({}));
      const { onSamplingRequest, onRootsList, onElicitationRequest } = this.#options;
      if (onSamplingRequest !== undefined) {
        layer.onRequest("sampling/createMessage", onSamplingRequest);
        layer.onInputRequest("sampling/createMessage", onSamplingRequest);
      }
      if (onRootsList !== undefined)
        layer.onInputRequest("roots/list", async (_params, context) => ({
          roots: await onRootsList(context)
        }));
      if (onElicitationRequest !== undefined)
        layer.onInputRequest("elicitation/create", onElicitationRequest);
      for (const [method, callback] of [
        ["notifications/tools/list_changed", this.#options.onToolsChanged],
        ["notifications/prompts/list_changed", this.#options.onPromptsChanged],
        ["notifications/resources/list_changed", this.#options.onResourcesChanged],
        ["notifications/resources/updated", this.#options.onResourceUpdated],
        ["notifications/message", this.#options.onLog],
        ["notifications/progress", this.#options.onProgress]
      ]) {
        if (callback === undefined) continue;
        layer.onNotification(method, async (params) => {
          const streamNotification = method.endsWith("/list_changed") || method === "notifications/resources/updated";
          if (this.#core.modern && streamNotification) {
            if (!this.#subscriptions?.filters.accepts(method, params)) return;
          } else if (!this.#core.notificationAllowed(method, params)) return;
          if (method === "notifications/resources/updated") await callback(params.uri);
          else if (method === "notifications/message")
            await callback({
              level: params.level,
              data: params.data,
              ...(params.logger === undefined ? {} : { logger: params.logger })
            });
          else if (method === "notifications/progress")
            await callback({
              progressToken: params.progressToken,
              progress: params.progress,
              ...(params.total === undefined ? {} : { total: params.total }),
              ...(params.message === undefined ? {} : { message: params.message })
            });
          else await callback();
        });
      }
      const capabilities = unwrap(
        this.#core.prepareCapabilities(
          this.#options.capabilities,
          onRootsList !== undefined,
          onSamplingRequest !== undefined,
          onElicitationRequest !== undefined
        )
      ).capabilities;
      let discovery;
      try {
        if (this.#options.protocolVersion !== "2025-03-26")
          discovery = await layer.sendRequest(
            "server/discover",
            {
              _meta: {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": capabilities
              }
            },
            {
              signal: options.signal,
              timeoutMs:
                this.#options.protocolVersion === "2026-07-28"
                  ? (this.#options.requestTimeoutMs ?? 30000)
                  : Math.min(this.#options.requestTimeoutMs ?? 30000, 1000)
            }
          );
      } catch (error) {
        options.signal?.throwIfAborted();
        if (this.#options.protocolVersion === "2026-07-28") throw error;
        if (error instanceof McpError && [-32020, -32021, -32022].includes(error.code)) throw error;
      }
      if (discovery !== undefined) {
        const connected = unwrap(this.#core.acceptConnection(generation, discovery, true)).result;
        layer.requestMetadata = {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": capabilities
        };
        this.#subscriptions = new SubscriptionManager(layer);
        const filter = {
          ...(this.#options.onToolsChanged === undefined ? {} : { toolsListChanged: true }),
          ...(this.#options.onPromptsChanged === undefined ? {} : { promptsListChanged: true }),
          ...(this.#options.onResourcesChanged === undefined ? {} : { resourcesListChanged: true })
        };
        if (Object.keys(filter).length > 0) await this.#subscriptions.listen(filter, options);
        return connected;
      }
      const initialized = unwrap(
        this.#core.acceptConnection(
          generation,
          await layer.sendRequest(
            "initialize",
            {
              protocolVersion: "2025-03-26",
              capabilities,
              clientInfo: this.#options.clientInfo
            },
            { signal: options.signal }
          ),
          false
        )
      ).result;
      if (onRootsList !== undefined)
        layer.onRequest("roots/list", async (_params, context) => ({
          roots: await onRootsList(context)
        }));
      if (onElicitationRequest !== undefined)
        layer.onRequest("elicitation/create", onElicitationRequest);
      if (transport.completeInitialization === undefined) layer.sendNotification("notifications/initialized");
      else await transport.completeInitialization({ signal: options.signal, timeoutMs: this.#options.requestTimeoutMs ?? 30000 });
      unwrap(this.#core.completeInitialize(generation));
      return initialized;
    } catch (error) {
      if (this.#generation === generation || this.#layer === undefined) {
        const reason = error instanceof Error ? error : new Error(String(error));
        layer?.dispose(reason);
        transport.dispose(reason);
        this.#layer = undefined;
        this.#transport = undefined;
        this.#core.connectionFailed(generation);
      }
      throw error;
    }
  }
  async listTools(params = {}, options = {}) {
    unwrap(this.#core.checkCapability("tools"));
    const result = await this.#layer.sendRequest(
      "tools/list",
      params.cursor === undefined ? undefined : { cursor: params.cursor },
      options
    );
    unwrap(this.#core.validateResult("tools/list", result));
    return {
      ...result,
      tools:
        this.#transport?.filterTools?.(result.tools, params.cursor === undefined) ?? result.tools
    };
  }
  async callTool(params, options = {}) {
    unwrap(this.#core.checkCapability("tools"));
    options.signal?.throwIfAborted();
    const layer = this.#layer;
    const requestParams =
      options.progressToken === undefined
        ? params
        : { ...params, _meta: { progressToken: options.progressToken } };
    this.#core.trackProgress(options.progressToken, true);
    let id;
    let sent = false;
    const cancel = () => {
      if (id === undefined || sent) return;
      sent = true;
      layer.sendNotification("notifications/cancelled", { requestId: id });
    };
    const abort = () => {
      cancel();
      if (id !== undefined) layer.cancelRequest(id, options.signal.reason);
    };
    try {
      const pending = layer.sendRequest("tools/call", requestParams, {
        signal: options.signal,
        onRequestId(next) {
          id = next;
        },
        onTimeout: cancel
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      const result = await pending;
      unwrap(this.#core.validateResult("tools/call", result));
      return result;
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.#core.trackProgress(options.progressToken, false);
    }
  }
  async listResources(params = {}, options = {}) {
    unwrap(this.#core.checkCapability("resources"));
    const result = await this.#layer.sendRequest(
      "resources/list",
      params.cursor === undefined ? undefined : { cursor: params.cursor },
      options
    );
    unwrap(this.#core.validateResult("resources/list", result));
    return result;
  }
  async listResourceTemplates(params = {}, options = {}) {
    unwrap(this.#core.checkCapability("resources"));
    const result = await this.#layer.sendRequest(
      "resources/templates/list",
      params.cursor === undefined ? undefined : { cursor: params.cursor },
      options
    );
    unwrap(this.#core.validateResult("resources/templates/list", result));
    return result;
  }
  async readResource(params, options = {}) {
    unwrap(this.#core.checkCapability("resources"));
    const result = await this.#layer.sendRequest("resources/read", params, options);
    unwrap(this.#core.validateResult("resources/read", result));
    return result;
  }
  async listPrompts(params = {}, options = {}) {
    unwrap(this.#core.checkCapability("prompts"));
    return await this.#layer.sendRequest(
      "prompts/list",
      params.cursor === undefined ? undefined : { cursor: params.cursor },
      options
    );
  }
  async listenNotifications(filter, options = {}) {
    unwrap(this.#core.checkConnection());
    if (!this.#core.modern || this.#subscriptions === undefined)
      throw new Error("Notification streams require modern MCP");
    return await this.#subscriptions.listen(filter, options);
  }
  async subscribe(uri, options = {}) {
    options.signal?.throwIfAborted();
    unwrap(this.#core.checkResourceSubscriptions());
    if (!this.#core.modern) {
      await this.#layer.sendRequest("resources/subscribe", { uri }, options);
      this.#core.setSubscription(uri, true);
      return;
    }
    const existing = this.#resources.get(uri);
    if (existing !== undefined) {
      if (options.signal === undefined) await existing.subscription;
      else {
        let abort;
        const canceled = new Promise((_resolve, reject) => {
          abort = () => reject(options.signal.reason);
          options.signal.addEventListener("abort", abort, { once: true });
        });
        try { options.signal.throwIfAborted(); await Promise.race([existing.subscription, canceled]); }
        finally { options.signal.removeEventListener("abort", abort); }
      }
      return;
    }
    const controller = new AbortController();
    const abortSetup = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abortSetup, { once: true });
    const resources = this.#resources;
    const subscribing = this.#subscriptions.listen({ resourceSubscriptions: [uri] }, { signal: controller.signal }).then(listening => {
      if (resources.get(uri)?.subscription !== subscribing) {
        listening.cancel();
        throw new Error("Resource subscription canceled");
      }
      if (!listening.notifications.resourceSubscriptions?.includes(uri)) {
        listening.cancel();
        throw new Error("Server declined the resource subscription");
      }
      this.#core.setSubscription(uri, true);
      void listening.closed.finally(() => {
        if (resources.get(uri)?.subscription === subscribing) {
          resources.delete(uri);
          this.#core.setSubscription(uri, false);
        }
      }).catch(() => undefined);
      return listening;
    }).finally(() => options.signal?.removeEventListener("abort", abortSetup));
    resources.set(uri, { controller, subscription: subscribing });
    try { await subscribing; }
    catch (error) {
      if (resources.get(uri)?.subscription === subscribing) resources.delete(uri);
      throw error;
    }
  }
  async unsubscribe(uri, options = {}) {
    options.signal?.throwIfAborted();
    unwrap(this.#core.checkResourceSubscriptions());
    if (!this.#core.modern) {
      await this.#layer.sendRequest("resources/unsubscribe", { uri }, options);
      this.#core.setSubscription(uri, false);
      return;
    }
    const pending = this.#resources.get(uri);
    this.#resources.delete(uri);
    this.#core.setSubscription(uri, false);
    pending?.controller.abort(new Error("Resource subscription canceled"));
  }
  async getPrompt(params, options = {}) {
    unwrap(this.#core.checkCapability("prompts"));
    const result = await this.#layer.sendRequest("prompts/get", params, options);
    unwrap(this.#core.validateResult("prompts/get", result));
    return result;
  }
  async complete(params, options = {}) {
    unwrap(this.#core.checkCapability("completions"));
    const result = await this.#layer.sendRequest("completion/complete", params, options);
    unwrap(this.#core.validateResult("completion/complete", result));
    return result;
  }
  async setLogLevel(level, options = {}) {
    options.signal?.throwIfAborted();
    unwrap(this.#core.checkConnection());
    if (this.#core.modern) throw new Error("Log level changes require legacy MCP");
    unwrap(this.#core.checkCapability("logging"));
    await this.#layer.sendRequest("logging/setLevel", { level }, options);
  }
  async cancel(requestId, reason) {
    unwrap(this.#core.checkConnection());
    this.#layer.sendNotification("notifications/cancelled", {
      requestId,
      ...(reason === undefined ? {} : { reason })
    });
  }
  async sendRootsChanged() {
    unwrap(this.#core.checkConnection());
    if (!this.#core.rootsChangesAllowed)
      throw new Error("Client did not advertise roots list changes");
    this.#layer.sendNotification("notifications/roots/list_changed");
  }
  async ping(options = {}) {
    unwrap(this.#core.checkConnection());
    await this.#layer.sendRequest(
      this.#core.modern ? "server/discover" : "ping",
      undefined,
      options
    );
  }
  async close() {
    if (this.state === "closed") return;
    const reason = new Error("MCP client closed");
    this.#subscriptions?.close();
    this.#subscriptions = undefined;
    this.#resources.clear();
    this.#layer?.dispose(reason);
    this.#transport?.dispose(reason);
    this.#layer = undefined;
    this.#transport = undefined;
    this.#core.close();
  }
}
