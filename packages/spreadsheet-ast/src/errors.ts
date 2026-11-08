const ssconvertErrorBrand = Symbol.for("poe-code.ssconvert.SsconvertError");

export function isSsconvertError(value: unknown): value is SsconvertError {
  return value instanceof Error && Object.getOwnPropertyDescriptor(value, ssconvertErrorBrand)?.value === true;
}

export class SsconvertError extends Error {
  constructor(
    readonly code:
      | "unsupported-feature"
      | "capability-denied"
      | "resource-limit"
      | "invalid-request"
      | "io",
    message: string,
    readonly exitCode = 1
  ) {
    super(message);
    this.name = "SsconvertError";
    Object.defineProperty(this, ssconvertErrorBrand, { value: true });
  }
}
