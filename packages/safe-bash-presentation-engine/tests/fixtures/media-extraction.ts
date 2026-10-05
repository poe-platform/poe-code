import { Volume } from "memfs";
import { storedArchive } from "./archive.js";
const clip = new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 109, 112, 52, 50]);
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const m = "http://schemas.microsoft.com/office/2007/relationships/media";
export function mediaExtractionFixture(
  external = false,
  type = "video/mp4",
  split = false,
  payload = clip
) {
  const xml = (name: string, value: string) => ({ name, bytes: new TextEncoder().encode(value) });
  const rels = (name: string, rows: string) =>
    xml(
      name,
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows}</Relationships>`
    );
  const edge = (id: string, type: string, target: string, remote = false) =>
    `<Relationship Id="${id}" Type="${type}" Target="${target}"${remote ? ' TargetMode="External"' : ""}/>`;
  const shape = (id: number, ref: string, dual = false) =>
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="../../private-${id}.exe"/><p:nvPr><a:videoFile r:link="${ref}"/>${dual ? '<p:extLst><p:ext uri="media"><v:media xmlns:v="http://schemas.microsoft.com/office/powerpoint/2010/main" r:embed="modern"/></p:ext></p:extLst>' : ""}</p:nvPr></p:nvPicPr></p:pic>`;
  const entries = [
    xml(
      "[Content_Types].xml",
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="dat" ContentType="${type}"/></Types>`
    ),
    rels("_rels/.rels", edge("main", `${r}/officeDocument`, "deck.xml")),
    xml(
      "deck.xml",
      `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="256" r:id="slide"/></p:sldIdLst></p:presentation>`
    ),
    rels("_rels/deck.xml.rels", edge("slide", `${r}/slide`, "slide.xml")),
    xml(
      "slide.xml",
      `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:spTree>${shape(2, "old", true)}${shape(3, "old")}${shape(4, "copy")}</p:spTree></p:cSld></p:sld>`
    ),
    rels(
      "_rels/slide.xml.rels",
      edge("old", `${r}/video`, external ? "file:///private/clip" : "hidden.dat", external) +
        edge("modern", m, split ? "different.dat" : "hidden.dat") +
        edge("copy", `${r}/video`, "copy.dat")
    ),
    { name: "hidden.dat", bytes: payload },
    { name: "copy.dat", bytes: payload },
    { name: "different.dat", bytes: new Uint8Array([11, 22, 33]) }
  ];
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck.pptx", storedArchive(entries));
  return new Uint8Array(volume.readFileSync("/deck.pptx") as Buffer);
}
