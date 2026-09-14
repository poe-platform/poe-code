import { DocumentPackage } from "./package.js";
import { asciiKey } from "./part-uri.js";
import { InvalidPackageError, parseDocumentXml, UnsupportedProfileError } from "./package-xml.js";
import { validatePackageDialect, type DocumentDialect } from "./dialect.js";
export { InvalidPackageError, InvalidXmlError, UnsupportedProfileError } from "./package-xml.js";
import {
  CancellationError,
  archiveSettings,
  readArchive,
  ResourceLimitError,
  type ArchiveContext,
  type DocumentArchive
} from "./archive.js";

export interface AdmittedDocumentArchive extends DocumentArchive {
  readonly kind: "docx" | "dotx";
  readonly dialect: DocumentDialect;
  readonly mainPart: string;
  readonly package: DocumentPackage;
}

const documentTypes = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"
};
const macroTypes = new Set([
  "application/vnd.ms-word.document.macroenabled.main+xml",
  "application/vnd.ms-word.template.macroenabledtemplate.main+xml",
  "application/vnd.ms-office.vbaproject",
  "application/vnd.ms-word.vbadata+xml"
]);
const officeRelationships = new Set([
  "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
]);

export async function readDocumentArchive(
  input: Uint8Array,
  context: ArchiveContext
): Promise<AdmittedDocumentArchive> {
  const { limits, signal } = archiveSettings(context);
  if (signal.aborted) throw new CancellationError("Document admission cancelled.");
  if (
    input instanceof Uint8Array &&
    input.length >= 8 &&
    [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => input[index] === value)
  ) {
    if (input.length > limits.maxArchiveBytes)
      throw new ResourceLimitError("Archive byte budget exceeded.");
    throw new UnsupportedProfileError(
      "Compound binary Word or encrypted Office containers are unsupported."
    );
  }
  const archive = await readArchive(input, { limits, signal });
  const total = archive.members.reduce((sum, member) => sum + member.bytes.length, 0);
  // Reserve strings, parser state and lookup metadata in addition to owned payloads.
  if (
    input.length * 4 + total * 16 + archive.members.length * 1024 + 65536 >
    limits.maxRetainedBytes
  )
    throw new ResourceLimitError("Document admission retained byte budget exceeded.");
  const graph = new DocumentPackage(archive, limits);
  for (const declaration of [...graph.defaults, ...graph.overrides]) {
    if (macroTypes.has(declaration.content_type.toLowerCase()))
      throw new UnsupportedProfileError("Macro-enabled document containers are unsupported.");
  }
  const mainRelationships = graph
    .relationships("/")
    .filter((edge) => officeRelationships.has(edge.reltype));
  if (mainRelationships.length !== 1)
    throw new InvalidPackageError("The package must contain exactly one main document relationship.");
  if (mainRelationships[0]!.is_external || mainRelationships[0]!.fragment !== null)
    throw new InvalidPackageError("The main document relationship must be internal and have no fragment.");
  const main = mainRelationships[0]!.target_part;
  const type = asciiKey(main.content_type);
  const kind =
    type === documentTypes.docx ? "docx" : type === documentTypes.dotx ? "dotx" : undefined;
  if (!kind)
    throw new UnsupportedProfileError("The package is not a supported Word document or template.");
  const dialect = validatePackageDialect(graph, mainRelationships[0]!, parseDocumentXml(main.bytes).root);
  if (signal.aborted) throw new CancellationError("Document admission cancelled.");
  return { ...archive, kind, dialect, mainPart: main.name, package: graph };
}
