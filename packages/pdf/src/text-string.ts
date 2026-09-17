import {PDFHexString} from "pdf-lib";
import {PdfError} from "./errors.js";
/** UTF-16BE hex strings avoid literal-string delimiter and escape ambiguity. */
export function pdfTextString(text: string, outputLimit: number, charge: (amount: number) => void): PDFHexString {
  charge(text.length);
  if (text.length > Math.floor((outputLimit - 6) / 4)) throw new PdfError("E_LIMIT", "PDF string exceeds output budget");
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const low = text.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new PdfError("E_CAPABILITY", "Invalid Unicode PDF string");
    } else if (cp >= 0xdc00 && cp <= 0xdfff) throw new PdfError("E_CAPABILITY", "Invalid Unicode PDF string");
  }
  return PDFHexString.fromText(text);
}
