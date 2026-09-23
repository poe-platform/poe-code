import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, inspectDocumentObjects, writeArchive } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["objectEmbed", "objectLink"] as const) for (const external of [false, true])
for (const owner of ["main", "header"] as const) for (const parameter of ["", ";audit=macroEnabled", '; audit="macroEnabled; oleObject"'] as const)
for (const route of ["sdk", "shell"] as const)
it(`${route} inventories native ${carrier} and DrawingML preview; ${owner} external=${external} MIME=${JSON.stringify(parameter)} ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships", a = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main", wp = strict ? "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing" : "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", pic = strict ? "http://purl.oclc.org/ooxml/drawingml/picture" : "http://schemas.openxmlformats.org/drawingml/2006/picture", encode = (s: string) => new TextEncoder().encode(s), decode = (b: Uint8Array) => new TextDecoder().decode(b);
  const object = `<w:p><w:r><w:object><w:drawing><wp:inline xmlns:wp="${wp}"><wp:extent cx="19050" cy="9525"/><wp:docPr id="9" name="Object preview"/><a:graphic xmlns:a="${a}"><a:graphicData uri="${pic}"><pic:pic xmlns:pic="${pic}"><pic:nvPicPr><pic:cNvPr id="9" name="Object preview"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="preview"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="19050" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing><w:${carrier} r:id="object" w:drawAspect="content" w:shapeId="9"${carrier === "objectLink" ? ' w:updateMode="onCall"' : ''}/></w:object></w:r></w:p>`;
  const owning = owner === "main" ? "/word/document.xml" : "/word/header.xml", preview = rasterPng(), payload = Uint8Array.of(208,207,17,224,161,177,26,225,0,255,5);
  const parts = readPackage(await chartFixture({strict, definitions: [], body: owner === "main" ? object : '<w:p/><w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>', resources: [
    ...(owner === "header" ? [{name: "word/header.xml", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml" + parameter, bytes: `<w:hdr xmlns:w="${w}" xmlns:r="${r}">${object}</w:hdr>`}] : []),
    {name: "media/preview.bin", type: "image/png" + parameter, bytes: preview},
    ...(!external ? [{name: "objects/content.bin", type: "application/vnd.openxmlformats-officedocument.oleObject" + parameter, bytes: payload}] : [])
  ], relationships: [...(owner === "header" ? [{owner: "/word/document.xml", id: "header", type: r + "/header", target: "header.xml"}] : []), {owner: owning, id: "object", type: r + "/oleObject", target: external ? "https://example.invalid/object.bin" : "../objects/content.bin", external}, {owner: owning, id: "preview", type: r + "/image", target: "../media/preview.bin"}]}));
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", (`application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml` + (owner === "main" ? parameter : "")).replaceAll('"', '&quot;'))));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}); await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  let data;
  if (route === "sdk") data = await inspectDocumentObjects(input, {}, chartContext);
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})})); const read = await shell.exec("docx objects list /input --json"); expect(read.exitCode, read.stderr).toBe(0); data = JSON.parse(read.stdout).data; expect(await fs.readFile("/input")).toEqual(input);}
  const model = await Document(input, chartContext); await model.save({async write(bytes) {memory.appendFileSync("/output", bytes);}});
  expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(parts);
  expect(data.items).toHaveLength(1); const item = data.items[0]!;
  expect(item.details.security.macro).toBe("unknown");
  expect(item.location.value).toMatchObject({part: owning, path: owner === "main" ? [0,0,0,0,1] : [0,0,0,1]});
  expect(item.details).toMatchObject({role: "ole", status: external ? "external" : "internal", security: {macro: "unknown", protected: "unknown", content: "opaque"}, previews: [{relationshipId: "preview", status: "internal", resource: {part: "/media/preview.bin", bytes: preview.length, contentType: "image/png" + parameter}}]});
  if (external) expect(item.details.resource).toBeNull(); else expect(item.details.resource).toMatchObject({part: "/objects/content.bin", bytes: payload.length, contentType: "application/vnd.openxmlformats-officedocument.oleObject" + parameter});
  expect(item.details.graphParts.map((p: {part: string}) => p.part).sort()).toEqual(external ? ["/media/preview.bin"] : ["/media/preview.bin", "/objects/content.bin"]);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
