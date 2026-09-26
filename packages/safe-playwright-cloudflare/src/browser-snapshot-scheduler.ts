import type { Page } from '@cloudflare/playwright';

interface NativeProgress { readonly signal: AbortSignal }
type SnapshotAction = (continuePolling: symbol) => Promise<unknown>;
interface NativeFrame {
  isDetached(): boolean;
  retryWithProgressAndTimeouts(progress: NativeProgress, timeouts: number[], action: SnapshotAction): Promise<unknown>;
}
interface NativePage {
  snapshotForAI(progress: NativeProgress, ...args: unknown[]): Promise<unknown>;
  frames(): NativeFrame[];
  on(event: 'frameattached' | 'framedetached', listener: (frame: NativeFrame) => void): void;
  on(event: 'close', listener: () => void): void;
  off(event: 'frameattached' | 'framedetached', listener: (frame: NativeFrame) => void): void;
  off(event: 'close', listener: () => void): void;
}
interface QueuedSnapshot {
  readonly frame: NativeFrame;
  start(): void;
  cancel(reason: unknown): void;
}

/** Serialize native frame capture before cold utility scripts become CDP payloads.
 * The pinned provider recurses only after this callback returns, so descendants
 * do not retain a parent slot. Native traversal, retries and refs stay intact. */
export function createBrowserSnapshotScheduler() {
  const scopes = new WeakMap<NativeProgress, { depth: number }>();
  const frames = new WeakSet<NativeFrame>();
  const pages = new Map<NativePage, () => void>();
  const queued = new Set<QueuedSnapshot>();
  let active: Promise<void> | undefined;
  let stopped: { reason: unknown } | undefined;

  function dispatch(): void {
    if (active || stopped) return;
    queued.values().next().value?.start();
  }

  function schedule(progress: NativeProgress, frame: NativeFrame, action: () => Promise<unknown>): Promise<unknown> {
    if (stopped) return Promise.reject(stopped.reason);
    if (progress.signal.aborted) return Promise.reject(progress.signal.reason);
    if (frame.isDetached()) return Promise.reject(new Error('Frame was detached'));
    const result = Promise.withResolvers<unknown>();
    const aborted = () => task.cancel(progress.signal.reason);
    const remove = () => {
      queued.delete(task);
      progress.signal.removeEventListener('abort', aborted);
    };
    const task: QueuedSnapshot = {
      frame,
      start() {
        remove();
        active = Promise.resolve().then(() => {
          if (stopped) throw stopped.reason;
          progress.signal.throwIfAborted();
          if (frame.isDetached()) throw new Error('Frame was detached');
          return action();
        }).then(result.resolve, result.reject).finally(() => {
          active = undefined;
          dispatch();
        });
      },
      cancel(reason) {
        remove();
        result.reject(reason);
      },
    };
    queued.add(task);
    progress.signal.addEventListener('abort', aborted, { once: true });
    dispatch();
    return result.promise;
  }

  function snapshotAction(progress: NativeProgress, frame: NativeFrame, action: SnapshotAction): SnapshotAction {
    return function (this: unknown, continuePolling) {
      return schedule(progress, frame, () => action.call(this, continuePolling));
    };
  }

  function prepareFrame(frame: NativeFrame): void {
    if (frames.has(frame)) return;
    frames.add(frame);
    const retry = frame.retryWithProgressAndTimeouts;
    frame.retryWithProgressAndTimeouts = function (progress, timeouts, action) {
      if (!scopes.has(progress)) return retry.call(this, progress, timeouts, action);
      return retry.call(this, progress, timeouts, snapshotAction(progress, this, action));
    };
  }

  return {
    prepare(page: Page): void {
      if (stopped) return;
      // type-erasure-boundary -- @cloudflare/playwright@1.3.6 owns these native
      // progress/retry objects locally. No browser realm or context is replaced.
      const bridge = page as unknown as { _connection: { toImpl(page: Page): NativePage } };
      const native = bridge._connection.toImpl(page);
      if (pages.has(native)) return;
      const snapshot = native.snapshotForAI;
      native.snapshotForAI = async function (progress, ...args) {
        if (stopped) throw stopped.reason;
        progress.signal.throwIfAborted();
        const scope = scopes.get(progress) ?? { depth: 0 };
        scope.depth++;
        scopes.set(progress, scope);
        try {
          const result = await snapshot.call(this, progress, ...args);
          progress.signal.throwIfAborted();
          return result;
        } finally {
          if (--scope.depth === 0) scopes.delete(progress);
        }
      };
      const forget = () => {
        native.off('frameattached', prepareFrame);
        native.off('framedetached', detached);
        native.off('close', forget);
        pages.delete(native);
      };
      const detached = (frame: NativeFrame) => {
        for (const task of queued) {
          if (task.frame === frame) task.cancel(new Error('Frame was detached'));
        }
      };
      pages.set(native, forget);
      native.on('frameattached', prepareFrame);
      native.on('framedetached', detached);
      native.on('close', forget);
      for (const frame of native.frames()) prepareFrame(frame);
    },
    stop(reason: unknown): void {
      if (stopped) return;
      stopped = { reason };
      for (const task of queued) task.cancel(reason);
      for (const forget of pages.values()) forget();
    },
    async settled(): Promise<void> {
      // Owners stop admission before closing the transport, then join admitted
      // callbacks. A callback's error still belongs to its native snapshot call.
      while (active) await active;
    },
  };
}
