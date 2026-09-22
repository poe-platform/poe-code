export {
  PdfSyntaxError,
  defaultPdfLimits,
  parsePdfObjects,
  resolvePdfReference
} from "./syntax.js";
export type { PdfLimits, PdfObject, PdfParseOptions } from "./syntax.js";
export { openPdf } from "./revisions.js";
export type {
  PdfDocument,
  PdfDocumentOptions,
  PdfIndirectObject,
  PdfXrefEntry
} from "./revisions.js";
export { decodePdfStream } from "./filters.js";
export type { PdfFilterOptions, PdfDecodedStream } from "./filters.js";
export type {
  PdfBox,
  PdfPage,
  PdfPageOptions,
  PdfPageTree,
  PdfInventoryItem,
  PdfOutline,
  PdfLink,
  PdfAttachment,
  PdfForm
} from "./pages.js";
export { createPdfSecurity, PdfSecurityError } from "./security.js";
export { createPdfCrypto } from "./crypto.js";
export type {
  PdfCrypto,
  PdfPassword,
  PdfDecryptOptions,
  PdfSecurityOptions,
  PdfSecuritySession
} from "./security.js";

export { interpretPdfText, tokenizePdfContent, parseToUnicode } from "./text.js";
export type { PdfTextOptions, PdfTextResult, PdfTextDiagnostic, PdfGlyph, PdfMatrix, PdfUnicodeMap, PdfUnicodeSource, PdfContentOperator } from "./text.js";
export { extractPdfLayout } from "./layout.js";
export type { PdfLayoutOptions, PdfLayoutResult, PdfTextRun } from "./layout.js";
export type { PdfPageLayoutOptions, PdfDocumentLayout } from "./revisions.js";
export { pdfCapabilities, getPdfCommandGate } from "./capabilities.js";
export type { PdfCapability, PdfFeature, PdfDependentCommand, PdfCommandGate } from "./capabilities.js";
