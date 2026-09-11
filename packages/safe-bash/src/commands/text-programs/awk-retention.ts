import { ProgramError } from "./shared.js";

/** Logical invocation-owned text, independent of per-buffer limits and RSS. */
export class AwkRetention {
  private retained = 0;
  constructor(readonly capacity: number, private readonly signal?: AbortSignal) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw new ProgramError("retained text capacity must be a nonnegative safe integer");
  }
  get retainedBytes(): number { return this.retained; }

  replace<T>(previousBytes: number, nextBytes: number, create: () => T): T {
    this.signal?.throwIfAborted();
    if (!Number.isSafeInteger(previousBytes) || previousBytes < 0 || previousBytes > this.retained
      || !Number.isSafeInteger(nextBytes) || nextBytes < 0) throw new ProgramError("invalid retained text accounting");
    if (nextBytes > this.capacity - this.retained + previousBytes) throw new ProgramError("awk retained text limit exceeded");
    const value = create();
    this.retained += nextBytes - previousBytes;
    return value;
  }

  release(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.retained) throw new ProgramError("invalid retained text release");
    this.retained -= bytes;
  }
}
