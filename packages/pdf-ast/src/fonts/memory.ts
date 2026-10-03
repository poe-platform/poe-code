import { PdfError } from "../errors.js";

export interface PdfFontAllocationOptions {
  /** Conservative decoder scratch and retained mapping state; input is caller-owned. */
  readonly maxWorkingBytes?: number;
  /** Admit the same allocations to a containing font/document owner before allocation. */
  readonly onAllocation?: (bytes: number) => void;
}

export class PdfFontAllocation {
  private used = 0;
  private readonly maximum: number;
  private failure: { reason: unknown } | undefined;
  constructor(private readonly options: PdfFontAllocationOptions) {
    this.maximum = options.maxWorkingBytes ?? Infinity;
    if (this.maximum !== Infinity && (!Number.isSafeInteger(this.maximum) || this.maximum < 0)) throw new RangeError("Invalid font working byte limit");
  }
  admit(bytes: number): void {
    try {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > Math.min(this.maximum, Number.MAX_SAFE_INTEGER) - this.used)
        throw new PdfError("E_LIMIT", "PDF font working byte limit exceeded");
      this.options.onAllocation?.(bytes);
      this.used += bytes;
    } catch (reason) { this.failure = { reason }; throw reason; }
  }
  /** Optional malformed-map recovery must never swallow an owner rejection. */
  rethrowAllocationFailure(reason: unknown): void {
    if (this.failure && this.failure.reason === reason) throw reason;
  }
}
