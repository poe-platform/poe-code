import { WkhtmltopdfError } from "./errors.js";

export interface ParseLimits {
  readonly maxArguments: number;
  readonly maxTextBytes: number;
  readonly maxObjects: number;
  readonly maxWork: number;
}
export interface ParseOptions {
  readonly limits: ParseLimits;
  readonly signal?: AbortSignal;
  /** Deliberate safe CLI deviation from the unqualified ASCII-zero sentinel. */
  readonly endOfOptions?: boolean;
  /** Parse a stdin batch job using original leading argv, without recursive batch mode. */
  readonly batchJob?: boolean;
}

// Admission counts input UTF-8 bytes without allocating an encoded copy.
// maxWork covers scans, option dispatch and cloned retained settings/entries.
export class ParseBudget {
  private work = 0;
  private bytes = 0;
  private objects = 0;
  private readonly limits: ParseLimits;
  constructor(private readonly options: ParseOptions) {
    this.checkCancellation();
    this.limits = {
      maxArguments: options.limits?.maxArguments,
      maxTextBytes: options.limits?.maxTextBytes,
      maxObjects: options.limits?.maxObjects,
      maxWork: options.limits?.maxWork,
    };
    for (const value of Object.values(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new WkhtmltopdfError("INVALID_VALUE", "Parser limits must be positive safe integers");
      }
    }
  }
  checkCancellation(): void {
    if (this.options.signal?.aborted) throw this.options.signal.reason;
  }
  step(amount = 1): void {
    this.checkCancellation();
    if (amount > this.limits.maxWork - this.work) {
      throw new WkhtmltopdfError("LIMIT_EXCEEDED", "Parser work limit exceeded");
    }
    this.work += amount;
  }
  admitArguments(count: number): void {
    this.step();
    if (count > this.limits.maxArguments) {
      throw new WkhtmltopdfError("LIMIT_EXCEEDED", "Parser argument limit exceeded");
    }
  }
  admitText(text: string): void {
    for (let i = 0; i < text.length; i++) {
      this.step();
      const code = text.charCodeAt(i);
      let size = code < 128 ? 1 : code < 2048 ? 2 : 3;
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { size = 4; i++; this.step(); }
      }
      if (size > this.limits.maxTextBytes - this.bytes) {
        throw new WkhtmltopdfError("LIMIT_EXCEEDED", "Parser text byte limit exceeded");
      }
      this.bytes += size;
      if (code === 0) throw new WkhtmltopdfError("INVALID_VALUE", "NUL is not admitted in CLI text");
    }
  }
  admitObject(replacementCount: number): void {
    this.step(64 + replacementCount * 2);
    if (++this.objects > this.limits.maxObjects) {
      throw new WkhtmltopdfError("LIMIT_EXCEEDED", "Parser object limit exceeded");
    }
  }
}
