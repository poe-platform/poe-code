import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { readLines } from "./layer.js";
import { OAuthMetadataDiscovery, parseBearerWwwAuthenticateHeader } from "./oauth-discovery.js";
import { createOAuthClientProvider } from "./oauth/provider.js";
import { OAuthError } from "./oauth/tokens.js";
import { fetchMcpResponse, readBoundedResponseText } from "./oauth/http.js";
const { NativeHttpTransport, NativeSseParser, httpResponseKind, validateRequestTimeout } = createRequire(import.meta.url)("./tiny-mcp-client-rust.node");

export class HttpTransportError extends Error {
  constructor(message, status, method, rpcMethod) {
    super(message);
    this.name = "HttpTransportError";
    this.status = status;
    this.method = method;
    this.rpcMethod = rpcMethod;
  }
}

export class HttpTransport {
  #state;
  #url;
  #mode;
  #endpoint;
  #endpointReady;
  #resolveEndpoint;
  #rejectEndpoint;
  #headers;
  #fetch;
  #warning;
  #provider;
  #discovery;
  #controllers = new Map();
  #fetches = new Set();
  #oauthControllers = new Set();
  #readers = new Set();
  #initializing = false;
  #resolveClosed;
  #resolveCloseReason;
  #read = new PassThrough();
  #write = new PassThrough();
  constructor({ url, mode = "streamable-http", headers = {}, fetch, oauth, oauthDiscoveryCache, onWarning, maxResponseBytes = 16 * 1024 * 1024 }) {
    try { this.#state = new NativeHttpTransport(maxResponseBytes); }
    catch (error) { throw new Error(error.message); }
    this.#url = url;
    this.#mode = mode;
    this.#headers = headers;
    this.#fetch = fetch;
    this.#warning = onWarning;
    this.#provider = oauth === undefined ? undefined : createOAuthClientProvider(oauth);
    this.#discovery = oauth === undefined ? undefined : new OAuthMetadataDiscovery({ fetch: this.#fetchWithAbort.bind(this), cache: oauthDiscoveryCache });
    this.readable = this.#read;
    this.writable = this.#write;
    this.closeReason = new Promise(resolve => { this.#resolveCloseReason = resolve; });
    this.closed = new Promise(resolve => { this.#resolveClosed = resolve; });
    for (const stream of [this.#read, this.#write]) stream.once("error", error => {
      this.dispose(error instanceof Error ? error : new Error(String(error)));
    });
    void this.#consumeLines().catch(error => { this.dispose(error instanceof Error ? error : new Error(String(error))); });
  }
  filterTools(tools, reset = true) {
    if (reset) this.#state.clearTools();
    const accepted = [];
    for (const tool of tools) {
      try { this.#state.filterTool(tool.name, tool.inputSchema); accepted.push(tool); }
      catch (error) { this.#warning?.(`Rejected MCP tool ${tool.name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    return accepted;
  }
  async completeInitialization(options) {
    if (options.timeoutMs !== null) validateRequestTimeout(options.timeoutMs, "timeoutMs");
    if (options.protocolVersion !== undefined) this.#state.setLegacyVersion(options.protocolVersion);
    this.#maybeStartGet();
    const deadline = options.timeoutMs > 0 ? AbortSignal.timeout(Math.ceil(options.timeoutMs)) : undefined;
    const signals = [options.signal, deadline].filter(signal => signal !== undefined);
    const signal = signals.length === 0 ? new AbortController().signal : AbortSignal.any(signals);
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const line = '{"jsonrpc":"2.0","method":"notifications/initialized"}';
    try {
      await this.#sendPost(line, this.#state.prepare(line), controller);
      signal.throwIfAborted();
      if (this.#state.disposed) throw await this.closeReason;
    } catch (error) {
      if (error instanceof HttpTransportError)
        throw new HttpTransportError(error.message, error.status, error.method, "notifications/initialized");
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  dispose(reason = new Error("HTTP transport disposed")) {
    const disposal = this.#state.dispose();
    if (disposal === null) return;
    this.#resolveCloseReason?.(reason);
    this.#resolveCloseReason = undefined;
    this.#rejectEndpoint?.(reason);
    this.#resolveEndpoint = undefined;
    this.#rejectEndpoint = undefined;
    for (const slot of disposal.slots) this.#controllers.get(slot)?.abort(reason);
    this.#controllers.clear();
    for (const controller of this.#fetches) controller.abort(reason);
    this.#fetches.clear();
    for (const controller of this.#oauthControllers) controller.abort(reason);
    this.#oauthControllers.clear();
    for (const reader of this.#readers) void reader.cancel().catch(() => undefined);
    this.#readers.clear();
    for (const stream of [this.#read, this.#write]) {
      if (!stream.destroyed && !stream.writableEnded) stream.end();
    }
    void this.#close(disposal.session, reason);
  }
  async #close(session, reason) {
    let closeReason = reason;
    if (session !== null) {
      const controller = new AbortController();
      let timeout;
      const expired = new Promise((_resolve, reject) => {
        timeout = setTimeout(() => {
          const error = new Error("HTTP transport session termination timed out");
          controller.abort(error);
          reject(error);
        }, 1000);
      });
      try { await Promise.race([this.#terminate(session, controller.signal), expired]); }
      catch (error) { closeReason = error instanceof Error ? error : new Error(String(error)); }
      finally { clearTimeout(timeout); }
    }
    const resolve = this.#resolveClosed;
    this.#resolveClosed = undefined;
    resolve?.({ reason: closeReason });
  }
  async #fetchWithAbort(input, init = {}, controller = new AbortController()) {
    if (this.#state.disposed) throw new Error("HTTP transport disposed");
    controller.signal.throwIfAborted();
    const signal = init.signal == null ? controller.signal : AbortSignal.any([init.signal, controller.signal]);
    signal.throwIfAborted();
    this.#fetches.add(controller);
    try { return await fetchMcpResponse(this.#fetch ?? globalThis.fetch, input, { ...init, signal }); }
    finally { this.#fetches.delete(controller); }
  }
  async #consumeLines() {
    for await (const line of readLines(this.#write)) {
      if (this.#state.disposed || line.length === 0) continue;
      const post = this.#state.prepare(line);
      if (post.cancelled) { this.#controllers.get(post.cancelSlot)?.abort(); continue; }
      const work = this.#sendPost(line, post);
      if (post.ordered) {
        try { await work; }
        catch (error) { this.dispose(error instanceof Error ? error : new Error(String(error))); }
      }
      else void work.catch(error => { this.dispose(error instanceof Error ? error : new Error(String(error))); });
    }
  }
  async #sendPost(line, post, completionController) {
    if (post.initializing) this.#initializing = true;
    const slot = post.slot;
    const controller = completionController ?? (slot === null ? undefined : new AbortController());
    if (controller !== undefined) this.#controllers.set(slot, controller);
    try {
      const endpoint = this.#mode === "sse" ? await this.#ensureEndpoint() : this.#url;
      if (this.#state.disposed) return;
      const response = await this.#fetchRetry("POST", post, line, controller, endpoint);
      if (this.#state.disposed || controller?.signal.aborted) { void response.body?.cancel().catch(() => undefined); return; }
      if (post.hasSession && response.status === 404) {
        void response.body?.cancel().catch(() => undefined);
        this.#state.expireSession();
        this.dispose(new Error("HTTP transport session expired (404 response)"));
        return;
      }
      if (response.status >= 400) {
        const body = (await readBoundedResponseText(response, this.#state.maxResponseBytes, this.#readers, controller?.signal)).trim();
        const errorLine = post.errorLine(response.status, body);
        if (errorLine !== null) { this.#emit(errorLine); return; }
        throw this.#failure("POST", response, body);
      }
      if (this.#state.disposed || controller?.signal.aborted) { void response.body?.cancel().catch(() => undefined); return; }
      if (this.#mode !== "sse" && !post.modern) { this.#state.captureSession(response.headers.get("Mcp-Session-Id")); if (!post.ordered) this.#maybeStartGet(); }
      if (controller !== undefined) await this.#forward(response, controller.signal, post.responseContext());
      else if (post.ordered) { await this.#forward(response, undefined, undefined, post.initializing); this.#maybeStartGet(); }
      else void this.#forward(response).catch(error => { this.dispose(error instanceof Error ? error : new Error(String(error))); });
    } catch (error) { if (!controller?.signal.aborted) throw error; }
    finally { this.#state.finish(post); if (controller !== undefined) this.#controllers.delete(slot); }
  }
  async #requestHeaders(method, post, session, signal) {
    const headers = new Headers(this.#headers);
    if (method === "POST") {
      let changes;
      try { changes = this.#state.postHeaders(post); }
      catch (error) { throw new Error(error.message); }
      for (const [name, value] of changes) {
        if (value === null) headers.delete(name);
        else headers.set(name, value);
      }
    } else if (method === "GET") {
      for (const [name, value] of this.#state.getHeaders()) headers.set(name, value);
    } else {
      headers.set("Mcp-Session-Id", session);
      headers.set("MCP-Protocol-Version", this.#state.legacyVersion);
    }
    signal?.throwIfAborted();
    const tokens = await this.#provider?.authorizeRequest?.({
      requestUrl: new URL(this.#url), headers, signal,
      fetch: (url, init) => fetchMcpResponse(this.#fetch ?? globalThis.fetch, url, {
        ...init, signal: signal === undefined ? init?.signal : init?.signal == null ? signal : AbortSignal.any([signal, init.signal]),
      }),
    });
    signal?.throwIfAborted();
    return { headers, tokens: tokens === undefined ? null : { ...tokens } };
  }
  #ensureEndpoint() {
    if (this.#endpointReady !== undefined) return this.#endpointReady;
    this.#endpointReady = new Promise((resolve, reject) => {
      this.#resolveEndpoint = resolve;
      this.#rejectEndpoint = reject;
    });
    void this.#consumeGet().catch(error => {
      this.dispose(error instanceof Error ? error : new Error(String(error)));
    });
    return this.#endpointReady;
  }
  #maybeStartGet() {
    if (!this.#state.beginGet()) return;
    void this.#consumeGet().catch(error => {
      if (!this.#state.disposed) this.dispose(error instanceof Error ? error : new Error(String(error)));
    });
  }
  async #consumeGet() {
    const response = await this.#fetchRetry("GET");
    if (this.#state.disposed) { void response.body?.cancel().catch(() => undefined); return; }
    if (response.status === 405) {
      void response.body?.cancel().catch(() => undefined);
      if (this.#mode === "sse") throw this.#failure("GET", response, "");
      return;
    }
    if (response.status === 404) {
      void response.body?.cancel().catch(() => undefined);
      this.#state.expireSession();
      throw new HttpTransportError("HTTP transport session expired (GET 404 response)", 404, "GET");
    }
    if (!response.ok) {
      const body = (await readBoundedResponseText(response, this.#state.maxResponseBytes, this.#readers)).trim();
      throw this.#failure("GET", response, body);
    }
    if (httpResponseKind(200, response.headers.get("Content-Type")) !== "sse") {
      void response.body?.cancel().catch(() => undefined);
      if (this.#mode === "sse") throw new Error("Legacy SSE GET returned an unsupported content type");
      return;
    }
    await this.#consumeSse(response, undefined, undefined, this.#mode === "sse");
    if (this.#mode === "sse") {
      if (!this.#state.disposed) throw new Error("Legacy SSE stream ended");
      return;
    }
    if (this.#state.finishGet()) this.#maybeStartGet();
  }
  async #terminate(session, signal) {
    const { headers } = await this.#requestHeaders("DELETE", undefined, session, signal);
    signal.throwIfAborted();
    const response = await fetchMcpResponse(this.#fetch ?? globalThis.fetch, this.#url, { method: "DELETE", headers, signal });
    if (signal.aborted) { void response.body?.cancel().catch(() => undefined); signal.throwIfAborted(); }
    if (response.ok || response.status === 405) { void response.body?.cancel().catch(() => undefined); return; }
    const body = (await readBoundedResponseText(response, this.#state.maxResponseBytes, this.#readers, signal)).trim();
    throw this.#failure("DELETE", response, body);
  }
  #failure(method, response, body) {
    const status = `${response.status} ${response.statusText}`.trim();
    return new HttpTransportError(`HTTP transport ${method} failed (${status})${body.length === 0 ? "" : `: ${body}`}`, response.status, method);
  }
  async #fetchRetry(method, post, body, controller = new AbortController(), endpoint = this.#url) {
    this.#oauthControllers.add(controller);
    try {
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        controller.signal.throwIfAborted();
        const { headers, tokens } = await this.#requestHeaders(method, post, undefined, controller.signal);
        const requestHeaders = new Headers(headers);
        controller.signal.throwIfAborted();
        response = await this.#fetchWithAbort(endpoint, { method, headers, body }, controller);
        if (attempt === 0 && await this.#unauthorized(response, controller.signal, requestHeaders, tokens)) continue;
        break;
      }
      if (this.#provider !== undefined && (response.status === 401 || response.status === 403)) {
        const challenge = parseBearerWwwAuthenticateHeader(response.headers.get("WWW-Authenticate"));
        const error = challenge?.params.error;
        if (error !== undefined && error.length > 0) {
          void response.body?.cancel().catch(() => undefined);
          throw new OAuthError({ error, error_description: challenge.params.error_description, error_uri: challenge.params.error_uri }, response.status);
        }
      }
      return response;
    } finally { this.#oauthControllers.delete(controller); }
  }
  async #unauthorized(response, signal, requestHeaders, presentedTokens) {
    if (response.status !== 401 || this.#provider === undefined || this.#discovery === undefined) return false;
    const challenge = parseBearerWwwAuthenticateHeader(response.headers.get("WWW-Authenticate"));
    try {
      const discovery = await this.#discovery.discover(this.#url, { resourceMetadataUrl: challenge?.params.resource_metadata, signal });
      const providerResponse = response.clone();
      let result;
      try {
        result = await this.#provider.handleUnauthorized({
          requestUrl: new URL(this.#url), response: providerResponse, challenge, discovery,
          signal, requestHeaders: new Headers(requestHeaders), presentedTokens,
          fetch: (url, init) => fetchMcpResponse(this.#fetch ?? globalThis.fetch, url, {
            ...init, signal: init?.signal == null ? signal : AbortSignal.any([signal, init.signal]),
          }),
        });
        signal.throwIfAborted();
      } finally { void providerResponse.body?.cancel().catch(() => undefined); }
      if (result.action === "retry") { void response.body?.cancel().catch(() => undefined); return true; }
      if (result.error !== undefined) throw result.error;
      return false;
    } catch (error) { void response.body?.cancel().catch(() => undefined); throw error; }
  }
  async #forward(response, signal, context, stopAfterInitialization = false) {
    switch (httpResponseKind(response.status, response.headers.get("Content-Type"))) {
      case "ignore": void response.body?.cancel().catch(() => undefined); return;
      case "sse": await this.#consumeSse(response, signal, context, false, stopAfterInitialization); return;
      case "json": {
        const payload = await readBoundedResponseText(response, this.#state.maxResponseBytes, this.#readers, signal);
        if (payload.length === 0) { if (context !== undefined) throw new Error("MCP HTTP response body is empty"); return; }
        this.#emit(context === undefined ? JSON.stringify(JSON.parse(payload)) : context.validate(payload, false));
        return;
      }
      default: void response.body?.cancel().catch(() => undefined); throw new Error("HTTP transport POST returned an unsupported response content type");
    }
  }
  async #consumeSse(response, signal, context, acceptEndpoint = false, stopAfterInitialization = false) {
    if (response.body === null) return;
    const parser = new NativeSseParser(this.#state.maxResponseBytes, acceptEndpoint);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const reader = response.body.getReader();
    this.#readers.add(reader);
    const abort = () => { void reader.cancel().catch(() => undefined); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      while (true) {
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        if (value === undefined) continue;
        this.#emitEvents(parser.push(decoder.decode(value, { stream: true })), context);
        if (context?.completed || (stopAfterInitialization && !this.#initializing)) { void reader.cancel().catch(() => undefined); return; }
        this.#state.setEventId(parser.lastEventId);
      }
      const trailing = decoder.decode();
      if (trailing.length > 0) { this.#emitEvents(parser.push(trailing), context); this.#state.setEventId(parser.lastEventId); }
      this.#emitEvents(parser.flush(), context);
      this.#state.setEventId(parser.lastEventId);
      if (context !== undefined && !context.completed) throw new Error("MCP HTTP stream ended before its final response");
    } catch (error) { void reader.cancel().catch(() => undefined); throw error; }
    finally { signal?.removeEventListener("abort", abort); this.#readers.delete(reader); reader.releaseLock(); }
  }
  #emitEvents(messages, context) {
    for (const message of messages) {
      if (message.event === "endpoint") {
        const endpoint = new URL(message.data, this.#url);
        const resource = new URL(this.#url);
        if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.origin !== resource.origin
          || endpoint.username || endpoint.password || endpoint.hash) throw new Error("Unsafe legacy SSE endpoint");
        if (this.#endpoint !== undefined && this.#endpoint !== endpoint.href)
          throw new Error("Legacy SSE endpoint changed during the active connection");
        this.#endpoint = endpoint.href;
        this.#resolveEndpoint?.(endpoint.href);
        this.#resolveEndpoint = undefined;
        this.#rejectEndpoint = undefined;
        continue;
      }
      this.#emit(context === undefined ? message.data : context.validate(message.data, true));
      if (context?.completed) return;
    }
  }
  #emit(line) {
    if (this.#initializing && this.#state.captureInitialization(line)) { this.#initializing = false; this.#maybeStartGet(); }
    if (!this.#state.disposed && !this.#read.destroyed && !this.#read.writableEnded) this.#read.write(`${line}\n`);
  }
}
