export class PdfError extends Error {
  constructor(readonly code: "E_LIMIT" | "E_CAPABILITY" | "E_CANCELLED", message: string) { super(message); this.name = "PdfError"; }
}
