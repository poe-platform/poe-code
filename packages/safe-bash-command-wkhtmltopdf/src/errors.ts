export type ErrorCode = "UNKNOWN_OPTION" | "OPTION_LOCATION" | "MISSING_OPERAND" |
  "INVALID_VALUE" | "MARGIN_UNITS" | "MISSING_OBJECT" | "UNSUPPORTED_CAPABILITY" |
  "UNQUALIFIED_QUIRK" | "LIMIT_EXCEEDED";

export class WkhtmltopdfError extends Error {
  readonly exitCode = 1;
  constructor(readonly code: ErrorCode, message: string, readonly option?: string) {
    super(message);
    this.name = "WkhtmltopdfError";
  }
}
