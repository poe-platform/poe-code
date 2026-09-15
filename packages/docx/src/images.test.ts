import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createHash } from "node:crypto";
import { createDocumentFixture } from "../tests/fixtures/documents.js";
import { readArchive, type ArchiveContext } from "./archive.js";
import { writeArchive } from "./archive-write.js";
import { inspectDocumentImages, extractDocumentImages } from "./images.js";
import { DocumentBudget } from "./budget.js";
import { svgPairFixture } from "../tests/fixtures/svg-image.js";
import { svgBinary } from "../tests/fixtures/svg-image.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { insertDocumentImage } from "./image-insertion.js";

it.each(["emf", "wdp"])("preserves original inert %s bytes during unrelated image insertion", async format => {
  const native = new Uint8Array(format === "emf" ? 44 : 4);
  if (format === "emf") { native[0] = 1; native.set([32, 69, 77, 70], 40); }
  else native.set([73, 73, 188, 1]);
  const input = await fixture(carrier(`<wp:inline>${blip}</wp:inline>`), native);
  const volume = Volume.fromJSON({ "/out": "" });
  await insertDocumentImage(input, { operation: "images.add", options: { paragraph: 1, file: svgBinary(rasterPng()), output: "-" } }, {
    ...context(), encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }
  });
  const output = new Uint8Array(volume.readFileSync("/out") as Uint8Array);
  expect((await readArchive(output, context())).members.find(member => member.name === "word/media/pixel.bmp")?.bytes).toEqual(native);
  expect((await inspectDocumentImages(output, { operation: "images.get", image: 1 }, context())).item?.details.mime).toBe(format === "emf" ? "image/emf" : "image/vnd.ms-photo");
});

it("resolves native extension relationship attributes independently of a Strict owner dialect", async () => {
  const result = await inspectDocumentImages(await svgPairFixture(true), { operation: "images.list" }, context());
  expect(result.items?.[0]?.details.alternateParts).toEqual(["/word/media/vector.svg"]);
  expect(result.items?.[0]?.details.fallbackPart).toBe(result.items?.[0]?.details.part);
});
it("keeps a competing SVG extension link inert and refuses an unambiguous fallback association", async () => {
  const result = await inspectDocumentImages(await svgPairFixture(false, true), { operation: "images.list" }, context());
  expect(result.items?.[0]?.details.fallbackPart).toBeNull();
  expect(result.items?.[0]?.details.linked).toBe(true);
  expect(result.items?.[0]?.references.some(reference => reference.external)).toBe(true);
});
import type { PublicationInput } from "./publication.js";

const limits = { maxArchiveBytes: 65536, maxEntryBytes: 32768, maxTotalBytes: 65536, maxMembers: 64, maxPathBytes: 256, maxDepth: 32, maxExtraBytes: 1024, maxCommentBytes: 1024, maxRetainedBytes: 32000000, chunkSize: 512 };
const context = (): ArchiveContext => ({ limits, signal: new AbortController().signal });
const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", a = "http://schemas.openxmlformats.org/drawingml/2006/main", wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
async function fixture(content?: string, bytes?: Uint8Array, extra?: { name: string; mime: string; bytes: Uint8Array }) {
  const source = await createDocumentFixture("museum"), archive = await readArchive(source.bytes, context());
  const members = [...archive.members];
  const fs = Volume.fromJSON(Object.fromEntries(archive.members.map(member => ["/" + member.name, Buffer.from(member.bytes)])));
  if (content) fs.writeFileSync("/word/document.xml", `<w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:a="${a}" xmlns:wp="${wp}" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>${content}<w:sectPr/></w:body></w:document>`);
  if (bytes) fs.writeFileSync("/word/media/pixel.bmp", bytes);
  if (extra) {
    fs.writeFileSync("/" + extra.name, extra.bytes);
    fs.writeFileSync("/[Content_Types].xml", String(fs.readFileSync("/[Content_Types].xml", "utf8")).replace("</Types>", `<Override PartName="/${extra.name}" ContentType="${extra.mime}"/></Types>`));
    fs.writeFileSync("/word/_rels/document.xml.rels", String(fs.readFileSync("/word/_rels/document.xml.rels", "utf8")).replace("</Relationships>", `<Relationship Id="second" Type="${r}/image" Target="${extra.name.slice(5)}"/></Relationships>`));
    members.push({ name: extra.name, bytes: extra.bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") });
  }
  fs.writeFileSync("/out", new Uint8Array());
  await writeArchive({ ...archive, members: members.map(member => ({ ...member, bytes: new Uint8Array(fs.readFileSync("/" + member.name) as Uint8Array) })) }, { async write(bytes) { fs.appendFileSync("/out", bytes); } }, { order: "name", compression: "store" }, context());
  return new Uint8Array(fs.readFileSync("/out") as Uint8Array);
}
const carrier = (inside: string) => `<w:p><w:r><w:drawing>${inside}</w:drawing></w:r></w:p>`;
const blip = '<a:blip r:embed="rImage"/>';

it("separates repeated original drawing occurrences from byte identity after selection", async () => {
  const source = await createDocumentFixture("museum"), before = source.bytes.slice();
  const list = await inspectDocumentImages(source.bytes, { operation: "images.list" }, context());
  expect(list.items).toHaveLength(2);
  expect(list.items?.[0]).toMatchObject({ kind: "images", name: "/word/media/pixel.bmp", details: { bytes: 62, mime: "image/bmp", sha256: createHash("sha256").update(source.parts.get("word/media/pixel.bmp")!).digest("hex"), pixelWidth: null, pixelHeight: null } });
  const unique = await inspectDocumentImages(source.bytes, { operation: "images.list", unique: true }, context());
  expect(unique.items).toHaveLength(1); expect(unique.items?.[0]?.details.owners).toHaveLength(2);
  const selected = await inspectDocumentImages(source.bytes, { operation: "images.list", image: 2, unique: true }, context());
  expect(selected.items?.[0]?.details.owners).toHaveLength(1);
  const get = await inspectDocumentImages(source.bytes, { operation: "images.get", image: 2 }, context());
  expect(get.item?.location.token).toBe(list.items?.[1]?.location.token);
  expect(source.bytes).toEqual(before);
});
it("reads bounded stored inline transforms and anchored metadata without fabricated geometry", async () => {
  const bytes = await fixture(carrier(`<wp:anchor relativeHeight="8"><wp:extent cx="900" cy="1200"/><wp:docPr id="1" name="label" descr="Technical sample"/><wp:wrapSquare/><a:xfrm rot="5400000" flipH="1" flipV="0"/><a:srcRect l="10000" r="20000" t="0" b="0"/>${blip}</wp:anchor>`));
  const result = await inspectDocumentImages(bytes, { operation: "images.list" }, context());
  expect(result.items?.[0]?.details).toMatchObject({ widthEmu: 900, heightEmu: 1200, placement: "floating", crop: { left: .1, right: .2, top: 0, bottom: 0 }, rotation: 90, flipHorizontal: true, flipVertical: false, wrap: "square", zOrder: 8, alt: "Technical sample", decorative: null });
});
it("retains a raw native VML occurrence as preserve-only without native decoding", async () => {
  const result = await inspectDocumentImages(await fixture('<w:p><w:r><w:pict><v:shape style="width:10pt;height:20pt"><v:imagedata r:id="rImage"/></v:shape></w:pict></w:r></w:p>'), { operation: "images.list" }, context());
  expect(result.items).toHaveLength(1); expect(result.items?.[0]).toMatchObject({ support: "preserve", details: { widthEmu: null, heightEmu: null, placement: null } });
});
it("keeps unknown original bytes inert and bounds result admission before serialization", async () => {
  const bytes = await fixture(carrier(blip), Uint8Array.of(17, 23, 99));
  const result = await inspectDocumentImages(bytes, { operation: "images.list" }, context());
  expect(result.items?.[0]).toMatchObject({ support: "preserve", details: { mime: "application/octet-stream", declaredMime: "image/bmp", bytes: 3 } });
  expect(result.warnings.length).toBeGreaterThan(0);
  await expect(inspectDocumentImages(bytes, { operation: "images.list", json: true }, { ...context(), budget: new DocumentBudget({ serializedOutput: 16 }) })).rejects.toMatchObject({ code: "limit-exceeded" });
});
it("requires explicit bounded publication capability and multi-file partial consent", async () => {
  const bytes = (await createDocumentFixture("museum")).bytes;
  await expect(extractDocumentImages(bytes, { outputDir: "/out" }, { ...context(), encoding: { order: "name", compression: "store" } })).rejects.toMatchObject({ code: "unsupported-publication" });
});
it("keeps unresolved image carriers preserve-only and does not group null hashes", async () => {
  const bytes = await fixture(carrier('<wp:inline><a:blip r:embed="absent"/></wp:inline>') + carrier('<wp:inline><a:blip r:embed="absent"/></wp:inline>'));
  const result = await inspectDocumentImages(bytes, { operation: "images.list", unique: true }, context());
  expect(result.items).toHaveLength(2);
  expect(result.items?.[0]).toMatchObject({ support: "preserve", details: { part: null, mime: null, bytes: null, sha256: null } });
  expect(result.items?.[0]).not.toHaveProperty("name");
});
it("refuses a same-part raster reference masquerading as a SVG fallback pair", async () => {
  const bytes = await fixture(carrier(`<wp:inline><a:blip r:embed="rImage"><a:extLst><a:ext uri="opaque"><s:svgBlip xmlns:s="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rImage"/></a:ext></a:extLst></a:blip></wp:inline>`));
  const result = await inspectDocumentImages(bytes, { operation: "images.list" }, context());
  expect(result.items?.[0]?.details.fallbackPart).toBeNull();
  expect(result.warnings.map(warning => warning.code)).toContain("ambiguous-image-alternate");
});
it("retains an original SVG structural alternate without renderer preference or decoding", async () => {
  const bytes = await fixture(carrier(`<wp:inline><a:blip r:embed="rImage"><a:extLst><a:ext uri="opaque"><s:svgBlip xmlns:s="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="second"/></a:ext></a:extLst></a:blip></wp:inline>`), undefined, { name: "word/media/alternate.svg", mime: "image/svg+xml", bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  expect((await inspectDocumentImages(bytes, { operation: "images.list" }, context())).items?.[0]?.details).toMatchObject({ part: "/word/media/pixel.bmp", fallbackPart: "/word/media/pixel.bmp", alternateParts: ["/word/media/alternate.svg"] });
});
it("does not associate a sibling SVG metadata reference with a different image carrier", async () => {
  const bytes = await fixture(carrier(`<wp:inline>${blip}<s:svgBlip xmlns:s="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="second"/></wp:inline>`), undefined, { name: "word/media/alternate.svg", mime: "image/svg+xml", bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  expect((await inspectDocumentImages(bytes, { operation: "images.list" }, context())).items?.[0]?.details).toMatchObject({ fallbackPart: null, alternateParts: [] });
});
it("preserves every selected exact part when unique byte identities share differing targets", async () => {
  const source = await createDocumentFixture("museum"), media = source.parts.get("word/media/pixel.bmp")!;
  const bytes = await fixture(carrier(blip) + carrier('<a:blip r:embed="second"/>'), undefined, { name: "word/media/other.bmp", mime: "image/bmp", bytes: media });
  const result = await inspectDocumentImages(bytes, { operation: "images.list", unique: true }, context());
  expect(result.items).toHaveLength(1); expect(result.items?.[0]?.details.alternateParts).toContain("/word/media/other.bmp");
});
it("owns image inventory switches before asynchronous package admission", async () => {
  const bytes = (await createDocumentFixture("museum")).bytes, options = { operation: "images.list" as const, unique: true };
  const pending = inspectDocumentImages(bytes, options, context()); options.unique = false;
  expect((await pending).items).toHaveLength(1);
});
it("rejects image inventory option accessors before invoking any getter", async () => {
  const bytes = (await createDocumentFixture("museum")).bytes; let reads = 0;
  const inspection = { operation: "images.list" as const, get unique() { reads++; return true; } };
  await expect(inspectDocumentImages(bytes, inspection, context())).rejects.toMatchObject({ code: "usage" });
  expect(reads).toBe(0);
});
it("rejects image extraction input accessors before invoking any getter", async () => {
  const bytes = (await createDocumentFixture("museum")).bytes; let reads = 0;
  const extraction = { outputDir: "/out", get input() { reads++; return { path: "/input.docx", stat: {} } as PublicationInput; } };
  await expect(extractDocumentImages(bytes, extraction, { ...context(), encoding: { order: "name", compression: "store" } })).rejects.toMatchObject({ code: "usage" }); expect(reads).toBe(0);
});
it.each(["path", "stat", "size"])("rejects image publication identity %s accessors before invoking any getter", async name => {
  const bytes = (await createDocumentFixture("museum")).bytes; let reads = 0;
  const identity = { path: "/input.docx", stat: {} };
  Object.defineProperty(name === "size" ? identity.stat : identity, name, { enumerable: true, get() { reads++; return name === "path" ? "/input.docx" : name === "size" ? 1 : {}; } });
  await expect(extractDocumentImages(bytes, { outputDir: "/out", input: identity as PublicationInput }, { ...context(), encoding: { order: "name", compression: "store" } })).rejects.toMatchObject({ code: "usage" }); expect(reads).toBe(0);
});
it("groups original repeated image owners with linear location copying", async () => {
  const bytes = await fixture(carrier(blip).repeat(200)), iterator = Array.prototype[Symbol.iterator]; let visits = 0;
  Array.prototype[Symbol.iterator] = function (this: unknown[]) {
    const result = iterator.call(this), next = result.next.bind(result), value = this[0];
    const image = value && typeof value === "object" && "kind" in value && value.kind === "image";
    result.next = () => { const item = next(); if (image && !item.done) visits++; return item; }; return result;
  };
  try { const result = await inspectDocumentImages(bytes, { operation: "images.list", unique: true }, context()); expect(result.items?.[0]?.details.owners).toHaveLength(200); expect(visits).toBeLessThan(4000); }
  finally { Array.prototype[Symbol.iterator] = iterator; }
});
it("reports stored anchor axes and nulls impossible opposing crop sums", async () => {
  const bytes = await fixture(carrier(`<wp:anchor><wp:positionH relativeFrom="page"><wp:posOffset>42</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:align>top</wp:align></wp:positionV><a:srcRect l="60000" r="60000" t="0" b="0"/>${blip}</wp:anchor>`));
  expect((await inspectDocumentImages(bytes, { operation: "images.list" }, context())).items?.[0]?.details).toMatchObject({ horizontalPosition: { relativeFrom: "page", offsetEmu: 42, alignment: null }, verticalPosition: { relativeFrom: "paragraph", offsetEmu: null, alignment: "top" }, crop: null });
});
it("uses axis-specific alignment vocabularies and reads effective native layout fields", async () => {
 const { layoutFixture, layoutContext } = await import("../tests/fixtures/image-layout.js");
 const input = await layoutFixture({alter(files){const xml=new TextDecoder().decode(files.get("word/document.xml"));files.set("word/document.xml",new TextEncoder().encode(xml.replace('<wp:posOffset>-12</wp:posOffset>','<wp:align>top</wp:align>')));}});
 const data=await inspectDocumentImages(input,{operation:"images.get",image:1},layoutContext);
 expect(data.item!.details.horizontalPosition!.alignment).toBeNull();
 expect(data.item!.details).toMatchObject({distances:{left:70,top:10},allowOverlap:true,behindText:false,lockAspect:true,wrapText:"bothSides"});
});
it("reads bounded native polygons and nulls incoherent locks and invalid axis alignment", async () => {
 const { layoutFixture, layoutContext } = await import("../tests/fixtures/image-layout.js");
 const input=await layoutFixture({alter(files){const xml=new TextDecoder().decode(files.get('word/document.xml'));files.set('word/document.xml',new TextEncoder().encode(xml.replace('<wp:wrapSquare wrapText="bothSides" distL="70"/>','<wp:wrapTight wrapText="largest"><wp:wrapPolygon edited="true"><wp:start x="-27273042329600" y="10"/><wp:lineTo x="27273042316900" y="0"/><wp:lineTo x="0" y="2"/></wp:wrapPolygon></wp:wrapTight>').replace('noChangeAspect="1" noCrop="1"','noChangeAspect="0" noCrop="1"').replace('<wp:align>top</wp:align>','<wp:align>left</wp:align>')));}});
 const data=await inspectDocumentImages(input,{operation:'images.get',image:1},layoutContext);expect(data.item!.details).toMatchObject({wrapText:'largest',wrapPolygon:{start:{x:-27273042329600,y:10},lineTo:[{x:27273042316900,y:0},{x:0,y:2}]},lockAspect:null,distances:{left:30,top:10}});expect(data.item!.details.verticalPosition!.alignment).toBeNull();expect(data.warnings.length).toBeGreaterThan(0);
});
it('admits native signed-plus integers and collapsed ASCII boolean whitespace',async()=>{
 const {layoutFixture,layoutContext}=await import('../tests/fixtures/image-layout.js');const input=await layoutFixture({alter(files){const xml=new TextDecoder().decode(files.get('word/document.xml'));files.set('word/document.xml',new TextEncoder().encode(xml.replace('relativeHeight="3"','relativeHeight="+003"').replace('allowOverlap="1"','allowOverlap=" true "')));}});const data=await inspectDocumentImages(input,{operation:'images.get',image:1},layoutContext);expect(data.item!.details).toMatchObject({zOrder:3,allowOverlap:true});
});
it('rejects DrawingML on/off boolean spellings without changing WML semantics',async()=>{
 const {layoutFixture,layoutContext}=await import('../tests/fixtures/image-layout.js');const input=await layoutFixture({alter(files){const xml=new TextDecoder().decode(files.get('word/document.xml'));files.set('word/document.xml',new TextEncoder().encode(xml.replace('allowOverlap="1"','allowOverlap="on"').replace('noChangeAspect="1" noMove="1"','noChangeAspect="off" noMove="1"').replace('flipH="0"','flipH="off"')));}});const data=await inspectDocumentImages(input,{operation:'images.get',image:1},layoutContext);expect(data.item!.details).toMatchObject({allowOverlap:null,lockAspect:null,flipHorizontal:null});expect(data.warnings.length).toBeGreaterThan(0);
});
