import { Volume } from "memfs";
import { writeArchive } from "../../src/index.js";
import { textContext } from "./text.js";

export const nativeMathVariantArchiveLimits = { ...textContext.limits, maxArchiveBytes: 524288, maxEntryBytes: 262144, maxTotalBytes: 524288 };

/** Original authored carrier packages; no host files or external templates. */
export async function nativeMathNumberingVariantFixture(strict: boolean, radicals: number, prefix: string, carrier: string, codec: string, kind: string) {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const p = prefix === "default" ? "" : prefix + ":", a = prefix === "default" ? "w:" : p;
  const bindings = prefix === "default" ? `xmlns="${w}" xmlns:w="${w}"` : `xmlns:${prefix}="${w}"`;
  const text = "Native 日本 עברית ẹ́ 🌊 𠀀", mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
  const body = `<${p}p><${p}r><${p}rPr><${p}rtl/></${p}rPr><${p}t>${text}</${p}t></${p}r></${p}p>`;
  const opaque = `<${p}abstractNum ${a}abstractNumId="0">${"<f:p>".repeat(radicals)}<f:unknown/>${"</f:p>".repeat(radicals)}</${p}abstractNum>`;
  const required = prefix === "default" ? "w" : prefix;
  const representation = carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="${required}">${opaque}</mc:Choice><mc:Fallback><f:retained branch="fallback"/></mc:Fallback></mc:AlternateContent>`
    : carrier === "fallback" ? `<mc:AlternateContent><mc:Choice Requires="f"><f:retained branch="choice"/></mc:Choice><mc:Fallback>${opaque}</mc:Fallback></mc:AlternateContent>`
    : carrier === "process" ? `<f:pass>${opaque}</f:pass>` : opaque;
  const math = strict ? "http://purl.oclc.org/ooxml/officeDocument/math" : "http://schemas.openxmlformats.org/officeDocument/2006/math";
  const equation = `<${p}p><m:oMath>${"<m:rad><m:deg/><m:e>".repeat(radicals)}<m:r><m:t>x</m:t></m:r>${"</m:e></m:rad>".repeat(radicals)}</m:oMath></${p}p>`;
  const equationRepresentation = carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="${required}">${equation}</mc:Choice><mc:Fallback><f:retained branch="fallback"/></mc:Fallback></mc:AlternateContent>`
    : carrier === "fallback" ? `<mc:AlternateContent><mc:Choice Requires="f"><f:retained branch="choice"/></mc:Choice><mc:Fallback>${equation}</mc:Fallback></mc:AlternateContent>`
    : carrier === "process" ? `<f:pass>${equation}</f:pass>` : equation;
  const files: Record<string, string> = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<!--story-before--><${p}document ${bindings} xmlns:m="${math}" xmlns:f="urn:original:native-math-variants" xmlns:mc="${mc}" mc:Ignorable="f"${carrier === "process" ? ' mc:ProcessContent="f:pass"' : ""}><${p}body>${body}${equationRepresentation}</${p}body></${p}document><!--story-after-->`,
    "word/_rels/document.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><!--retain numbering edge--><Relationship Id="original-numbering" Type="${r}/numbering" Target="numbering.xml"/></Relationships>`,
    "word/numbering.xml": `<!--numbering-before--><${p}numbering ${bindings} xmlns:f="urn:original:signature-variants" xmlns:mc="${mc}" mc:Ignorable="f"${carrier === "process" ? ' mc:ProcessContent="f:pass"' : ""}>${representation}</${p}numbering><!--numbering-after-->`
  };
  const memory = Volume.fromJSON({ "/package": "" });
  await writeArchive({ comment: new Uint8Array(), members: Object.entries(files).map(([name, source]) => {
    let bytes: Uint8Array;
    if (codec === "le" || codec === "be") {
      bytes = new Uint8Array(2 + source.length * 2); bytes.set(codec === "le" ? [255, 254] : [254, 255]); const view = new DataView(bytes.buffer);
      for (let index = 0; index < source.length; index++) view.setUint16(2 + index * 2, source.charCodeAt(index), codec === "le");
    } else { const encoded = new TextEncoder().encode(source); bytes = codec === "bom" ? new Uint8Array(3 + encoded.length) : encoded; if (codec === "bom") { bytes.set([239,187,191]); bytes.set(encoded,3); } }
    return { name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") };
  }) }, { async write(bytes) { memory.appendFileSync("/package", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits: nativeMathVariantArchiveLimits });
  return { input: new Uint8Array(memory.readFileSync("/package") as Buffer), body, representation, text, equationRepresentation };
}
