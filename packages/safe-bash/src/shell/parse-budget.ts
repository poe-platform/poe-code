import { ShellLimitError } from "./types.js";

export const defaultMaxParseUnits = Infinity;

export class ParseBudget {
  declare private remainingSmi: number;
  declare private remainingNum: number;
  declare private totalAdmitted: number;
  declare private readonly unlimited: boolean;
  declare private failure: ShellLimitError | undefined;
  declare private readonly signal: AbortSignal | undefined;
  declare private readonly onLimit: ((error: ShellLimitError) => void) | { abort(error: ShellLimitError): void } | undefined;

  constructor(
    maximum?: number,
    signal?: AbortSignal,
    onLimit?: ((error: ShellLimitError) => void) | { abort(error: ShellLimitError): void },
  ) {
    if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("maxParseUnits must be a nonnegative safe integer");
    const rem = maximum ?? defaultMaxParseUnits;
    this.totalAdmitted = 0;
    this.unlimited = rem === Infinity;
    this.remainingNum = this.unlimited ? 0 : rem;
    this.remainingSmi = !this.unlimited && rem <= 0x3fffffff ? (rem | 0) : 0x3fffffff;
    this.failure = undefined;
    this.signal = signal;
    this.onLimit = onLimit;
  }

  get admittedUnits(): number {
    return this.totalAdmitted;
  }

  snapshot(): number {
    return this.remainingNum;
  }

  restore(saved: number): void {
    if (!this.unlimited && !this.failure) {
      this.remainingNum = saved;
      this.remainingSmi = saved <= 0x3fffffff ? (saved | 0) : 0x3fffffff;
    }
  }

  admit(units = 1): void {
    this.signal?.throwIfAborted();
    if (this.failure) throw this.failure;
    if ((units | 0) !== units || units < 0) {
      if (!Number.isSafeInteger(units) || units < 0) throw new RangeError("Parse admission must be a nonnegative safe integer");
    }
    this.totalAdmitted += units;
    if (this.unlimited) return;
    if (units <= this.remainingSmi && (units | 0) === units) {
      this.remainingSmi = (this.remainingSmi - (units | 0)) | 0;
      this.remainingNum -= units;
      return;
    }
    if (units > this.remainingNum) {
      const error = this.failure = new ShellLimitError("maxParseUnits");
      if (typeof this.onLimit === "function") this.onLimit(error);
      else this.onLimit?.abort(error);
      throw error;
    }
    this.remainingNum -= units;
    this.remainingSmi = this.remainingNum <= 0x3fffffff ? (this.remainingNum | 0) : 0x3fffffff;
  }
}
