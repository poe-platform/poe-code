/** Operation counts are cooperative checkpoints, not elapsed CPU time. */
export interface ExecutionMeter {
  checkpoint(steps?: number, allocatedBytes?: number): void;
}

export interface ExecutionLimits {
  readonly maxSteps: number;
  /** Cumulative charged allocation, including temporary buffers; not live heap size. */
  readonly maxAllocatedBytes: number;
  readonly signal?: AbortSignal;
}

/** Host termination signal, deliberately separate from catchable guest errors. */
export class ExecutionLimitError extends Error {
  constructor(readonly reason: "steps" | "allocation" | "cancelled") {
    super(reason === "cancelled" ? "execution cancelled" : reason === "steps" ? "execution step limit exceeded" : "execution allocation limit exceeded");
    this.name = "ExecutionLimitError";
  }
}

function validateAmount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("execution budget amounts must be nonnegative safe integers");
}

/** Monotonic per-execution budget. A failed charge is atomic and permanently fatal.
 * Cancellation is observed at checkpoints; synchronous work does not yield the
 * host event loop. Only instrumented operations are covered by this meter.
 */
export class ExecutionBudget implements ExecutionMeter {
  readonly #maxSteps: number;
  readonly #maxAllocatedBytes: number;
  readonly #signal: AbortSignal | undefined;
  #steps = 0;
  #allocatedBytes = 0;
  #failure: ExecutionLimitError | undefined;

  constructor(limits: ExecutionLimits) {
    validateAmount(limits.maxSteps);
    validateAmount(limits.maxAllocatedBytes);
    this.#maxSteps = limits.maxSteps;
    this.#maxAllocatedBytes = limits.maxAllocatedBytes;
    this.#signal = limits.signal;
    Object.freeze(this);
  }

  get usage(): Readonly<{ steps: number; allocatedBytes: number }> {
    return Object.freeze({ steps: this.#steps, allocatedBytes: this.#allocatedBytes });
  }

  checkpoint(steps = 1, allocatedBytes = 0): void {
    if (this.#failure) throw this.#failure;
    validateAmount(steps);
    validateAmount(allocatedBytes);
    const reason = this.#signal?.aborted ? "cancelled"
      : steps > this.#maxSteps - this.#steps ? "steps"
      : allocatedBytes > this.#maxAllocatedBytes - this.#allocatedBytes ? "allocation" : undefined;
    if (reason) {
      this.#failure = new ExecutionLimitError(reason);
      throw this.#failure;
    }
    this.#steps += steps;
    this.#allocatedBytes += allocatedBytes;
  }
}
