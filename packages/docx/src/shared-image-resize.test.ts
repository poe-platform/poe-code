import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { createDocxInspectionCommandEngine, replaceDocumentImage, writeArchive } from "./index.js";
import { replacementPng } from "../tests/fixtures/image-replacement.js";
import { textContext } from "../tests/fixtures/text.js";

const encode = (text: string) => new TextEncoder().encode(text);
async function fixture(strict: boolean, kind: "docx" | "dotx", encoded: boolean) {
  const ns = strict ? { w: "http://purl.oclc.org/ooxml/wordprocessingml/main", r: "http://purl.oclc.org/ooxml/officeDocument/relationships", a: "http://purl.oclc.org/ooxml/drawingml/main", wp: "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing", pic: "http://purl.oclc.org/ooxml/drawingml/picture" }
    : { w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships", a: "http://schemas.openxmlformats.org/drawingml/2006/main", wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", pic: "http://schemas.openxmlformats.org/drawingml/2006/picture" };
  const dir = encoded ? "r%C3%A9cords" : "récords", base = encoded ? "c%C3%B4te.xml" : "côte.xml", head = encoded ? "t%C3%AAte.xml" : "tête.xml";
  const main = dir + "/" + base, header = dir + "/" + head, media = dir + "/media/" + (encoded ? "partag%C3%A9.png" : "partagé.png");
  const relName = (name: string) => name.slice(0, name.lastIndexOf("/") + 1) + "_rels/" + name.slice(name.lastIndexOf("/") + 1) + ".rels";
  const drawing = (id: number) => '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1828800" cy="914400"/><wp:docPr id="' + id + '" name="Stored ' + id + '" descr="Original alt"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="' + ns.pic + '"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Original image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="picture"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const declarations = Object.entries(ns).map(([prefix, uri]) => 'xmlns:' + prefix + '="' + uri + '"').join(" ") + ' xmlns:f="urn:original:opaque" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"';
  const opaque = '<f:retained><!--opaque ID is reserved--><wp:docPr id="5" name="Opaque"/></f:retained>';
  const paragraph = (start: number) => '<w:p><w:r><w:t>Original</w:t></w:r>' + drawing(start) + drawing(start + 1) + '</w:p><!--retained--><?audit original?>' + opaque;
  const edge = (id: string, role: string, target: string) => '<Relationship Id="' + id + '" Type="' + ns.r + '/' + role + '" Target="' + target + '"/>';
  const rels = (xml: string) => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + xml + '</Relationships>';
  const type = (name: string, mime: string) => '<Override PartName="/' + name + '" ContentType="' + mime + '"/>';
  const members = new Map<string, Uint8Array>(Object.entries({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + type(main, "application/vnd.openxmlformats-officedocument.wordprocessingml." + (kind === "docx" ? "document" : "template") + ".main+xml") + type(header, "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml") + type(media, "image/png") + type(dir + "/media/image-1.png", "image/png") + type(dir + "/media/image1.png", "image/png") + '</Types>',
    "_rels/.rels": rels(edge("main", "officeDocument", main)),
    [main]: '<w:document ' + declarations + '><w:body>' + paragraph(1) + '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr></w:body></w:document>',
    [header]: '<w:hdr ' + declarations + '>' + paragraph(3) + '</w:hdr>',
    [relName(main)]: rels(edge("header", "header", head) + edge("picture", "image", media.slice(dir.length + 1))),
    [relName(header)]: rels(edge("picture", "image", media.slice(dir.length + 1))),
    "audit/exact.xml": "<audit>Retain exact bytes</audit>"
  }).map(([name, xml]) => [name, encode(xml)]));
  members.set(media, replacementPng(23));
  members.set(dir + "/media/image-1.png", replacementPng(31));
  members.set(dir + "/media/image1.png", replacementPng(47));
  const memory = Volume.fromJSON({ "/zip": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/zip", bytes); } }, { order: "input", compression: "store" }, textContext);
  return { input: new Uint8Array(memory.readFileSync("/zip") as Buffer), members, main, header, media, relName, drawing, opaque, ns };
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const encoded of [false, true]) for (const scope of ["body", "headers"] as const) for (const route of ["sdk", "shell"] as const) for (const sizing of ["width", "height", "stretch", "contain", "cover"] as const) it(`${route} rejects shared ${sizing} without publication; ${scope} ${kind} strict=${strict} encoded=${encoded}`, async () => {
  const { input } = await fixture(strict, kind, encoded);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "unchanged" }), replacement = replacementPng(89);
  const dimensions = sizing === "width" ? { width: { value: 1, unit: "in" as const } } : sizing === "height" ? { height: { value: 0.5, unit: "in" as const } } : { width: { value: 1, unit: "in" as const }, height: { value: 0.5, unit: "in" as const }, fit: sizing };
  if (route === "sdk") {
    await expect(replaceDocumentImage(input, { operation: "images.replace", options: { scope, image: 1, shared: true, file: { kind: "bytes", base64: btoa(String.fromCharCode(...replacement)) }, ...dimensions, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } })).rejects.toMatchObject({ code: "usage", message: "Shared replacement cannot resize occurrences." });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/new.png", replacement); await fs.writeFile("/output", encode("unchanged"));
    const size = sizing === "width" ? "--width 1in" : sizing === "height" ? "--height 0.5in" : `--width 1in --height 0.5in --fit ${sizing}`;
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec(`docx images replace /input --image 1 --scope ${scope} --shared --file /new.png ${size} --output - >> /output`);
    expect(result.exitCode, result.stderr).toBe(2); expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Shared replacement cannot resize occurrences.");
    expect(await fs.readFile("/output")).toEqual(new TextEncoder().encode("unchanged"));
    expect(await fs.readFile("/input")).toEqual(input);
  }
  expect(memory.readFileSync("/output", "utf8")).toBe("unchanged");
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
