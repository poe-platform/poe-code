import { Volume } from "memfs";
import { storedArchive } from "./archive.js";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const m = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const clip = new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 109, 112, 52, 50]);
export function mediaFixture(
  options: {
    poster?: boolean;
    broken?: boolean;
    strict?: boolean;
    extra?: string;
    spoof?: boolean;
    notes?: boolean;
    mediaOnly?: boolean;
    shapeExtra?: string;
    missing?: boolean;
    captionLink?: boolean;
  } = {}
) {
  const presentation = options.strict ? "http://purl.oclc.org/ooxml/presentationml/main" : p;
  const drawing = options.strict ? "http://purl.oclc.org/ooxml/drawingml/main" : a;
  const ns = options.strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
  const entries: { name: string; bytes: Uint8Array }[] = [];
  const xml = (name: string, value: string) =>
    entries.push({ name, bytes: new TextEncoder().encode(value) });
  const rels = (name: string, rows: [string, string, string, boolean?][]) =>
    xml(
      name,
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows.map(([id, type, target, external]) => `<Relationship Id="${id}" Type="${type.includes(":") ? type : `${ns}/${type}`}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`
    );
  xml(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="mp4" ContentType="video/mp4"/><Default Extension="png" ContentType="image/png"/><Default Extension="vtt" ContentType="text/vtt"/></Types>'
  );
  rels("_rels/.rels", [["main", "officeDocument", "deck.xml"]]);
  xml(
    "deck.xml",
    `<p:presentation xmlns:p="${presentation}" xmlns:r="${ns}"><p:sldIdLst><p:sldId id="256" r:id="slide"/></p:sldIdLst></p:presentation>`
  );
  rels("_rels/deck.xml.rels", [["slide", "slide", "slide.xml"]]);
  const pic = (id: number, body: string, poster = false) =>
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Clip ${id}"/><p:nvPr>${body}</p:nvPr></p:nvPicPr>${poster ? '<p:blipFill><a:blip r:embed="poster"/></p:blipFill>' : ""}</p:pic>`;
  xml(
    "slide.xml",
    `<p:sld xmlns:p="${presentation}" xmlns:a="${drawing}" xmlns:r="${ns}" xmlns:m="${options.spoof ? "urn:untrusted" : m}" xmlns:c="http://schemas.microsoft.com/office/powerpoint/2017/3/main"><p:cSld><p:spTree>${pic(2, `${options.mediaOnly ? "" : '<a:videoFile r:link="video"/>'}<p:extLst><p:ext uri="media"><m:media r:embed="media"><m:trim st="1.25" end="8"/><m:extLst><p:ext uri="tracks"><c:tracksInfo displayLoc="media"><c:trackLst><c:track id="{82C5B42E-6860-42B6-9F87-56C0C9A44872}" label="English" r:embed="captions" ${options.captionLink ? 'r:link="captionRemote"' : ""} lang="en"/></c:trackLst></c:tracksInfo></p:ext></m:extLst></m:media></p:ext></p:extLst>`, options.poster !== false)}${pic(3, '<a:videoFile r:link="second"/>')}${pic(4, '<a:audioFile r:link="remote"/>')}${options.shapeExtra ?? ""}</p:spTree></p:cSld><p:timing><p:tnLst><p:video><p:cMediaNode vol="45000" mute="0"><p:cTn id="6" repeatCount="indefinite"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cMediaNode></p:video><p:audio><p:cMediaNode><p:cTn id="7"/><p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cMediaNode></p:audio></p:tnLst></p:timing>${options.extra ?? ""}</p:sld>`
  );
  rels("_rels/slide.xml.rels", [
    [options.missing ? "absent" : "video", options.broken ? "image" : "video", "clip.mp4"],
    ["media", "http://schemas.microsoft.com/office/2007/relationships/media", "clip.mp4"],
    ["second", "video", "clip.mp4"],
    ["remote", "audio", "file:///private/audio.wav", true],
    ["poster", "image", "poster.png"],
    [
      "captions",
      "http://schemas.microsoft.com/office/2017/04/relationships/track",
      "subtitles.vtt"
    ],
    ["notes", "notesSlide", "notes.xml"],
    ["orphan", "audio", "https://example.invalid/sound.wav", true],
    [
      "captionRemote",
      "http://schemas.microsoft.com/office/2017/04/relationships/track",
      "https://example.invalid/captions.vtt",
      true
    ]
  ]);
  xml(
    "notes.xml",
    `<p:notes xmlns:p="${presentation}" xmlns:a="${drawing}" xmlns:r="${ns}"><p:cSld><p:spTree>${options.notes ? pic(8, '<a:audioFile r:link="sound"/>') : ""}</p:spTree></p:cSld></p:notes>`
  );
  rels("_rels/notes.xml.rels", [
    ["sound", "audio", "https://example.invalid/notes.wav", true],
    ["master", "notesMaster", "notes-master.xml"]
  ]);
  xml(
    "notes-master.xml",
    `<p:notesMaster xmlns:p="${presentation}" xmlns:a="${drawing}" xmlns:r="${ns}"><p:cSld><p:spTree>${options.notes ? pic(8, '<a:audioFile r:link="sound"/>') : ""}</p:spTree></p:cSld></p:notesMaster>`
  );
  rels("_rels/notes-master.xml.rels", [
    ["sound", "audio", "https://example.invalid/notes-master.wav", true]
  ]);
  entries.push(
    { name: "clip.mp4", bytes: clip },
    { name: "poster.png", bytes: new Uint8Array([137, 80, 78, 71]) },
    {
      name: "subtitles.vtt",
      bytes: new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n")
    }
  );
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", storedArchive(entries));
  return new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer);
}
