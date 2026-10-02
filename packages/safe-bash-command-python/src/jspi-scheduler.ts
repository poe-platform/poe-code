export type PythonJspiCallback = (() => unknown) & {destroy?(): void};

export function createPythonJspiScheduler(): {
  scheduleCallback(callback: PythonJspiCallback, delay?: number): void;
  close(): Promise<void>;
} {
  const queued = new Map<ReturnType<typeof setTimeout>, PythonJspiCallback>();
  const active = new Set<Promise<void>>();
  const failures: unknown[] = [];
  let closed = false;
  let retirement: Promise<void> | undefined;
  return {
    scheduleCallback(callback, delay = 0) {
      if (closed) {
        callback.destroy?.();
        throw new Error('Python scheduler is closed');
      }
      const timer = setTimeout(() => {
        queued.delete(timer);
        const work = Promise.resolve().then(() => callback()).then(() => {}, error => { failures.push(error); })
          .finally(() => { active.delete(work); });
        active.add(work);
      }, delay);
      queued.set(timer, callback);
    },
    close() {
      if (retirement) return retirement;
      if (!active.size) closed = true;
      retirement = Promise.resolve().then(async () => {
        while (active.size) await Promise.all(active);
        closed = true;
        for (const [timer, callback] of queued) {
          clearTimeout(timer);
          try { callback.destroy?.(); }
          catch (error) { failures.push(error); }
        }
        queued.clear();
        if (failures.length === 1) throw failures[0];
        if (failures.length) throw new AggregateError(failures, 'Python callback retirement failed');
      });
      return retirement;
    },
  };
}
