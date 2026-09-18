/** Public, exclusively owned JSON CDP WebSocket; accept/open it before installation. */
export interface PlaywrightPolicySocket {
  send(message: string): void;
  close(): void;
  addEventListener(event: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(event: 'close' | 'error', listener: () => void): void;
  removeEventListener(event: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(event: 'close' | 'error', listener: () => void): void;
}

export interface PlaywrightPolicyRequest {
  readonly targetId: string;
  readonly frameId: string;
  /** CDP Network request ID when available; otherwise the Fetch request ID. */
  readonly requestId: string;
  readonly resourceType: string;
  readonly url: string;
  readonly method: string;
  readonly headers: readonly { name: string; value: string }[];
  readonly body?: Uint8Array;
  readonly signal: AbortSignal;
}
export interface PlaywrightPolicyResponse {
  readonly status: number;
  /** Preserve separate Set-Cookie entries. Supply headers for the decoded body. */
  readonly headers: readonly { name: string; value: string }[];
  readonly body: Uint8Array;
  /** Release host response resources after delivery acknowledgement or failure.
   * Called once and awaited, including for invalid or late canceled responses. */
  readonly release?: () => void | Promise<void>;
}
export interface PlaywrightPolicyFailure {
  readonly targetId: string;
  readonly frameId: string;
  readonly requestId: string;
  readonly resourceType: string;
  readonly message: string;
}
export interface PlaywrightNetworkPolicyOptions {
  readonly socket: PlaywrightPolicySocket;
  /** Required host guarantee: direct HTTP(S) and WebSocket egress is denied
   * independently of CDP, including after transport disconnection.
   * 'blocked-by-host' additionally declares all-protocol denial (e.g. WebRTC).
   * Neither declaration configures or verifies the external host boundary. */
  readonly directNetwork: 'http-blocked-by-host' | 'blocked-by-host';
  /** Admit every URL and use manual redirects with bounded, cancellable reads. */
  readonly fetch: (request: PlaywrightPolicyRequest) => Promise<PlaywrightPolicyResponse>;
  /** Destroy the exclusively owned remote browser, including on transport loss. */
  readonly retire: () => Promise<void>;
  readonly onRequestFailure?: (failure: PlaywrightPolicyFailure) => void;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxRequestBytes?: number;
  /** Incoming UTF-8 CDP JSON cap, default 8 MiB; at most 32 MiB. */
  readonly maxProtocolMessageBytes?: number;
  readonly maxConcurrentRequests?: number;
  readonly maxTargets?: number;
}

type Message = { id?: number; method?: string; params?: any; result?: any; error?: { message?: string }; sessionId?: string };
type Target = { targetId: string; type: string };
type Operation = { controller: AbortController; networkId: string; sessionId: string; nativeCanceled: boolean };

function boundedHeaders(entries: readonly { name: string; value: string }[]): { name: string; value: string }[] {
  if (!Array.isArray(entries) || entries.length > 1024) throw new Error('Host header limit exceeded');
  const encoder = new TextEncoder();
  let bytes = 0;
  return entries.map(({ name, value }) => {
    if (typeof name !== 'string' || typeof value !== 'string' || name.length + value.length > 65536) throw new Error('Invalid or oversized host header');
    bytes += encoder.encode(name).length + encoder.encode(value).length;
    if (bytes > 65536) throw new Error('Host header limit exceeded');
    return { name, value };
  });
}

/** Installs before exposing any page. No page/context routing may be installed.
 * Disposal retires the browser before detaching; reconnect is not supported. */
export async function installPlaywrightNetworkPolicy(options: PlaywrightNetworkPolicyOptions): Promise<{ dispose(): Promise<void> }> {
  if (!['http-blocked-by-host', 'blocked-by-host'].includes(options.directNetwork) || typeof options.fetch !== 'function' || typeof options.retire !== 'function') {
    throw new TypeError('A host fetch policy, browser retirement, and independent direct-network denial are required');
  }
  const positive = (value: number | undefined, fallback: number) => {
    const selected = value ?? fallback;
    if (!Number.isSafeInteger(selected) || selected < 1) throw new TypeError('Invalid network policy limit');
    return selected;
  };
  const timeout = positive(options.requestTimeoutMs, 30000);
  const maxResponse = positive(options.maxResponseBytes, 8 * 1024 * 1024);
  const maxRequest = positive(options.maxRequestBytes, 1024 * 1024);
  const maxMessage = options.maxProtocolMessageBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(maxMessage) || maxMessage < 1 || maxMessage > 32 * 1024 * 1024) {
    throw new TypeError('Invalid protocol message limit (maximum 32 MiB)');
  }
  const maxConcurrent = positive(options.maxConcurrentRequests, 64);
  const maxTargets = positive(options.maxTargets, 64);
  const { socket } = options;
  const pending = new Map<number, { resolve(value: any): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }>();
  const targets = new Map<string, Target>();
  const operations = new Set<Operation>();
  const work = new Set<Promise<void>>();
  let nextId = 0;
  let closed = false;
  let disconnected = false;
  let disposal: Promise<void> | undefined;
  let releaseFailure: { reason: unknown } | undefined;
  const failure = new Error('Browser network policy closed');
  const rejectPending = () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(failure); }
    pending.clear();
  };
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    closed = true;
    for (const operation of operations) operation.controller.abort(failure);
    rejectPending();
    disposal = Promise.resolve().then(async () => {
      // Never release interception on a live browser, including when retirement
      // fails. The independent host boundary remains responsible on socket loss.
      try { await options.retire(); }
      finally { await Promise.allSettled([...work]); }
      socket.removeEventListener('message', receive);
      socket.removeEventListener('close', lost);
      socket.removeEventListener('error', lost);
      socket.close();
      targets.clear();
      if (releaseFailure) throw releaseFailure.reason;
    });
    return disposal;
  };
  const lost = () => { disconnected = true; void dispose().catch(() => {}); };
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> => {
    if (closed || disconnected) return Promise.reject(failure);
    if (pending.size >= maxConcurrent + maxTargets + 1) { void dispose().catch(() => {}); return Promise.reject(new Error('CDP command capacity exceeded')); }
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
        void dispose().catch(() => {});
      }, Math.min(timeout, 10000));
      pending.set(id, { resolve, reject, timer });
      try { socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); lost(); }
    });
  };
  const track = (promise: Promise<void>) => {
    work.add(promise);
    void promise.catch(() => { void dispose().catch(() => {}); }).finally(() => work.delete(promise));
  };
  const autoAttach = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'tab', exclude: true }, {}] };
  const attach = async (params: any) => {
    const { sessionId, targetInfo } = params;
    if (targets.has(sessionId)) return;
    if (targets.size >= maxTargets) { void dispose().catch(() => {}); throw new Error('Browser target capacity exceeded'); }
    targets.set(sessionId, targetInfo);
    if (targetInfo.type !== 'page' && targetInfo.type !== 'iframe') {
      // Chromium cannot close every worker through Target.closeTarget. Keep
      // unsupported targets paused, bounded by maxTargets, until their owner
      // terminates them or the session retires. Never resume their execution.
      if (!params.waitingForDebugger) throw new Error('Unsupported target was already running');
      return;
    }
    if (!params.waitingForDebugger && targetInfo.url && targetInfo.url !== 'about:blank') {
      throw new Error('Network policy must be installed before browser targets navigate');
    }
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId);
    await send('Network.enable', {}, sessionId);
    await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await send('Network.setBypassServiceWorker', { bypass: true }, sessionId);
    // Blocking all URLs here prevents Chromium from issuing subresource Fetch
    // events. The independent host boundary denies any direct HTTP fallback.
    await send('Network.setBlockedURLs', { urls: ['ws://*', 'wss://*'] }, sessionId);
    await send('Target.setAutoAttach', autoAttach, sessionId);
    await send('Runtime.runIfWaitingForDebugger', {}, sessionId);
  };
  const request = async (params: any, sessionId: string) => {
    if (operations.size >= maxConcurrent) { void dispose().catch(() => {}); throw new Error('Concurrent host request limit exceeded'); }
    const target = targets.get(sessionId);
    if (!target) throw new Error('Request from an unowned browser target');
    const controller = new AbortController();
    const operation = { controller, networkId: params.networkId ?? params.requestId, sessionId, nativeCanceled: false };
    const identity = { targetId: target.targetId, frameId: params.frameId ?? '', requestId: operation.networkId, resourceType: params.resourceType ?? '' };
    const timer = setTimeout(() => controller.abort(new Error('Host request deadline exceeded')), timeout);
    operations.add(operation);
    let release: (() => void | Promise<void>) | undefined;
    try {
      const native = params.request;
      const url = new URL(native.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported browser network protocol');
      let body: Uint8Array | undefined;
      if (native.hasPostData || native.postData !== undefined || native.postDataEntries !== undefined) {
        if (!Array.isArray(native.postDataEntries) || native.postDataEntries.some((entry: any) => typeof entry.bytes !== 'string')) {
          throw new Error('Browser did not supply complete binary request body');
        }
        let size = 0;
        const pieces: string[] = [];
        for (const entry of native.postDataEntries) {
          if (entry.bytes.length > Math.ceil(maxRequest / 3) * 4) throw new Error('Host request body limit exceeded');
          const decoded = atob(entry.bytes);
          size += decoded.length;
          if (size > maxRequest) throw new Error('Host request body limit exceeded');
          pieces.push(decoded);
        }
        body = new Uint8Array(size);
        let offset = 0;
        for (const piece of pieces) for (let index = 0; index < piece.length; index++) body[offset++] = piece.charCodeAt(index);
      }
      const response = await options.fetch({ ...identity, url: native.url, method: native.method,
        headers: boundedHeaders(Object.entries(native.headers as Record<string, string>).map(([name, value]) => ({ name, value }))),
        ...(body ? { body } : {}), signal: controller.signal });
      const releaseResponse = response.release;
      if (releaseResponse !== undefined) {
        if (typeof releaseResponse !== 'function') throw new Error('Invalid host response release');
        release = () => releaseResponse.call(response);
      }
      controller.signal.throwIfAborted();
      if (closed) throw failure;
      if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599
        || !(response.body instanceof Uint8Array) || response.body.byteLength > maxResponse) throw new Error('Invalid or oversized host response');
      let binary = '';
      for (let offset = 0; offset < response.body.length; offset += 8192) binary += String.fromCharCode(...response.body.subarray(offset, offset + 8192));
      await send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: response.status, responseHeaders: boundedHeaders(response.headers), body: btoa(binary) }, sessionId);
    } catch (error) {
      controller.abort(error);
      const message = (error instanceof Error ? error.message : 'Host network request failed').slice(0, 1024);
      try { options.onRequestFailure?.({ ...identity, message }); } catch { /* Diagnostics cannot release a paused request. */ }
      if (!closed && targets.has(sessionId)) {
        // Canceled requests may already be gone. A protocol failure retires the
        // owned browser instead of falling back to native network continuation.
        try { await send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }, sessionId); }
        catch (protocolError) { if (!operation.nativeCanceled) throw protocolError; }
      }
    } finally {
      try { await release?.(); }
      catch (reason) { releaseFailure ??= { reason }; void dispose().catch(() => {}); }
      finally { clearTimeout(timer); operations.delete(operation); }
    }
  };
  function receive(event: { data: unknown }) {
    if (closed) return;
    try {
      if (typeof event.data !== 'string' || event.data.length > maxMessage) throw new Error('Expected bounded JSON CDP transport');
      // Count UTF-8 without allocating another copy of an oversized message.
      let messageBytes = event.data.length;
      for (let index = 0; index < event.data.length; index++) {
        const code = event.data.charCodeAt(index);
        if (code < 0x80) continue;
        if (code < 0x800) messageBytes++;
        else {
          messageBytes += 2;
          if (code >= 0xd800 && code <= 0xdbff) {
            const next = event.data.charCodeAt(index + 1);
            if (next >= 0xdc00 && next <= 0xdfff) index++;
          }
        }
        if (messageBytes > maxMessage) throw new Error('Expected bounded JSON CDP transport');
      }
      const message = JSON.parse(event.data) as Message;
      if (message.id !== undefined) {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(message.error.message ?? 'CDP command failed'));
        else entry.resolve(message.result);
      } else if (message.method === 'Target.attachedToTarget') track(attach(message.params));
      else if (message.method === 'Fetch.requestPaused') track(request(message.params, message.sessionId!));
      else if (message.method === 'Network.loadingFailed') {
        for (const operation of operations) if (operation.sessionId === message.sessionId && operation.networkId === message.params.requestId) {
          operation.nativeCanceled = true;
          operation.controller.abort(new Error('Browser request canceled'));
        }
      } else if (message.method === 'Target.detachedFromTarget') {
        targets.delete(message.params.sessionId);
        for (const operation of operations) if (operation.sessionId === message.params.sessionId) {
          operation.nativeCanceled = true;
          operation.controller.abort(new Error('Browser target closed'));
        }
      }
    } catch { lost(); }
  }
  socket.addEventListener('message', receive);
  socket.addEventListener('close', lost);
  socket.addEventListener('error', lost);
  try {
    await send('Target.setAutoAttach', autoAttach);
    await Promise.all([...work]);
    if (closed) throw failure;
    return { dispose };
  } catch (error) { await dispose(); throw error; }
}
