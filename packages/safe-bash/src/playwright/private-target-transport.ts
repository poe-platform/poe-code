export interface PlaywrightCDPTransport {
  open?(): void;
  send(message: object): void;
  close(): void;
  onmessage?: ((message: object) => void) | undefined;
  onclose?: ((reason?: string) => void) | undefined;
}

export interface PlaywrightPrivateTargetTransportLimits {
  maxMessageBytes?: number;
  maxPendingCommands?: number;
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
  clientId?: number;
  clientKey?: string;
  method: string;
  sessionId?: string;
  targetId?: string;
  internal: boolean;
  replied: boolean;
  bytes: number;
  timer: ReturnType<typeof setTimeout>;
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

export function createPlaywrightPrivateTargetTransport(upstream: PlaywrightCDPTransport, options: PlaywrightPrivateTargetTransportLimits = {}): {
  transport: PlaywrightCDPTransport;
  beginCreation(): PlaywrightPrivateTargetCreation;
} {
  const limits = {
    maxMessageBytes: 16 * 1024 * 1024,
    maxPendingCommands: 1024,
    maxPendingBytes: 4 * 1024 * 1024,
    maxBufferedMessages: 512,
    maxBufferedBytes: 16 * 1024 * 1024,
    maxPrivateTargets: 256,
    maxPrivateSessions: 1024,
    creationTimeoutMs: 2000,
    commandTimeoutMs: 10000,
    ...options,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0 || (name.endsWith('TimeoutMs') && value > 2147483647)) {
      throw new TypeError(`Invalid private transport limit: ${name}`);
    }
  }
  const encoder = new TextEncoder();
  const targets = new Set<string>();
  const sessions = new Map<string, string>();
  const pending = new Map<number, Command>();
  const clientKeys = new Set<string>();
  const buffered: { message: Message; bytes: number }[] = [];
  let pendingBytes = 0;
  let bufferedBytes = 0;
  let sequence = 0;
  let creation: Creation | undefined;
  let failure: Error | undefined;
  let flushing = false;
  let opened = false;

  function retire(reason: unknown): void {
    if (failure) return;
    failure = reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Private target transport failed');
    if (creation) {
      clearTimeout(creation.timer);
      creation.active = false;
      creation.failed = true;
      creation = undefined;
    }
    for (const command of pending.values()) clearTimeout(command.timer);
    pending.clear();
    clientKeys.clear();
    targets.clear();
    sessions.clear();
    buffered.length = 0;
    pendingBytes = 0;
    bufferedBytes = 0;
    upstream.onmessage = undefined;
    upstream.onclose = undefined;
    try { upstream.close(); } catch {}
    try { transport.onclose?.(failure.message.slice(0, 1024)); } catch {}
  }

  function snapshot(input: object): { message: Message; bytes: number } {
    const text = JSON.stringify(input);
    if (typeof text !== 'string' || text.length > limits.maxMessageBytes) throw new Error('CDP message byte limit exceeded');
    const bytes = encoder.encode(text).byteLength;
    if (bytes > limits.maxMessageBytes) throw new Error('CDP message byte limit exceeded');
    const message: unknown = JSON.parse(text);
    if (!record(message) || (message.id !== undefined && !Number.isSafeInteger(message.id)) ||
      (message.sessionId !== undefined && !identity(message.sessionId)) ||
      (message.method !== undefined && (typeof message.method !== 'string' || !message.method || message.method.length > 256)) ||
      (message.id === undefined && message.method === undefined)) throw new Error('Invalid CDP message');
    for (const key of ['params', 'result', 'error']) {
      if (message[key] !== undefined && !record(message[key])) throw new Error('Invalid CDP message payload');
    }
    return { message: message as Message, bytes };
  }

  function deny(message: Message): void {
    transport.onmessage?.({ id: message.id, ...(message.sessionId ? { sessionId: message.sessionId } : {}),
      error: { code: -32000, message: 'Policy-owned target is unavailable to this client' } });
  }

  function issue(input: Message, internal = false, denied = false): void {
    if (failure) throw failure;
    try {
      if (sequence >= Number.MAX_SAFE_INTEGER) throw new Error('CDP command identity exhausted');
      const id = ++sequence;
      const { message, bytes } = snapshot({ ...input, id });
      if (!message.method) throw new Error('Expected CDP command method');
      const clientKey = internal ? undefined : JSON.stringify([input.sessionId, input.id]);
      if (clientKey && clientKeys.has(clientKey)) throw new Error('Duplicate pending client CDP identity');
      if (pending.size >= limits.maxPendingCommands || bytes > limits.maxPendingBytes - pendingBytes) throw new Error('CDP pending command limit exceeded');
      const timer = setTimeout(() => retire(new Error(`CDP ${message.method} timed out`)), limits.commandTimeoutMs);
      pending.set(id, { clientId: input.id, clientKey, method: message.method, sessionId: message.sessionId,
        targetId: identity(message.params?.targetId) ? message.params.targetId : undefined,
        internal, replied: false, bytes, timer });
      if (clientKey) clientKeys.add(clientKey);
      pendingBytes += bytes;
      if (denied) queueMicrotask(() => receive({ id, ...(message.sessionId ? { sessionId: message.sessionId } : {}),
        error: { code: -32000, message: 'Policy-owned target is unavailable to this client' } }));
      else upstream.send(message);
    } catch (error) { retire(error); throw error; }
  }

  function deliver(message: Message): void {
    if (failure) return;
    if (message.id !== undefined) {
      const command = pending.get(message.id);
      if (!command) return;
      pending.delete(message.id);
      pendingBytes -= command.bytes;
      clearTimeout(command.timer);
      if (command.clientKey) clientKeys.delete(command.clientKey);
      if (command.internal) {
        if (message.error) throw new Error('Native private target detach failed');
        return;
      }
      const reply = { ...message, id: command.clientId };
      const targetInfo = record(message.result?.targetInfo) ? message.result.targetInfo : undefined;
      if (targets.has(command.targetId ?? '') || sessions.has(command.sessionId ?? '') ||
        targets.has(String(targetInfo?.targetId ?? '')) || targets.has(String(message.result?.targetId ?? ''))) {
        deny(reply);
      } else if (command.method === 'Target.getTargets' && message.result) {
        if (!Array.isArray(message.result.targetInfos) || message.result.targetInfos.some(info => !record(info) || !identity(info.targetId))) {
          throw new Error('Invalid native target list');
        }
        transport.onmessage?.({ ...reply, result: { ...message.result,
          targetInfos: message.result.targetInfos.filter(info => !targets.has(info.targetId)) } });
      } else transport.onmessage?.(reply);
      return;
    }
    const info = record(message.params?.targetInfo) ? message.params.targetInfo : undefined;
    const targetId = info?.targetId ?? message.params?.targetId;
    const sessionId = message.params?.sessionId;
    if (message.method === 'Target.attachedToTarget' && (targets.has(String(targetId ?? '')) || sessions.has(message.sessionId ?? ''))) {
      if (!identity(targetId) || !identity(sessionId)) throw new Error('Invalid private native session identity');
      if (sessions.has(sessionId)) {
        if (sessions.get(sessionId) !== targetId) throw new Error('Private native session identity changed');
        return;
      }
      if (sessions.size >= limits.maxPrivateSessions || (!targets.has(targetId) && targets.size >= limits.maxPrivateTargets)) {
        throw new Error('Private target/session identity capacity exceeded');
      }
      targets.add(targetId);
      sessions.set(sessionId, targetId);
      issue({ method: 'Target.detachFromTarget', params: { sessionId }, ...(message.sessionId ? { sessionId: message.sessionId } : {}) }, true);
      return;
    }
    if (targets.has(String(targetId ?? '')) || sessions.has(String(sessionId ?? '')) || sessions.has(message.sessionId ?? '')) return;
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
        if (message.sessionId !== command.sessionId) throw new Error('Native CDP response session mismatch');
        if (command.replied) return;
        command.replied = true;
      }
      if (flushing || (creation && (message.id === undefined || (!command?.internal && command?.method.startsWith('Target.'))))) {
        if (buffered.length >= limits.maxBufferedMessages || entry.bytes > limits.maxBufferedBytes - bufferedBytes) throw new Error('CDP creation buffer limit exceeded');
        buffered.push(entry);
        bufferedBytes += entry.bytes;
      } else deliver(message);
    } catch (error) { retire(error); }
  }

  function finish(entry: Creation, targetId?: string): void {
    if (!entry.active || creation !== entry || failure) throw new Error('Target creation guard is no longer active');
    if (targetId !== undefined) {
      if (!identity(targetId) || targets.has(targetId)) {
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
        issue(message, false, targets.has(String(message.params?.targetId ?? '')) || sessions.has(message.sessionId ?? ''));
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
        commit(targetId) { finish(entry, targetId); },
        rollback() { finish(entry); },
        fail(error) {
          if (entry.failed || failure) return;
          if (!entry.active || creation !== entry) throw new Error('Target creation guard is no longer active');
          retire(error);
        },
      };
    },
  };
}
