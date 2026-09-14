import { InvalidValueError, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { readDocumentArchive, type AdmittedDocumentArchive } from "./admission.js";
import { writeArchive } from "./archive-write.js";
import { documentDialects, type DocumentDialect } from "./dialect.js";

export interface DocumentCreateOptions {
  readonly kind?: "docx" | "dotx";
  readonly dialect?: DocumentDialect;
}

export async function createDocumentArchive(options: DocumentCreateOptions, context: ArchiveContext): Promise<AdmittedDocumentArchive> {
  if (!options || typeof options !== "object" || Array.isArray(options) ||
    Object.keys(options).some(key => key !== "kind" && key !== "dialect"))
    throw new InvalidValueError("Expected document creation options.");
  const { kind = "docx", dialect = "transitional" } = options;
  if ((kind !== "docx" && kind !== "dotx") || (dialect !== "strict" && dialect !== "transitional"))
    throw new InvalidValueError("Expected kind docx or dotx and dialect strict or transitional.");
  const { w, r } = documentDialects[dialect];
  const mainType = `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml`;
  const relationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
  const parts = [
    ["[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="${mainType}"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`],
    ["_rels/.rels", `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`],
    ["word/_rels/document.xml.rels", `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="rId1" Type="${r}/styles" Target="styles.xml"/></Relationships>`],
    ["word/document.xml", `<w:document xmlns:w="${w}"><w:body><w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:num="1"/></w:sectPr></w:body></w:document>`],
    ["word/styles.xml", `<w:styles xmlns:w="${w}"><w:docDefaults/><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`]
  ] as const;
  const archive: DocumentArchive = {
    comment: new Uint8Array(),
    members: parts.map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml),
      directory: false, modified: new Date("1980-01-01T00:00:00Z") }))
  };
  const chunks: Uint8Array[] = [];
  await writeArchive(archive, { async write(bytes) { chunks.push(new Uint8Array(bytes)); } },
    { order: "name", compression: "store" }, context);
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return readDocumentArchive(bytes, context);
}
