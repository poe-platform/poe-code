import { createSeededRandom } from "../interp/globals/math.js";

export type TimeModuleOptions = {
  now?: () => number;
  random?: () => number;
  seed?: number;
  signal?: AbortSignal;
};

export function makeTimeModule(options: TimeModuleOptions = {}): {
  random: () => number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  uuid: () => string;
} {
  const random =
    options.random ??
    (options.seed === undefined ? () => Math.random() : createSeededRandom(options.seed).next);
  const now = options.now ?? (() => Date.now());
  const signal = options.signal;

  async function sleep(ms: number): Promise<void> {
    assertSleepDelay(ms);

    return await new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(createSleepAbortError());
        return;
      }

      const timeout = setTimeout(resolveSleep, ms);

      function cleanup(): void {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", rejectSleep);
      }

      function resolveSleep(): void {
        cleanup();
        resolve();
      }

      function rejectSleep(): void {
        cleanup();
        reject(createSleepAbortError());
      }

      signal?.addEventListener("abort", rejectSleep, { once: true });
    });
  }

  return {
    random,
    now,
    sleep,
    uuid: () => crypto.randomUUID()
  };
}

function assertSleepDelay(ms: number): void {
  if (Number.isFinite(ms) && ms >= 0) {
    return;
  }

  throw new RangeError("time.sleep(ms) requires a non-negative finite millisecond delay.");
}

function createSleepAbortError(): Error {
  return new Error("time.sleep aborted.");
}
