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
  const hasDeterministicRandom = options.random !== undefined || options.seed !== undefined;
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

      const start = performance.now();
      let timeout = setTimeout(resolveSleep, ms);

      function cleanup(): void {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", rejectSleep);
      }

      function resolveSleep(): void {
        const remainingMs = ms - (performance.now() - start);
        if (remainingMs > 0) {
          timeout = setTimeout(resolveSleep, remainingMs);
          return;
        }

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
    uuid: hasDeterministicRandom ? () => createRandomUuid(random) : () => crypto.randomUUID()
  };
}

function createRandomUuid(random: () => number): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(readRandomUnit(random()) * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

function readRandomUnit(value: number): number {
  if (Number.isFinite(value) && value >= 0 && value < 1) {
    return value;
  }

  throw new RangeError("time.uuid() random source must return a number in [0, 1).");
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
