import { PdfSyntaxError } from "./syntax.js";

export interface PdfCapability {
  readonly status: "local" | "unsupported" | "qualified";
  readonly evidence: string;
  readonly limitations: string;
}

/** Candidate evidence only. Upstream observations do not qualify this engine. */
export const pdfCapabilities = Object.freeze({
  strictSyntax: Object.freeze<PdfCapability>({ status: "local", evidence: "src/index.test.ts; src/qualification.test.ts", limitations: "Original bounded syntax fixtures; mature producer corpus missing." }),
  recovery: Object.freeze<PdfCapability>({ status: "local", evidence: "src/revisions.test.ts", limitations: "Explicit object-scan recovery only; no reconstructed revision graph." }),
  objectInspection: Object.freeze<PdfCapability>({ status: "local", evidence: "src/revisions.test.ts", limitations: "Raw objects/streams; complete document inspection corpus missing." }),
  crossReferences: Object.freeze<PdfCapability>({ status: "local", evidence: "src/revisions.test.ts", limitations: "Classic/unfiltered stream/hybrid controls; mature corpus missing." }),
  revisions: Object.freeze<PdfCapability>({ status: "local", evidence: "src/revisions.test.ts", limitations: "Newest-first original fixtures; multi-producer histories unqualified." }),
  filteredIndexes: Object.freeze<PdfCapability>({ status: "unsupported", evidence: "src/revisions.test.ts", limitations: "Filtered xref/object streams are not integrated." }),
  filters: Object.freeze<PdfCapability>({ status: "local", evidence: "src/filters.test.ts", limitations: "Strict Flate/LZW/ASCIIHex/ASCII85/RunLength and predictors; image/extension codecs unsupported." }),
  securityPrimitives: Object.freeze<PdfCapability>({ status: "local", evidence: "src/security.test.ts; src/crypto.test.ts; src/node-crypto.test.ts", limitations: "Explicit crypto capability and prepared password bytes; no complete encrypted-file qualification." }),
  encryptedDocuments: Object.freeze<PdfCapability>({ status: "unsupported", evidence: "src/revisions.test.ts; src/pages.test.ts", limitations: "Automatic object/string/member decryption and encrypted interpretation unsupported." }),
  pages: Object.freeze<PdfCapability>({ status: "local", evidence: "src/pages.test.ts; src/qualification.test.ts", limitations: "Original page/inventory graphs; mature metadata encoding corpus missing." }),
  fonts: Object.freeze<PdfCapability>({ status: "local", evidence: "src/text.test.ts", limitations: "Partial simple/CID/TrueType mapping; Type1/CFF/Type3 completeness unqualified." }),
  text: Object.freeze<PdfCapability>({ status: "local", evidence: "src/text.test.ts", limitations: "Provenance-preserving original controls; inline images and complete content semantics unqualified." }),
  layout: Object.freeze<PdfCapability>({ status: "local", evidence: "src/layout.test.ts", limitations: "Deterministic projections; bidi/shaping/columns and native reading-order parity unqualified." }),
  losslessRewriting: Object.freeze<PdfCapability>({ status: "unsupported", evidence: "README.md", limitations: "No writer or graph-aware lossless round-trip qualification." }),
  consumerArtifacts: Object.freeze<PdfCapability>({ status: "unsupported", evidence: "../../docs/plans/pdf-parser-qualification.md", limitations: "Parser-consuming installed Safe Bash declarations and actual Node/browser/workerd artifacts unqualified." })
});

export type PdfFeature = keyof typeof pdfCapabilities;
export type PdfDependentCommand = "pdfinfo" | "pdftotext" | "qpdf";
export interface PdfCommandGate {
  readonly command: PdfDependentCommand;
  readonly qualified: boolean;
  readonly missing: readonly PdfFeature[];
}

const inspection: readonly PdfFeature[] = Object.freeze([
  "strictSyntax", "recovery", "objectInspection", "crossReferences", "revisions",
  "filteredIndexes", "filters", "securityPrimitives", "encryptedDocuments", "pages", "consumerArtifacts"
]);
const requirements: Readonly<Record<PdfDependentCommand, readonly PdfFeature[]>> = Object.freeze({
  pdfinfo: inspection,
  pdftotext: Object.freeze([...inspection, "fonts", "text", "layout"] as PdfFeature[]),
  qpdf: Object.freeze([...inspection, "losslessRewriting"] as PdfFeature[])
});

/** Full command profiles, not permission to treat an initial increment as mature. */
export function getPdfCommandGate(command: PdfDependentCommand, options: { signal?: AbortSignal } = {}): PdfCommandGate {
  options.signal?.throwIfAborted();
  if (typeof command !== "string" || !Object.hasOwn(requirements, command))
    throw new PdfSyntaxError("ARGUMENT", "unknown dependent PDF command", 0);
  const missing = Object.freeze(requirements[command].filter(feature => pdfCapabilities[feature].status !== "qualified"));
  return Object.freeze({ command, qualified: missing.length === 0, missing });
}
