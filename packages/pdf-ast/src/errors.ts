export type PdfErrorCode =
  | "E_PARSE"
  | "E_PASSWORD"
  | "E_LIMIT"
  | "E_CAPABILITY"
  | "E_CANCELLED";

export class PdfError extends Error {
  constructor(
    readonly code: PdfErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PdfError";
  }
}
