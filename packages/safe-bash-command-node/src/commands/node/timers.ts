import { commandLimits } from "../safejs/options.js";
import { SafeJsCommandLimitError, type SafeJsModule } from "../safejs/types.js";
import type { NodeSafeJsCommandOptions } from "./types.js";

// Capture arguments in the guest so objects retain their identity instead of
// being copied through the host bridge along with the exported callback.
export const timerSource = `
function setTimeout(callback, delay, ...args) {
  if (typeof callback !== "function") throw new TypeError("setTimeout callback must be a function");
  let milliseconds = Number(delay);
  if (!Number.isFinite(milliseconds) || milliseconds < 1 || milliseconds > 2147483647) milliseconds = 1;
  return __safeBashTimers.schedule(() => callback(...args), Math.trunc(milliseconds));
}
function clearTimeout(timer) { __safeBashTimers.clear(timer); }
`;

export function timerBindings<Budget>(options: NodeSafeJsCommandOptions<Budget>, signal: AbortSignal, fail: (error: unknown) => void, pending: Set<Promise<void>>): SafeJsModule {
  const declare = options.runtime.declareHostOperation;
  const limits = commandLimits(options.limits);
  const timers = new Map<number, { handle: ReturnType<typeof setTimeout>; complete: () => void }>();
  let nextId = 0;
  const clear = (id: unknown): void => {
    if (typeof id !== "number") return;
    const timer = timers.get(id);
    if (!timer) return;
    clearTimeout(timer.handle);
    timers.delete(id);
    timer.complete();
  };
  signal.addEventListener("abort", () => {
    for (const id of timers.keys()) clear(id);
  }, { once: true });
  return {
    schedule: declare((callback: unknown, delay: unknown) => {
      signal.throwIfAborted();
      if (typeof callback !== "function" || typeof delay !== "number" || !Number.isInteger(delay) || delay < 1 || delay > 2_147_483_647) throw new TypeError("Invalid timer");
      if (pending.size >= limits.arrayLength) {
        const error = new SafeJsCommandLimitError("arrayLength");
        fail(error);
        throw error;
      }
      const id = ++nextId;
      let complete!: () => void;
      const completion = new Promise<void>(resolve => {
        complete = () => { pending.delete(completion); resolve(); };
      });
      pending.add(completion);
      const handle = setTimeout(() => {
        timers.delete(id);
        if (signal.aborted) { complete(); return; }
        // Exported SafeJS callbacks enqueue interpreter work and return a
        // promise. Observe errors immediately and join the work before exit.
        void Promise.resolve().then(() => callback()).catch(fail).finally(complete);
      }, delay);
      timers.set(id, { handle, complete });
      return id;
    }, "read-side-effect"),
    clear: declare(clear, "read-side-effect"),
    drain: declare(async () => {
      while (pending.size > 0) {
        signal.throwIfAborted();
        await Promise.all(pending);
      }
      signal.throwIfAborted();
    }, "read-side-effect"),
  };
}
