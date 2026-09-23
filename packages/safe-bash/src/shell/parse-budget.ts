import { ShellLimitError } from "./types.js";

export const defaultMaxParseUnits = Infinity;

export class ParseBudget {
  #remaining: number;
  #failure: ShellLimitError | undefined;

  constructor(maximum?: number, private readonly signal?: AbortSignal, private readonly onLimit?: (error: ShellLimitError) => void) {
    if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("maxParseUnits must be a nonnegative safe integer");
    this.#remaining = maximum ?? defaultMaxParseUnits;
  }

  admit(units = 1): void {
    this.signal?.throwIfAborted();
    if (this.#failure) throw this.#failure;
    if (!Number.isSafeInteger(units) || units < 0) throw new RangeError("Parse admission must be a nonnegative safe integer");
    if (units > this.#remaining) {
      const error = this.#failure = new ShellLimitError("maxParseUnits");
      this.onLimit?.(error);
      throw error;
    }
    this.#remaining -= units;
  }
}
