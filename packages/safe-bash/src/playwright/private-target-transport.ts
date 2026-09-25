export interface PlaywrightCDPTransport {
  open?(): void;
  send(message: object): void;
  close(): void;
  onmessage?: ((message: object) => void) | undefined;
  onclose?: ((reason?: string) => void) | undefined;
}

export interface PlaywrightPrivateTargetTransportLimits {
  maxMessageBytes?: number;
  maxGraphNodes?: number;
  maxGraphDepth?: number;
  /** Maximum commands sent upstream concurrently; omitted means unlimited. Excess commands wait for replies. */
  maxPendingCommands?: number;
  /** Maximum commands waiting for upstream capacity. */
  maxQueuedCommands?: number;
  /** Combined byte budget for in-flight and queued commands. */
  maxPendingBytes?: number;
  maxBufferedMessages?: number;
  maxBufferedBytes?: number;
  maxPrivateTargets?: number;
  maxPrivateSessions?: number;
  creationTimeoutMs?: number;
  commandTimeoutMs?: number;
}

export interface PlaywrightPrivateTargetCreation {
  commit(targetId: string): void;
  rollback(): void;
  fail(error: unknown): void;
}

interface Message {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

interface Command {
  clientId: number | undefined;
  clientKey: string | undefined;
  method: string;
  sessionId: string | undefined;
  targetId: string | undefined;
  internal: boolean;
  detachedSessionId: string | undefined;
  retirementConfirmed: boolean;
  replied: boolean;
  sent: boolean;
  bytes: number;
  started: number;
}

interface Creation {
  active: boolean;
  failed: boolean;
  timer: ReturnType<typeof setTimeout>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !value.includes('\0');
}

interface GraphStats {
  readonly bytes: number;
  readonly nodes: number;
  readonly depth: number;
}

const admittedGraphs = new WeakMap<object, GraphStats>();

function preflightProtocolJson(
  text: string,
  maxBytes: number,
  maxNodes = 100_000,
  maxDepth = 64,
  byteErrorMessage = 'CDP message byte limit exceeded',
): GraphStats {
  let bytes = 0;
  let nodes = 0;
  let depth = 0;
  let maxSeenDepth = 0;
  let inString = false;
  let escaped = false;
  let inToken = false;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < len) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > maxBytes) throw new Error(byteErrorMessage);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (code === 92) {
        escaped = true;
      } else if (code === 34) {
        inString = false;
      }
      continue;
    }
    if (code === 34) {
      inToken = false;
      inString = true;
      if (++nodes > maxNodes) throw new Error('CDP message graph node limit exceeded');
      continue;
    }
    if (code === 123 || code === 91) {
      inToken = false;
      if (++depth > maxDepth) throw new Error('CDP message graph depth limit exceeded');
      if (depth > maxSeenDepth) maxSeenDepth = depth;
      if (++nodes > maxNodes) throw new Error('CDP message graph node limit exceeded');
      continue;
    }
    if (code === 125 || code === 93) {
      inToken = false;
      if (depth > 0) depth--;
      continue;
    }
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 44 || code === 58) {
      inToken = false;
      continue;
    }
    if (!inToken) {
      inToken = true;
      if (++nodes > maxNodes) throw new Error('CDP message graph node limit exceeded');
    }
  }
  return { bytes, nodes, depth: maxSeenDepth };
}

function freezeProtocolGraph(root: unknown): void {
  if (typeof root !== 'object' || root === null) return;
  const stack: object[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (Object.isFrozen(current)) continue;
    Object.freeze(current);
    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) {
        const item: unknown = current[i];
        if (typeof item === 'object' && item !== null && !Object.isFrozen(item)) stack.push(item);
      }
    } else {
      for (const value of Object.values(current)) {
        if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) stack.push(value);
      }
    }
  }
}

export function admitPlaywrightProtocolFrame(
  data: unknown,
  options: { maxBytes?: number; maxGraphNodes?: number; maxGraphDepth?: number } = {},
): Record<string, unknown> {
  const maxBytes = options.maxBytes ?? Infinity;
  const maxGraphNodes = options.maxGraphNodes ?? 100_000;
  const maxGraphDepth = options.maxGraphDepth ?? 64;
  if (typeof data !== 'string') throw new Error('Private browser frame limit or type violation');
  const stats = preflightProtocolJson(
    data,
    maxBytes,
    maxGraphNodes,
    maxGraphDepth,
    'Private browser frame limit or type violation',
  );
  const value: unknown = JSON.parse(data);
  if (!record(value)) throw new Error('Invalid private browser protocol frame');
  freezeProtocolGraph(value);
  admittedGraphs.set(value, stats);
  return value;
}

export function createPlaywrightPrivateTargetTransport(upstream: PlaywrightCDPTransport, options: PlaywrightPrivateTargetTransportLimits = {}): {
  transport: PlaywrightCDPTransport;
  beginCreation(): PlaywrightPrivateTargetCreation;
} {
  const limits = {
    maxGraphNodes: 100_000,
    maxGraphDepth: 64,
    maxQueuedCommands: 16384,
    maxBufferedMessages: 512,
    maxPrivateTargets: 256,
    maxPrivateSessions: 1024,
    creationTimeoutMs: 2000,
    commandTimeoutMs: 10000,
    ...options,
    maxMessageBytes: options.maxMessageBytes ?? Infinity,
    maxPendingBytes: options.maxPendingBytes ?? Infinity,
    maxBufferedBytes: options.maxBufferedBytes ?? Infinity,
    maxPendingCommands: options.maxPendingCommands ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (['maxPendingCommands', 'maxMessageBytes', 'maxPendingBytes', 'maxBufferedBytes'].includes(name) && (options as Record<string, unknown>)[name] === undefined) continue;
    if (!Number.isSafeInteger(value) || value <= 0 || (name.endsWith('TimeoutMs') && value > 2147483647)) {
      throw new TypeError(`Invalid private transport limit: ${name}`);
    }
  }
  const encoder = new TextEncoder();
  const targets = new Set<string>();
  const sessions = new Map<string, string>();
  const retiredTargets = new Set<string>();
  const retiredSessions = new Set<string>();
  const pending = new Map<number, Command>();
  const queued = new Map<number, { message: Message; denied: boolean }>();
  const clientKeys = new Set<string>();
  const buffered: { message: Message; bytes: number }[] = [];
  let pendingBytes = 0;
  let inFlight = 0;
  let dispatching = false;
  let bufferedBytes = 0;
  let sequence = 0;
  let creation: Creation | undefined;
  let failure: Error | undefined;
  let flushing = false;
  let opened = false;
  let commandTimer: ReturnType<typeof setTimeout> | undefined;
  let timedCommandId: number | undefined;

  function scheduleCommandDeadline(): void {
    // Uniform deadlines and monotonic insertion order keep the oldest command
    // first, even when replies arrive out of order. Only that command needs a timer.
    const first = pending.entries().next().value;
    if (first?.[0] === timedCommandId) return;
    clearTimeout(commandTimer);
    commandTimer = undefined;
    timedCommandId = first?.[0];
    if (!first) return;
    const [id, command] = first;
    commandTimer = setTimeout(() => retire(new Error(
      `CDP ${command.method} timed out (command ${id}, pending ${pending.size}, deadline ${limits.commandTimeoutMs}ms, elapsed ${Math.round(performance.now() - command.started)}ms)`,
    )), Math.max(0, limits.commandTimeoutMs - (performance.now() - command.started)));
  }


  function retire(reason: unknown): void {
    if (failure) return;
    failure = reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Private target transport failed');
    if (creation) {
      clearTimeout(creation.timer);
      creation.active = false;
      creation.failed = true;
      creation = undefined;
    }
    clearTimeout(commandTimer);
    commandTimer = undefined;
    timedCommandId = undefined;
    pending.clear();
    queued.clear();
    inFlight = 0;
    clientKeys.clear();
    targets.clear();
    sessions.clear();
    retiredTargets.clear();
    retiredSessions.clear();
    buffered.length = 0;
    pendingBytes = 0;
    bufferedBytes = 0;
    upstream.onmessage = undefined;
    upstream.onclose = undefined;
    // Notify before upstream cleanup can synchronously stop the owning bridge.
    // The failure and cleared state already prevent reentrant protocol work.
    try { transport.onclose?.(failure.message.slice(0, 1024)); } catch {}
    try { upstream.close(); } catch {}
  }

  function validateMessageEnvelope(message: unknown): asserts message is Message {
    if (!record(message) || (message.id !== undefined && !Number.isSafeInteger(message.id)) ||
      (message.sessionId !== undefined && !identity(message.sessionId)) ||
      (message.method !== undefined && (typeof message.method !== 'string' || !message.method || message.method.length > 256)) ||
      (message.id === undefined && message.method === undefined)) throw new Error('Invalid CDP message');
    for (const key of ['params', 'result', 'error']) {
      if (message[key] !== undefined && !record(message[key])) throw new Error('Invalid CDP message payload');
    }
  }

  function snapshot(input: object): { message: Message; bytes: number } {
    const existing = admittedGraphs.get(input);
    if (existing) {
      if (existing.bytes > limits.maxMessageBytes) throw new Error('CDP message byte limit exceeded');
      if (existing.depth > limits.maxGraphDepth) throw new Error('CDP message graph depth limit exceeded');
      if (existing.nodes > limits.maxGraphNodes) throw new Error('CDP message graph node limit exceeded');
      validateMessageEnvelope(input);
      return { message: input as Message, bytes: existing.bytes };
    }
    const text = JSON.stringify(input);
    if (typeof text !== 'string' || text.length > limits.maxMessageBytes) throw new Error('CDP message byte limit exceeded');
    const stats = preflightProtocolJson(text, limits.maxMessageBytes, limits.maxGraphNodes, limits.maxGraphDepth);
    const message: unknown = JSON.parse(text);
    validateMessageEnvelope(message);
    freezeProtocolGraph(message);
    admittedGraphs.set(message, stats);
    return { message: message as Message, bytes: stats.bytes };
  }

  function deny(message: Message): void {
    transport.onmessage?.({ id: message.id, ...(message.sessionId ? { sessionId: message.sessionId } : {}),
      error: { code: -32000, message: 'Policy-owned target is unavailable to this client' } });
  }

  function privateTarget(value: unknown): boolean {
    return identity(value) && (targets.has(value) || retiredTargets.has(value));
  }

  function privateSession(value: unknown): boolean {
    return identity(value) && (sessions.has(value) || retiredSessions.has(value));
  }

  function rememberRetirement(identities: Set<string>, value: string, limit: number): void {
    identities.add(value);
    // Only confirmed inactive IDs age out. Active identities are never evicted.
    if (identities.size > limit) identities.delete(identities.values().next().value!);
  }

  function issue(input: Message, internal = false, denied = false): void {
    if (failure) throw failure;
    try {
      if (sequence >= Number.MAX_SAFE_INTEGER) throw new Error('CDP command identity exhausted');
      const id = ++sequence;
      const existing = admittedGraphs.get(input);
      let message: Message;
      let bytes: number;
      if (existing) {
        const prevIdLen = input.id === undefined ? 0 : String(input.id).length;
        bytes = existing.bytes - prevIdLen + String(id).length;
        if (bytes > limits.maxMessageBytes) throw new Error('CDP message byte limit exceeded');
        if (existing.depth > limits.maxGraphDepth) throw new Error('CDP message graph depth limit exceeded');
        if (existing.nodes > limits.maxGraphNodes) throw new Error('CDP message graph node limit exceeded');
        message = Object.freeze({ ...input, id });
        validateMessageEnvelope(message);
        admittedGraphs.set(message, { bytes, nodes: existing.nodes, depth: existing.depth });
      } else {
        const snap = snapshot({ ...input, id });
        message = snap.message;
        bytes = snap.bytes;
      }
      if (!message.method) throw new Error('Expected CDP command method');
      const clientKey = internal ? undefined : JSON.stringify([input.sessionId, input.id]);
      if (clientKey && clientKeys.has(clientKey)) throw new Error('Duplicate pending client CDP identity');
      if ((queued.size >= limits.maxQueuedCommands && (dispatching || inFlight >= limits.maxPendingCommands)) || bytes > limits.maxPendingBytes - pendingBytes) throw new Error('CDP pending command limit exceeded');
      const started = performance.now();
      pending.set(id, { clientId: input.id, clientKey, method: message.method, sessionId: message.sessionId,
        targetId: internal && identity(message.params?.sessionId) ? sessions.get(message.params.sessionId)
          : identity(message.params?.targetId) ? message.params.targetId : undefined,
        detachedSessionId: internal && identity(message.params?.sessionId) ? message.params.sessionId : undefined,
        retirementConfirmed: internal && identity(message.params?.sessionId) &&
          (retiredSessions.has(message.params.sessionId) || retiredTargets.has(sessions.get(message.params.sessionId)!)),
        internal, replied: false, sent: false, bytes, started });
      if (clientKey) clientKeys.add(clientKey);
      pendingBytes += bytes;
      scheduleCommandDeadline();
      queued.set(id, { message, denied });
      dispatch();
    } catch (error) { retire(error); throw error; }
  }

  function dispatch(): void {
    if (dispatching || failure) return;
    dispatching = true;
    try {
      while (!failure && inFlight < limits.maxPendingCommands && queued.size) {
        const [id, entry] = queued.entries().next().value!;
        queued.delete(id);
        const command = pending.get(id)!;
        command.sent = true;
        inFlight++;
        const { message } = entry;
        // Ownership may have changed while this command waited for capacity.
        if (entry.denied || (!command.internal &&
          (privateTarget(message.params?.targetId) || privateSession(message.sessionId)))) {
          queueMicrotask(() => receive({ id, ...(message.sessionId ? { sessionId: message.sessionId } : {}),
            error: { code: -32000, message: 'Policy-owned target is unavailable to this client' } }));
        } else upstream.send(message);
      }
    } finally { dispatching = false; }
  }

  function deliver(message: Message): void {
    if (failure) return;
    if (message.id !== undefined) {
      const command = pending.get(message.id);
      if (!command) return;
      pending.delete(message.id);
      inFlight--;
      pendingBytes -= command.bytes;
      scheduleCommandDeadline();
      if (command.clientKey) clientKeys.delete(command.clientKey);
      if (command.internal) {
        // Chromium can retire the private session before acknowledging our detach.
        // Accept only its exact rejection after a matching lifecycle event.
        if (message.error && !(command.retirementConfirmed && message.error.code === -32602 &&
          message.error.message === 'No session with given id' && Object.keys(message.error).length === 2 &&
          Object.keys(message).every(key => ['id', 'sessionId', 'error'].includes(key)))) {
          throw new Error('Native private target detach failed');
        }
        return;
      }
      if (command.clientId === undefined) throw new Error('Missing client CDP response identity');
      const reply = { ...message, id: command.clientId, ...(command.sessionId ? { sessionId: command.sessionId } : {}) };
      const targetInfo = record(message.result?.targetInfo) ? message.result.targetInfo : undefined;
      if (privateTarget(command.targetId) || privateSession(command.sessionId) ||
        privateTarget(targetInfo?.targetId) || privateTarget(message.result?.targetId)) {
        deny(reply);
      } else if (command.method === 'Target.getTargets' && message.result) {
        if (!Array.isArray(message.result.targetInfos) || message.result.targetInfos.some(info => !record(info) || !identity(info.targetId))) {
          throw new Error('Invalid native target list');
        }
        transport.onmessage?.({ ...reply, result: { ...message.result,
          targetInfos: message.result.targetInfos.filter(info => !privateTarget(info.targetId)) } });
      } else transport.onmessage?.(reply);
      return;
    }
    const info = record(message.params?.targetInfo) ? message.params.targetInfo : undefined;
    const targetId = info?.targetId ?? message.params?.targetId;
    const sessionId = message.params?.sessionId;
    if (message.method === 'Target.targetDestroyed' && identity(targetId) && targets.delete(targetId)) {
      for (const command of pending.values()) {
        if (command.internal && command.targetId === targetId) command.retirementConfirmed = true;
      }
      rememberRetirement(retiredTargets, targetId, limits.maxPrivateTargets);
      return;
    }
    if (message.method === 'Target.detachedFromTarget' && identity(sessionId) && sessions.delete(sessionId)) {
      for (const command of pending.values()) {
        if (command.internal && command.detachedSessionId === sessionId) command.retirementConfirmed = true;
      }
      rememberRetirement(retiredSessions, sessionId, limits.maxPrivateSessions);
      return;
    }
    if (message.method === 'Target.attachedToTarget' && (privateTarget(targetId) || privateSession(message.sessionId))) {
      if (!identity(targetId) || !identity(sessionId)) throw new Error('Invalid private native session identity');
      if (retiredSessions.has(sessionId)) return;
      if (sessions.has(sessionId)) {
        if (sessions.get(sessionId) !== targetId) throw new Error('Private native session identity changed');
        return;
      }
      if (sessions.size >= limits.maxPrivateSessions || (!privateTarget(targetId) && targets.size >= limits.maxPrivateTargets)) {
        throw new Error('Private target/session identity capacity exceeded');
      }
      if (!retiredTargets.has(targetId)) targets.add(targetId);
      sessions.set(sessionId, targetId);
      issue({ method: 'Target.detachFromTarget', params: { sessionId }, ...(message.sessionId ? { sessionId: message.sessionId } : {}) }, true);
      return;
    }
    if (privateTarget(targetId) || privateSession(sessionId) || privateSession(message.sessionId)) return;
    transport.onmessage?.(message);
  }

  function receive(input: object): void {
    if (failure) return;
    try {
      const entry = snapshot(input);
      const { message } = entry;
      const command = message.id === undefined ? undefined : pending.get(message.id);
      if (message.id !== undefined) {
        if (!command) {
          if (message.id > 0 && message.id <= sequence) return;
          throw new Error('Never-issued native CDP reply');
        }
        if (!command.sent) throw new Error('Never-issued native CDP reply');
        if (message.sessionId !== command.sessionId) {
          const sessionNotFound = command.sessionId !== undefined && message.sessionId === undefined &&
            Object.keys(message).length === 2 && message.error?.code === -32001 &&
            message.error.message === 'Session with given id not found.' && Object.keys(message.error).length === 2;
          if (!sessionNotFound) throw new Error('Native CDP response session mismatch');
        }
        if (command.replied) return;
        command.replied = true;
      }
      if (flushing || (creation && (message.id === undefined || (!command?.internal && command?.method.startsWith('Target.'))))) {
        if (buffered.length >= limits.maxBufferedMessages || entry.bytes > limits.maxBufferedBytes - bufferedBytes) throw new Error('CDP creation buffer limit exceeded');
        buffered.push(entry);
        bufferedBytes += entry.bytes;
      } else deliver(message);
      dispatch();
    } catch (error) { retire(error); }
  }

  function finish(entry: Creation, committing: boolean, targetId?: string): void {
    if (!entry.active || creation !== entry || failure) throw new Error('Target creation guard is no longer active');
    if (committing) {
      if (!identity(targetId) || privateTarget(targetId)) {
        const error = new Error('Invalid or reused private target identity');
        retire(error);
        throw error;
      }
      targets.add(targetId);
    }
    clearTimeout(entry.timer);
    entry.active = false;
    creation = undefined;
    flushing = true;
    try {
      while (buffered.length && !creation && !failure) {
        const next = buffered.shift()!;
        bufferedBytes -= next.bytes;
        deliver(next.message);
      }
    } catch (error) { retire(error); }
    finally { flushing = false; }
    try { dispatch(); } catch (error) { retire(error); }
    if (failure) throw failure;
  }

  const transport: PlaywrightCDPTransport = {
    open() {
      if (failure) throw failure;
      if (opened) return;
      opened = true;
      try { upstream.open?.(); } catch (error) { retire(error); throw error; }
    },
    send(input) {
      if (failure) throw failure;
      try {
        const { message } = snapshot(input);
        if (message.id === undefined || !message.method) throw new Error('Expected CDP command identity and method');
        issue(message, false, privateTarget(message.params?.targetId) || privateSession(message.sessionId));
      } catch (error) { retire(error); throw error; }
    },
    close() { retire(new Error('Private target transport closed')); },
  };
  upstream.onmessage = receive;
  upstream.onclose = reason => retire(reason ?? 'Upstream CDP transport closed');
  return {
    transport,
    beginCreation() {
      if (failure) throw failure;
      if (creation) throw new Error('Target creation already in progress');
      if (targets.size >= limits.maxPrivateTargets) throw new Error('Private target identity capacity exceeded');
      const entry: Creation = { active: true, failed: false,
        timer: setTimeout(() => retire(new Error('Native target creation identity timed out')), limits.creationTimeoutMs) };
      creation = entry;
      return {
        commit(targetId) { finish(entry, true, targetId); },
        rollback() { finish(entry, false); },
        fail(error) {
          if (entry.failed || failure) return;
          if (!entry.active || creation !== entry) throw new Error('Target creation guard is no longer active');
          retire(error);
        },
      };
    },
  };
}
