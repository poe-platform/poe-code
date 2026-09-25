import { ProgramError } from "./shared.js";

/** Logical invocation-owned text, independent of per-buffer limits and RSS. */
export class AwkRetention {
  private retained = 0;
  private readonly unlimited: boolean;
  private readonly capSmi: number;
  constructor(readonly capacity: number, private readonly signal?: AbortSignal) {
    if ((capacity !== Infinity && !Number.isSafeInteger(capacity)) || capacity < 0) throw new ProgramError("retained text capacity must be a nonnegative safe integer");
    this.unlimited = capacity === Infinity;
    this.capSmi = !this.unlimited && capacity <= 0x3fffffff ? (capacity | 0) : 0x3fffffff;
  }
  get retainedBytes(): number { return this.retained; }

  admit(previousBytes: number, nextBytes: number): void {
    if (this.signal?.aborted) this.signal.throwIfAborted();
    if ((previousBytes | 0) === previousBytes && previousBytes >= 0 && previousBytes <= this.retained && (nextBytes | 0) === nextBytes && nextBytes >= 0) {
      const nextRetained = (this.retained + nextBytes - previousBytes) | 0;
      if (this.unlimited || nextRetained <= this.capSmi) {
        this.retained = nextRetained;
        return;
      }
    }
    if (!Number.isSafeInteger(previousBytes) || previousBytes < 0 || previousBytes > this.retained
      || !Number.isSafeInteger(nextBytes) || nextBytes < 0) throw new ProgramError("invalid retained text accounting");
    if (nextBytes > this.capacity - this.retained + previousBytes) throw new ProgramError("awk retained text limit exceeded");
    this.retained += nextBytes - previousBytes;
  }

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
