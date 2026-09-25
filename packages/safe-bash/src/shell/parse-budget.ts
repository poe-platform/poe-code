import { ShellLimitError } from "./types.js";

export const defaultMaxParseUnits = Infinity;

export class ParseBudget {
  private remainingSmi: number;
  private remainingNum: number;
  private readonly unlimited: boolean;
  private failure: ShellLimitError | undefined;

  constructor(maximum?: number, private readonly signal?: AbortSignal, private readonly onLimit?: (error: ShellLimitError) => void) {
    if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("maxParseUnits must be a nonnegative safe integer");
    const rem = maximum ?? defaultMaxParseUnits;
    this.unlimited = rem === Infinity;
    this.remainingNum = this.unlimited ? 0 : rem;
    this.remainingSmi = !this.unlimited && rem <= 0x3fffffff ? (rem | 0) : 0x3fffffff;
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
    if (this.unlimited) return;
    if (units <= this.remainingSmi && (units | 0) === units) {
      this.remainingSmi = (this.remainingSmi - (units | 0)) | 0;
      this.remainingNum -= units;
      return;
    }
    if (units > this.remainingNum) {
      const error = this.failure = new ShellLimitError("maxParseUnits");
      this.onLimit?.(error);
      throw error;
    }
    this.remainingNum -= units;
    this.remainingSmi = this.remainingNum <= 0x3fffffff ? (this.remainingNum | 0) : 0x3fffffff;
  }
}
