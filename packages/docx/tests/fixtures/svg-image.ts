import { Volume } from "memfs";
import { textFixture, textContext, paragraph } from "./text.js";
import { rasterPng } from "./raster.js";
import { insertDocumentImage } from "../../src/image-insertion.js";
import { readDocumentArchive } from "../../src/admission.js";
import { writeArchive } from "../../src/archive-write.js";

export const svgNamespace = "http://www.w3.org/2000/svg";
export const svgExtensionNamespace = "http://schemas.microsoft.com/office/drawing/2016/SVG/main";
export const svgRelationshipNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const svgContext = { ...textContext, encoding: { order: "input" as const, compression: "store" as const } };
export const staticSvg = new TextEncoder().encode(`<svg xmlns="${svgNamespace}" width="99" height="17" viewBox="0 0 99 17"><defs><linearGradient id="paint"><stop offset="0" stop-color="#123"/></linearGradient></defs><rect width="1" height="1" fill="url(#paint)"/></svg>`);
export function svgBinary(bytes: Uint8Array = staticSvg) {
  return { kind: "bytes" as const, base64: btoa(String.fromCharCode(...bytes)) };
}
export async function svgPairFixture(strict = false, linked = false) {
  const volume = Volume.fromJSON({ "/first": "", "/out": "" });
  await insertDocumentImage(await textFixture(paragraph("Technical input"), {}, strict), {
    operation: "images.add", options: { paragraph: 1, file: svgBinary(rasterPng()), output: "-" }
  }, { ...svgContext, stdout: { async write(bytes) { volume.appendFileSync("/first", bytes); } } });
  const archive = await readDocumentArchive(new Uint8Array(volume.readFileSync("/first") as Uint8Array), svgContext);
  const members = archive.members.map(member => {
    let xml = new TextDecoder().decode(member.bytes);
    if (member.name === "word/document.xml") xml = xml.replace('<di:blip ri:embed="rId1"/>', `<di:blip ri:embed="rId1"><di:extLst><di:ext uri="urn:retained-writer"><s:svgBlip xmlns:s="${svgExtensionNamespace}" xmlns:nr="${svgRelationshipNamespace}" nr:embed="vector"${linked ? ' nr:link="remote"' : ""}/></di:ext></di:extLst></di:blip>`);
    else if (member.name === "word/_rels/document.xml.rels") {
      const relationship = `${strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : svgRelationshipNamespace}/image`;
      xml = xml.replace("</Relationships>", `<Relationship Id="vector" Type="${relationship}" Target="media/vector.svg"/>${linked ? `<Relationship Id="remote" Type="${relationship}" Target="https://invalid.example/graphic.svg" TargetMode="External"/>` : ""}</Relationships>`);
    }
    else if (member.name === "[Content_Types].xml") xml = xml.replace("</Types>", '<Override PartName="/word/media/vector.svg" ContentType="image/svg+xml"/></Types>');
    else return member;
    return { ...member, bytes: new TextEncoder().encode(xml) };
  });
  members.push({ name: "word/media/vector.svg", bytes: new Uint8Array(staticSvg), directory: false, modified: new Date(archive.members[0]!.modified) });
  await writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/out", bytes); } }, { order: "input", compression: "store" }, svgContext);
  return new Uint8Array(volume.readFileSync("/out") as Uint8Array);
}
