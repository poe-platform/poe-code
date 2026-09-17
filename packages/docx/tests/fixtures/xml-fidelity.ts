import { Volume } from "memfs";
import { writeArchive } from "../../src/index.js";
import { textContext } from "./text.js";

export type FidelityEncoding = "UTF-8" | "UTF-8-BOM" | "UTF-16LE" | "UTF-16BE";
export function fidelityBytes(source: string, encoding: FidelityEncoding): Uint8Array {
  if (encoding === "UTF-8") return new TextEncoder().encode(source);
  if (encoding === "UTF-8-BOM") return new Uint8Array(Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(source)]));
  const bytes = new Uint8Array(source.length * 2 + 2), view = new DataView(bytes.buffer), little = encoding === "UTF-16LE";
  view.setUint16(0, 0xfeff, little);
  for (let index = 0; index < source.length; index++) view.setUint16(2 + index * 2, source.charCodeAt(index), little);
  return bytes;
}
export async function xmlFidelityFixture(strict: boolean, encoding: FidelityEncoding) {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const opaque = '<x:record x:flag="retained"> lead <![CDATA[<inert>&]]><x:leaf xmlns:x="urn:original:inner" x:key="7"/> tail </x:record>';
  const source = `<?xml version="1.0" encoding="${encoding.startsWith("UTF-8") ? "UTF-8" : encoding}" standalone="yes"?>\r\n<!--before--><?audit retain?><n:document xmlns:n="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:opaque" mc:Ignorable="x"><n:body><n:p x:flag="unselected"><n:r><n:rPr><n:i/></n:rPr><n:t xml:space="preserve">  Old e&#x301; 海 &#13;  </n:t></n:r><!--inside--><?audit inside?>${opaque}</n:p></n:body></n:document><!--after--><?audit end?>`;
  const raw = fidelityBytes(source, encoding);
  const parts = new Map<string, Uint8Array>([
    ["[Content_Types].xml", new TextEncoder().encode(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/reports/main.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)],
    ["_rels/.rels", new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="${r}/officeDocument" Target="reports/main.xml"/></Relationships>`)],
    ["reports/main.xml", raw], ["audit/keep.bin", Uint8Array.of(29, 31, 241)]
  ]);
  const volume = Volume.fromJSON({ "/input": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  return { input: new Uint8Array(volume.readFileSync("/input") as Buffer), raw, source, parts, w, opaque };
}
