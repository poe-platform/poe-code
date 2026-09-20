import { Volume } from "memfs";
import { writeArchive } from "../../src/index.js";
import { readPackage } from "../assertions.js";
import { textContext, textFixture, w } from "./text.js";

export async function styleDeclarationFixture(strict: boolean, kind: "docx" | "dotx", variant: "external" | "duplicate-same" | "duplicate-distinct" | "single" | "absent") {
  const styles = `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:default="1" w:styleId="Original"><w:name w:val="Original"/></w:style><w:style w:type="character" w:default="1" w:styleId="Character"><w:name w:val="Character"/></w:style><w:style w:type="table" w:default="1" w:styleId="Table"><w:name w:val="Table"/></w:style></w:styles>`;
  const input = await textFixture('<w:p><w:r><w:rPr><w:i/><w:rtl/></w:rPr><w:t>Retain é 日本 עברית 🌊</w:t></w:r><!--retain--><?policy keep?></w:p><w:tbl><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>', variant === "absent" ? {} : { styles: { kind: "styles", xml: styles }, ...(variant === "duplicate-distinct" ? { other: { kind: "styles", xml: styles } } : {}) }, strict);
  const members = readPackage(input), r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  if (variant === "external" || variant === "duplicate-same") members.set("word/_rels/document.xml.rels", new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="${r}/styles" Target="${variant === "external" ? "https://example.invalid/inert-styles" : "styles.xml"}"${variant === "external" ? ' TargetMode="External"' : ""}/>${variant === "duplicate-same" ? `<Relationship Id="duplicate" Type="${r}/styles" Target="styles.xml"/>` : ""}</Relationships>`));
  if (kind === "dotx") members.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(members.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/out": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  return { input: new Uint8Array(memory.readFileSync("/input") as Buffer), memory, members };
}
