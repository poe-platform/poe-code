import { Volume } from "memfs";
import { writeArchive, type ArchiveContext } from "../../src/index.js";

export const textContext: ArchiveContext = {
  signal: new AbortController().signal,
  limits: { maxArchiveBytes: 131072, maxEntryBytes: 65536, maxTotalBytes: 131072,
    maxMembers: 32, maxPathBytes: 256, maxDepth: 32, maxExtraBytes: 0,
    maxCommentBytes: 32, maxRetainedBytes: 32 * 1024 * 1024, chunkSize: 1024 }
};
export const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
export const paragraph = (text: string) => `<w:p>${run(text)}</w:p>`;
export const table = (cells: string[]) => `<w:tbl><w:tblGrid>${cells.map(() => "<w:gridCol/>").join("")}</w:tblGrid><w:tr>${cells.map(cell => `<w:tc>${cell}</w:tc>`).join("")}</w:tr></w:tbl>`;
export async function textFixture(body: string, stories: Record<string, { kind: string; xml: string }> = {}, strict = false) {
  const rels = (xml: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${xml}</Relationships>`;
  const edge = (id: string, kind: string, target: string) => `<Relationship Id="${id}" Type="${r}/${kind}" Target="${target}"/>`;
  const type = (part: string, kind: string) => `<Override PartName="/word/${part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`;
  const files: Record<string, string> = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${type("document", "document.main")}${Object.entries(stories).map(([part, story]) => type(part, story.kind)).join("")}</Types>`,
    "_rels/.rels": rels(edge("document", "officeDocument", "word/document.xml")),
    "word/document.xml": `<w:document xmlns:w="${w}" xmlns:r="${r}"><w:body>${body}</w:body></w:document>`,
    "word/_rels/document.xml.rels": rels(Object.entries(stories).map(([part, story]) => edge(part, story.kind, part + ".xml")).join("")),
    ...Object.fromEntries(Object.entries(stories).map(([part, story]) => ["word/" + part + ".xml", story.xml]))
  };
  const fs = Volume.fromJSON({ "/document": "" });
  await writeArchive({ comment: new Uint8Array(), members: Object.entries(files).map(([name, xml]) => ({ name,
    bytes: new TextEncoder().encode(strict ? xml.split(w).join("http://purl.oclc.org/ooxml/wordprocessingml/main").split(r).join("http://purl.oclc.org/ooxml/officeDocument/relationships") : xml),
    directory: false, modified: new Date("2025-01-02T03:04:06Z") })) },
  { async write(bytes) { fs.appendFileSync("/document", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(fs.readFileSync("/document") as Uint8Array);
}
