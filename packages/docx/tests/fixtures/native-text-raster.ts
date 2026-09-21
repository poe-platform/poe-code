import { Volume } from "memfs";
import * as api from "../../src/index.js";
import { rasterPng, rasterJpeg, rasterGif, rasterBmp, rasterTiff } from "./raster.js";
import { textContext } from "./text.js";
import { readPackage } from "../assertions.js";
export const nativeVariants = [
  { label: "", raster: rasterPng, codec: "store" as const, floating: false },
  ...[rasterPng, rasterJpeg, rasterGif, rasterBmp, rasterTiff].flatMap(raster =>
    ["store", "deflate"].flatMap(codec => [false, true].map(floating => ({ label: `; ${raster.name}; ${codec}; ${floating ? "floating" : "inline"}`, raster, codec: codec as "store" | "deflate", floating }))))
    .filter(v => !(v.raster === rasterPng && v.codec === "store" && !v.floating))
];
export const inert = '<xr:sealed xmlns:xr="urn:original-raster-inert" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr"><xr:data>Retain 🌊 é</xr:data></xr:sealed>';
export const variants = nativeVariants.flatMap(variant => [{ ...variant, inactive: false }, { ...variant, label: variant.label + "; inactive-run-owner", inactive: true }]);
const fixtures = new Map<string, Promise<Uint8Array>>();
export function fixture(dialect: "strict" | "transitional", kind: "docx" | "dotx", variant: typeof variants[number]): Promise<Uint8Array> {
  const key = JSON.stringify([dialect, kind, variant.label]);
  let value = fixtures.get(key);
  if (!value) {
    value = (async () => {
  const memory = Volume.fromJSON({ "/base": "", "/input": "", "/output": "", "/destination": "Original retained destination" });
  const sink = (path: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(path, bytes); } });
  const archive = await api.createDocumentArchive({ kind, dialect, content: { version: 1, blocks: [
    { kind: "paragraph", runs: [{ text: "Selected 日本 עברית 🌊", bold: true }] },
    { kind: "paragraph", runs: [{ text: "Unselected é海", italic: true }] }
  ] } }, textContext);
  await api.writeDocumentArchive(archive, sink("/base"), { order: "input", compression: "store" }, textContext);
  const authored = await api.Document(new Uint8Array(memory.readFileSync("/base") as Buffer), textContext);
  authored.paragraphs[0]!.alignment = api.WD_ALIGN_PARAGRAPH.RIGHT;
  authored.paragraphs[0]!.paragraph_format.keep_with_next = true;
  authored.paragraphs[0]!.runs[0]!.font.rtl = true;
  await authored.paragraphs[0]!.runs[0]!.add_picture(variant.raster());
  await authored.paragraphs[1]!.runs[0]!.add_picture(variant.raster());
  await authored.save(sink("/input"));
  const authoredParts = readPackage(new Uint8Array(memory.readFileSync("/input") as Buffer));
  if (variant.floating) {
    const root = api.parseDocumentXml(authoredParts.get("word/document.xml")!).root;
    const wp = root.children[0]!.children[0]!.children.find(n => n.localName === "r")!.children.find(n => n.localName === "drawing")!.children[0]!.namespace;
    const xml = new TextDecoder().decode(authoredParts.get("word/document.xml")!);
    authoredParts.set("word/document.xml", new TextEncoder().encode(xml.replace('<wp:inline distT="0" distB="0" distL="0" distR="0">', `<wp:anchor xmlns:wp="${wp}" distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>`).replace('</wp:inline>', '</wp:anchor>')));
  }
  if (variant.inactive) {
    const xml = new TextDecoder().decode(authoredParts.get("word/document.xml")!);
    authoredParts.set("word/document.xml", new TextEncoder().encode(xml.replace('</' + api.parseDocumentXml(authoredParts.get("word/document.xml")!).root.children[0]!.children[0]!.children.find(n => n.localName === "r")!.name + '>', inert + '</' + api.parseDocumentXml(authoredParts.get("word/document.xml")!).root.children[0]!.children[0]!.children.find(n => n.localName === "r")!.name + '>')));
  }
  memory.writeFileSync("/input", "");
  await api.writeArchive({ comment: new Uint8Array(), members: [...authoredParts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, sink("/input"), { order: "input", compression: variant.codec }, textContext);
  return new Uint8Array(memory.readFileSync("/input") as Buffer);
    })();
    fixtures.set(key, value);
  }
  return value;
}
