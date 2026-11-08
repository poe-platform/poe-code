import { PdfError } from "../errors.js";

export function assertDecodedByteBudget(byteLength: number, maxBytes = Infinity): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > maxBytes) {
    throw new PdfError("E_LIMIT", "PDF data exceeds maximum decoded byte budget");
  }
}
