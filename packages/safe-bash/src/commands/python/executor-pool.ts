import type { PythonAsyncExecutor, PythonExecutorStart } from './index.js';
import { PythonFailure } from './diagnostics.js';

export interface PythonExecutorPoolOptions {
  readonly createExecutor: () => PythonAsyncExecutor;
  readonly maxConcurrentExecutors: number;
}

export interface PythonExecutorPool {
  createExecutor(): PythonAsyncExecutor;
  inspect(): { readonly active: number; readonly capacity: number; readonly closed: boolean };
  dispose(): Promise<void>;
}

export function createPythonExecutorPool(options: PythonExecutorPoolOptions): PythonExecutorPool {
  if (typeof options?.createExecutor !== 'function') throw new TypeError('Python executor pool requires a factory');
  const factory = options.createExecutor;
  const capacity = options.maxConcurrentExecutors;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Invalid Python executor pool capacity');
  const entries = new Set<{ retire(): Promise<void> }>();
  let closed = false;
  let disposal: Promise<void> | undefined;
  return {
    createExecutor() {
      if (closed) throw new PythonFailure('executor-unavailable');
      if (entries.size >= capacity) throw new PythonFailure('capacity');
      let acquired!: (executor: PythonAsyncExecutor | undefined) => void;
      const acquisition = new Promise<PythonAsyncExecutor | undefined>(resolve => { acquired = resolve; });
      let retirement: Promise<void> | undefined;
      let execution: Promise<void> | undefined;
      let started = false;
      const entry = {
        retire() {
          retirement ??= Promise.resolve().then(async () => {
            const executor = await acquisition;
            if (executor !== undefined) {
              const results = await Promise.allSettled([Promise.resolve().then(() => {
                const terminate = executor?.terminate;
                if (typeof terminate !== 'function') throw new PythonFailure('cleanup');
                return terminate.call(executor);
              }), execution]);
              const failed = results.find(result => result.status === 'rejected');
              if (failed?.status === 'rejected') throw failed.reason;
            }
            entries.delete(entry);
          });
          return retirement;
        },
      };
      entries.add(entry);
      let executor: PythonAsyncExecutor;
      try { executor = factory(); }
      catch (error) { acquired(undefined); entries.delete(entry); throw error; }
      acquired(executor);
      try {
        if (closed || !executor || typeof executor.run !== 'function' || typeof executor.terminate !== 'function') throw new PythonFailure('executor-unavailable');
      } catch (error) {
        void entry.retire().catch(() => {});
        throw error;
      }
      return {
        async run(start: PythonExecutorStart) {
          if (started || closed || retirement) throw new PythonFailure('executor-unavailable');
          started = true;
          const running = Promise.resolve().then(() => {
            if (closed || retirement) throw new PythonFailure('executor-unavailable');
            return executor.run(start);
          });
          execution = running.then(() => {}, () => {});
          return running;
        },
        terminate: entry.retire,
      };
    },
    inspect() { return { active: entries.size, capacity, closed }; },
    dispose() {
      closed = true;
      disposal ??= Promise.allSettled([...entries].map(entry => entry.retire())).then(results => {
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      });
      return disposal;
    },
  };
}
