import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPresentation } from "./creation.js";
import { mutateNotes } from "./notes.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { sanitize } from "./sanitize.js";

const context = {
  limits: { maxBytes: 1000000, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: { maxArchiveBytes: 1000000, maxEntryBytes: 100000, maxTotalBytes: 1000000,
    maxMembers: 100, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024,
    maxTextBytes: 100000, chunkSize: 4096 },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const ct = "http://schemas.openxmlformats.org/package/2006/content-types";
const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
const enc = new TextEncoder();
function parts(bytes: Uint8Array) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  return new Map(inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer))
    .map(({name, payload}) => [name, new TextDecoder().decode(payload)]));
}
function pack(map: Map<string,string>) {
  return storedArchive([...map].map(([name, text]) => ({name, bytes: enc.encode(text)})));
}
function append(map: Map<string,string>, name: string, fragment: string) {
  const xml = map.get(name)!;
  const at = xml.lastIndexOf("</");
  map.set(name, xml.slice(0,at) + fragment + xml.slice(at));
}
async function deck() {
  return createPresentation({ slides: [{name:"Harbor", shapes:[{text:"Visible", x:1,y:1,width:100,height:100}]}] }, context);
}
describe("explicit content sanitization", () => {
  beforeAll(() => {
    const timer = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) =>
      delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
  });
  afterAll(() => vi.restoreAllMocks());
  it("requires an explicit nonempty closed policy and enforces zero-match intent", async () => {
    const bytes = await deck();
    await expect(sanitize(bytes, {remove:[]}, context)).rejects.toMatchObject({code:"invalid-value"});
    await expect(sanitize(bytes, {remove:["unknown"]} as never, context)).rejects.toMatchObject({code:"invalid-value"});
    await expect(sanitize(bytes, {remove:["comments"]}, context)).rejects.toMatchObject({code:"missing-selection"});
    const result = await sanitize(bytes,{remove:["comments"],allowEmpty:true},context);
    expect(result.bytes).toEqual(bytes);
    expect(result.affected).toBe(0);
    expect(result.warnings.join(" ")).toContain("hidden");
    expect(result.retained).toEqual(expect.arrayContaining([expect.objectContaining({part:"/ppt/slides/slide1.xml"})]));
  });
  it("removes notes and their detached master while retaining visible formatting and shared theme", async () => {
    const bytes = (await mutateNotes(await deck(),"add",{selection:{kind:"slide",position:{coordinateSystem:"one-based",value:1}},text:"Private notes"},context)).bytes;
    const before = parts(bytes);
    const result = await sanitize(bytes,{remove:["notes"]},context);
    const after = parts(result.bytes);
    expect([...after.keys()].filter(n=> n.includes("notesSlides/") || n.includes("notesMasters/"))).toEqual([]);
    expect(after.get("ppt/slides/slide1.xml")).toBe(before.get("ppt/slides/slide1.xml"));
    expect(after.get("ppt/theme/theme1.xml")).toBe(before.get("ppt/theme/theme1.xml"));
    expect(result.removed).toEqual(expect.arrayContaining([expect.objectContaining({category:"notes",kind:"part"})]));
  });
  it("retains the master binding for notes shared with opaque content",async()=>{
    const bytes=(await mutateNotes(await deck(),"add",{selection:{kind:"slide",position:{coordinateSystem:"one-based",value:1}},text:"Retained speaker data"},context)).bytes;
    const map=parts(bytes);
    append(map,"ppt/slides/_rels/slide1.xml.rels",`<Relationship xmlns="${rel}" Id="keepNotes" Type="urn:original:opaque" Target="../notesSlides/notesSlide1.xml"/>`);
    const result=await sanitize(pack(map),{remove:["notes"],allowEmpty:true},context),after=parts(result.bytes);
    expect(after.get("ppt/notesSlides/notesSlide1.xml")).toContain("Retained speaker data");
    expect(after.get("ppt/presentation.xml")).toContain("notesMasterId");
    expect(after.get("ppt/notesSlides/_rels/notesSlide1.xml.rels")).toContain("notesMaster");
  });
  it("removes selected metadata without touching notes or drawing parts", async () => {
    const before = parts(await deck());
    append(before,"docProps/core.xml",'<dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Private author</dc:creator><x:secret xmlns:x="urn:original">Retained</x:secret>');
    const bytes = pack(before);
    const result = await sanitize(bytes,{remove:["properties"]},context), after=parts(result.bytes);
    expect(after.get("docProps/core.xml")).not.toContain("Private author");
    expect(after.get("docProps/core.xml")).toContain("Retained");
    expect(after.get("docProps/app.xml")).toBe(before.get("docProps/app.xml"));
    expect(after.get("ppt/slides/slide1.xml")).toBe(before.get("ppt/slides/slide1.xml"));
    expect(after.get("_rels/.rels")).toContain("metadata/core-properties");
  });
  it("removes external hyperlinks while retaining inert actions and run formatting", async () => {
    const map=parts(await deck());
    append(map,"ppt/slides/slide1.xml",`<p:extLst><p:ext uri="urn:original"><a:rPr xmlns:a="${a}" xmlns:r="${r}" b="1" sz="1800"><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:hlinkClick r:id="remote"/><a:hlinkHover action="ppaction://program"/></a:rPr></p:ext></p:extLst>`);
    append(map,"ppt/slides/_rels/slide1.xml.rels",`<Relationship xmlns="${rel}" Id="remote" Type="${r}/hyperlink" Target="https://example.invalid/private" TargetMode="External"/>`);
    const result=await sanitize(pack(map),{remove:["links"]},context), after=parts(result.bytes);
    expect(after.get("ppt/slides/slide1.xml")).not.toContain("hlinkClick");
    expect(after.get("ppt/slides/slide1.xml")).toContain('action="ppaction://program"');
    expect(after.get("ppt/slides/slide1.xml")).toContain('b="1" sz="1800"');
    expect(after.get("ppt/slides/slide1.xml")).toContain('<a:solidFill><a:srgbClr val="123456"/></a:solidFill>');
    expect(after.get("ppt/slides/_rels/slide1.xml.rels")).not.toContain("remote");
  });
  it("removes modern comments and authors but retains a shared target used by unknown content", async () => {
    const map=parts(await deck());
    const modern="http://schemas.microsoft.com/office/2018/10/relationships";
    map.set("ppt/comments/thread.xml",'<c:cmLst xmlns:c="http://schemas.microsoft.com/office/powerpoint/2018/8/main"/>');
    map.set("ppt/authors.xml",'<c:authorLst xmlns:c="http://schemas.microsoft.com/office/powerpoint/2018/8/main"/>');
    append(map,"[Content_Types].xml",`<Override xmlns="${ct}" PartName="/ppt/comments/thread.xml" ContentType="application/vnd.ms-powerpoint.comments+xml"/><Override xmlns="${ct}" PartName="/ppt/authors.xml" ContentType="application/vnd.ms-powerpoint.authors+xml"/>`);
    append(map,"ppt/slides/_rels/slide1.xml.rels",`<Relationship xmlns="${rel}" Id="thread" Type="${modern}/comments" Target="../comments/thread.xml"/><Relationship xmlns="${rel}" Id="shared" Type="urn:original:retained" Target="../comments/thread.xml"/>`);
    append(map,"ppt/_rels/presentation.xml.rels",`<Relationship xmlns="${rel}" Id="authors" Type="${modern}/authors" Target="authors.xml"/>`);
    const result=await sanitize(pack(map),{remove:["comments"]},context), after=parts(result.bytes);
    expect(after.has("ppt/comments/thread.xml")).toBe(true);
    expect(after.has("ppt/authors.xml")).toBe(true);
    expect(after.get("ppt/slides/_rels/slide1.xml.rels")).toContain('Id="shared"');
    expect(after.get("ppt/slides/_rels/slide1.xml.rels")).not.toContain('Id="thread"');
    expect(result.retained).toEqual(expect.arrayContaining([expect.objectContaining({part:"/ppt/comments/thread.xml",reason:expect.stringContaining("shared")})]));
  });
  it.each([false,true])("removes an embedded frame and retains a payload only when shared=%s",async(shared)=>{
    const map=parts(await deck());
    const slide=map.get("ppt/slides/slide1.xml")!;
    const frame=`<p:graphicFrame xmlns:r="${r}"><p:nvGraphicFramePr><p:cNvPr id="8" name="Attachment"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off xmlns:a="${a}" x="0" y="0"/><a:ext xmlns:a="${a}" cx="100" cy="100"/></p:xfrm><a:graphic xmlns:a="${a}"><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj r:id="payload" progId="Original.Document"/></a:graphicData></a:graphic></p:graphicFrame>`;
    map.set("ppt/slides/slide1.xml",slide.replace("</p:spTree>",frame+"</p:spTree>"));
    map.set("ppt/embeddings/document.bin","original attachment");
    append(map,"[Content_Types].xml",`<Override xmlns="${ct}" PartName="/ppt/embeddings/document.bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>`);
    append(map,"ppt/slides/_rels/slide1.xml.rels",`<Relationship xmlns="${rel}" Id="payload" Type="${r}/oleObject" Target="../embeddings/document.bin"/>${shared?`<Relationship xmlns="${rel}" Id="keep" Type="urn:original:opaque" Target="../embeddings/document.bin"/>`:""}`);
    const result=await sanitize(pack(map),{remove:["objects"]},context), after=parts(result.bytes);
    expect(after.get("ppt/slides/slide1.xml")).toBe(slide);
    expect(after.has("ppt/embeddings/document.bin")).toBe(shared);
    expect(result.affected).toBe(1);
  });
  it("retains unrecognized external consumers and unowned embedded packages",async()=>{
    const map=parts(await deck());
    append(map,"ppt/slides/slide1.xml",`<p:extLst><p:ext uri="urn:original"><x:record xmlns:x="urn:original" xmlns:r="${r}" r:id="remote"/></p:ext></p:extLst>`);
    append(map,"ppt/slides/_rels/slide1.xml.rels",`<Relationship xmlns="${rel}" Id="remote" Type="${r}/hyperlink" Target="https://example.invalid/retained" TargetMode="External"/><Relationship xmlns="${rel}" Id="workbook" Type="${r}/package" Target="../embeddings/data.bin"/>`);
    map.set("ppt/embeddings/data.bin","retained resource");
    append(map,"[Content_Types].xml",`<Override xmlns="${ct}" PartName="/ppt/embeddings/data.bin" ContentType="application/octet-stream"/>`);
    const input=pack(map), result=await sanitize(input,{remove:["objects","links"],allowEmpty:true},context);
    expect(result.bytes).toEqual(input);
    expect(result.affected).toBe(0);
    expect(result.retained).toEqual(expect.arrayContaining([expect.objectContaining({relationshipId:"remote",reason:expect.stringContaining("Unsupported")}),expect.objectContaining({relationshipId:"workbook"})]));
  });
  it("rejects signed packages before selected metadata removal",async()=>{
    const map=parts(await deck());
    map.set("_xmlsignatures/origin.sigs","");
    append(map,"[Content_Types].xml",`<Override xmlns="${ct}" PartName="/_xmlsignatures/origin.sigs" ContentType="application/vnd.openxmlformats-package.digital-signature-origin"/>`);
    await expect(sanitize(pack(map),{remove:["properties"]},context)).rejects.toMatchObject({code:"unsupported-edit"});
  });
});
