import { crc32 } from "@poe-code/office-package";
import { Volume } from "memfs";
import { writeArchive } from "./archive-write.js";
import { expect, it, vi } from "vitest";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { DocumentBudget } from "./budget.js";
import { readArchive } from "./archive.js";
import { DocumentArchiveEditor } from "./package-write.js";

it("preflights owned bookmark identities before producing an independently owned item clone", async () => {
  const module = await import("./control-clone.js"); const archive = await readArchive(await textFixture('<w:sdt><w:sdtPr/><w:sdtContent><w:p><w:bookmarkStart w:id="4" w:name="harbor"/><w:r><w:t>Bay</w:t></w:r><w:bookmarkEnd w:id="4"/><w:hyperlink w:anchor="harbor"><w:r><w:t>Dock</w:t></w:r></w:hyperlink></w:p></w:sdtContent></w:sdt>'), textContext);
  const editor = new DocumentArchiveEditor(archive); const xml = editor.xml("word/document.xml"); const item = xml.root.children[0]!.children[0]!;
  const planner = new module.ControlClonePlanner(archive, textContext); const clone = planner.clone(xml, item, "/word/document.xml");
  expect(clone.xml).not.toContain('w:id="4"'); expect(clone.xml).not.toContain('w:name="harbor"'); expect(clone.xml).toContain('w:anchor="harbor_');
});

it("ignores foreign local-name identity lookalikes outside the cloned item", async () => {
  const module = await import("./control-clone.js");
  const archive = await readArchive(await textFixture('<w:p/><x:bookmarkStart xmlns:x="urn:original:metadata" x:id="opaque"/><x:comment xmlns:x="urn:original:metadata" x:id="opaque"/>'), textContext);
  expect(() => new module.ControlClonePlanner(archive, textContext)).not.toThrow();
});

it("owns cloned classic-comment bodies and anchors while retaining original identities", async () => {
  const { ControlClonePlanner } = await import("./control-clone.js");
  const archive = await readArchive(await textFixture('<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent><w:p><w:commentRangeStart w:id="9"/><w:r><w:t>Bay</w:t></w:r><w:commentRangeEnd w:id="9"/><w:r><w:commentReference w:id="9"/></w:r></w:p></w:sdtContent></w:sdt>', { comments: { kind: "comments", xml: '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="9" w:author="Editor" w:date="2025-01-01T00:00:00Z"><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:comment></w:comments>' } }), textContext);
  const editor = new DocumentArchiveEditor(archive); const xml = editor.xml("word/document.xml"); const item = xml.root.children[0]!.children[0]!;
  const planner = new ControlClonePlanner(archive, textContext); const first = planner.clone(xml, item, "/word/document.xml"), second = planner.clone(xml, item, "/word/document.xml");
  expect(first.xml).not.toContain('w:id="9"'); expect(second.xml).not.toBe(first.xml);
  const staged = planner.finish(editor); const stored = new TextDecoder().decode(staged.members.find(member => member.name === "word/comments.xml")!.bytes);
  expect(stored.split('<w:comment ').length - 1).toBe(3); expect(stored).toContain('w:id="9"'); expect(stored.split('w:author="Editor"').length - 1).toBe(3); expect(stored.split('w:date="2025-01-01T00:00:00Z"').length - 1).toBe(3);
  const native = { ...archive, members: archive.members.map(member => member.name !== "word/document.xml" ? member : { ...member, bytes: new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace('<w:sdt><w:sdtPr><w:id w:val="7"/>', '<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><v:repeatingSectionItem/><w:id w:val="7"/>').replace('</w:body>', '</w:sdtContent></w:sdt></w:body>')) }) };
  const fs = Volume.fromJSON({ "/input": "", "/output": "" }); await writeArchive(native, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const { editDocumentControlRepeats } = await import("./control-repeat.js");
  await editDocumentControlRepeats(new Uint8Array(fs.readFileSync("/input") as Buffer), { control: 1, data: [{ values: [] }, { values: [] }], output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { fs.appendFileSync("/output", bytes); } } });
  const published = await readArchive(new Uint8Array(fs.readFileSync("/output") as Buffer), textContext);
  const publishedXml = new TextDecoder().decode(published.members.find(member => member.name === "word/document.xml")!.bytes);
  expect(publishedXml.split('<w:commentRangeStart').length - 1).toBe(2); expect(publishedXml).not.toContain('w:id="9"');
  const publishedComments = new TextDecoder().decode(published.members.find(member => member.name === "word/comments.xml")!.bytes);
  expect(publishedComments.split('w:author="Editor"').length - 1).toBe(3); expect(publishedComments.split('w:date="2025-01-01T00:00:00Z"').length - 1).toBe(3);

});

it("refuses bookmark references in a different admitted story", async () => {
  const { ControlClonePlanner } = await import("./control-clone.js");
  const archive = await readArchive(await textFixture('<w:sdt><w:sdtPr/><w:sdtContent><w:p><w:bookmarkStart w:id="4" w:name="harbor"/><w:r><w:t>Bay</w:t></w:r><w:bookmarkEnd w:id="4"/></w:p></w:sdtContent></w:sdt><w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>', { header: { kind: "header", xml: '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:hyperlink w:anchor="harbor"><w:r><w:t>Jump</w:t></w:r></w:hyperlink></w:p></w:hdr>' } }), textContext);
  const editor = new DocumentArchiveEditor(archive); const xml = editor.xml("word/document.xml"), item = xml.root.children[0]!.children[0]!;
  expect(() => new ControlClonePlanner(archive, textContext).clone(xml, item, "/word/document.xml")).toThrow();
});

it("remaps each hyperlink relationship occurrence without removing the shared original edge", async () => {
  const { ControlClonePlanner } = await import("./control-clone.js");
  const source = await readArchive(await textFixture('<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent><w:p><w:hyperlink r:id="rId1"><w:r><w:t>Bay</w:t></w:r></w:hyperlink></w:p></w:sdtContent></w:sdt>'), textContext);
  const archive = { ...source, members: source.members.map(member => member.name === "word/_rels/document.xml.rels" ? { ...member, bytes: new TextEncoder().encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test/harbor" TargetMode="External"/></Relationships>') } : member) };
  const editor = new DocumentArchiveEditor(archive), xml = editor.xml("word/document.xml"), item = xml.root.children[0]!.children[0]!;
  const planner = new ControlClonePlanner(archive, textContext), first = planner.clone(xml, item, "/word/document.xml"), second = planner.clone(xml, item, "/word/document.xml");
  expect(first.xml).toContain('r:id="rId2"'); expect(second.xml).toContain('r:id="rId3"');
  const staged = planner.finish(editor), stored = new TextDecoder().decode(staged.members.find(member => member.name === "word/_rels/document.xml.rels")!.bytes);
  expect(stored.split('Target="https://example.test/harbor"').length - 1).toBe(3); expect(stored).toContain('Id="rId1"');
});

it("refuses crossing bookmark ranges contained in the item", async () => {
  const { ControlClonePlanner } = await import("./control-clone.js");
  const archive = await readArchive(await textFixture('<w:sdt><w:sdtPr/><w:sdtContent><w:p><w:bookmarkStart w:id="4" w:name="first"/><w:bookmarkStart w:id="5" w:name="second"/><w:r><w:t>Bay</w:t></w:r><w:bookmarkEnd w:id="4"/><w:bookmarkEnd w:id="5"/></w:p></w:sdtContent></w:sdt>'), textContext);
  const editor = new DocumentArchiveEditor(archive), xml = editor.xml("word/document.xml"), item = xml.root.children[0]!.children[0]!;
  expect(() => new ControlClonePlanner(archive, textContext).clone(xml, item, "/word/document.xml")).toThrow();
});

it("remaps drawing occurrence IDs and relationships while retaining shared original media bytes", async () => {
  const { ControlClonePlanner } = await import("./control-clone.js");
  const drawing = '<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="19050" cy="9525"/><wp:docPr id="9" name="Original"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="9" name="Original"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="19050" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
  const source = await readArchive(await textFixture('<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="7"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:r>'+drawing+'</w:r></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>'), textContext);
  const raw = new Uint8Array([0, 17, 33, 65, 255]), packed = new Uint8Array([120, 1, 1, 5, 0, 250, 255, ...raw, 0, 0, 0, 0]);
  let sum = 1, weighted = 0; for (const byte of raw) { sum += byte; weighted += sum; } new DataView(packed.buffer).setUint32(packed.length - 4, weighted * 65536 + sum);
  const header = new Uint8Array([0,0,0,1,0,0,0,1,8,6,0,0,0]);
  const chunks = [["IHDR", header], ["IDAT", packed], ["IEND", new Uint8Array()]] as const;
  const encoded = chunks.map(([kind, payload]) => { const bytes = new Uint8Array(payload.length + 12), view = new DataView(bytes.buffer); view.setUint32(0, payload.length); bytes.set(new TextEncoder().encode(kind), 4); bytes.set(payload, 8); view.setUint32(bytes.length - 4, crc32(bytes.subarray(4, -4))); return bytes; });
  const media = new Uint8Array(8 + encoded.reduce((length, bytes) => length + bytes.length, 0)); media.set([137,80,78,71,13,10,26,10]); let mediaOffset = 8; for (const bytes of encoded) { media.set(bytes, mediaOffset); mediaOffset += bytes.length; }
  const archive = { ...source, members: [...source.members.map(member => {
    if (member.name === "word/_rels/document.xml.rels") return { ...member, bytes: new TextEncoder().encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pixel.png"/></Relationships>') };
    if (member.name === "[Content_Types].xml") return { ...member, bytes: new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>')) };
    return member;
  }), { name: "word/media/pixel.png", bytes: media, directory: false, modified: new Date("2025-01-01T00:00:00Z") }] };
  const editor = new DocumentArchiveEditor(archive), xml = editor.xml("word/document.xml"), item = xml.root.children[0]!.children[0]!;
  const planner = new ControlClonePlanner(archive, textContext), first = planner.clone(xml, item, "/word/document.xml"), second = planner.clone(xml, item, "/word/document.xml");
  expect(first.xml).toContain('<wp:docPr'); expect(first.xml).not.toContain('id="9"'); expect(second.xml).not.toBe(first.xml);
  const staged = planner.finish(editor); expect(staged.members.find(member => member.name === "word/media/pixel.png")!.bytes).toEqual(media);
  expect(staged.members.filter(member => member.name.startsWith("word/media/"))).toHaveLength(1);
  expect(new TextDecoder().decode(staged.members.find(member => member.name === "word/_rels/document.xml.rels")!.bytes).split('Target="media/pixel.png"').length - 1).toBe(3);
  const fs = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive(archive, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const { editDocumentControlRepeats } = await import("./control-repeat.js");
  await editDocumentControlRepeats(new Uint8Array(fs.readFileSync("/input") as Buffer), { control: 1, data: [{ values: [] }, { values: [] }], output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { fs.appendFileSync("/output", bytes); } } });
  const published = await readArchive(new Uint8Array(fs.readFileSync("/output") as Buffer), textContext);
  expect(published.members.find(member => member.name === "word/media/pixel.png")!.bytes).toEqual(media);
  const documentXml = new TextDecoder().decode(published.members.find(member => member.name === "word/document.xml")!.bytes);
  expect(documentXml.split('<wp:docPr').length - 1).toBe(2); expect(documentXml).not.toContain('docPr id="9"');
  for (const malformed of ["grammar", "media"]) {
    const invalid = { ...archive, members: archive.members.map(member => malformed === "media" && member.name === "word/media/pixel.png" ? { ...member, bytes: media.subarray(0, 8) } : malformed === "grammar" && member.name === "word/document.xml" ? { ...member, bytes: new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace('<wp:extent cx="19050" cy="9525"/>', "")) } : member) };
    fs.writeFileSync("/input", ""); fs.writeFileSync("/output", "");
    await writeArchive(invalid, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
    await expect(editDocumentControlRepeats(new Uint8Array(fs.readFileSync("/input") as Buffer), { control: 1, data: [{ values: [] }], output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { fs.appendFileSync("/output", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(fs.readFileSync("/output").length).toBe(0);
  }


});

it("refuses opaque attributes in stored classic-comment bodies", async () => {
  const { ControlClonePlanner } = await import("./control-clone.js");
  const archive = await readArchive(await textFixture('<w:sdt><w:sdtPr/><w:sdtContent><w:p><w:commentRangeStart w:id="9"/><w:r><w:t>Bay</w:t></w:r><w:commentRangeEnd w:id="9"/><w:r><w:commentReference w:id="9"/></w:r></w:p></w:sdtContent></w:sdt>', { comments: { kind: "comments", xml: '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="9" w:author="Editor"><w:p w:future="opaque"><w:r><w:t>Note</w:t></w:r></w:p></w:comment></w:comments>' } }), textContext);
  const editor = new DocumentArchiveEditor(archive), xml = editor.xml("word/document.xml"), item = xml.root.children[0]!.children[0]!;
  expect(() => new ControlClonePlanner(archive, textContext).clone(xml, item, "/word/document.xml")).toThrow();
});

it("admits work before entering clone traversal or allocating child census arrays", async () => {
  const { ControlClonePlanner } = await import("./control-clone.js"); const archive = await readArchive(await textFixture('<w:sdt><w:sdtPr/><w:sdtContent><w:p><w:r><w:t>Bay</w:t></w:r></w:p></w:sdtContent></w:sdt>'), textContext);
  const editor = new DocumentArchiveEditor(archive), xml = editor.xml("word/document.xml"), item = xml.root.children[0]!.children[0]!;
  const budget = new DocumentBudget({ work: 1000000 }, textContext.signal), planner = new ControlClonePlanner(archive, { ...textContext, budget });
  budget.charge("work", budget.limits.work - budget.usage.work); let entered = false; const original = Array.prototype.flatMap;
  const spy = vi.spyOn(Array.prototype, "flatMap").mockImplementation(function (this: unknown[], ...args: Parameters<typeof original>) { if (this === item.children) entered = true; return original.apply(this, args); });
  try { expect(() => planner.clone(xml, item, "/word/document.xml")).toThrow(); expect(entered).toBe(false); } finally { spy.mockRestore(); }
});

it("reserves retained child-owner map references before storing them", async () => {
  const { ControlClonePlanner } = await import("./control-clone.js"); const archive = await readArchive(await textFixture('<w:sdt><w:sdtPr/><w:sdtContent><w:p><w:r><w:t>Bay</w:t></w:r></w:p></w:sdtContent></w:sdt>'), textContext);
  const editor = new DocumentArchiveEditor(archive), xml = editor.xml("word/document.xml"), item = xml.root.children[0]!.children[0]!;
  const budget = new DocumentBudget({ retainedBytes: 1000000 }, textContext.signal), planner = new ControlClonePlanner(archive, { ...textContext, budget });
  budget.charge("retainedBytes", budget.limits.retainedBytes - budget.usage.retainedBytes - 48); let stored = false; const original = Map.prototype.set;
  const spy = vi.spyOn(Map.prototype, "set").mockImplementation(function (this: Map<unknown, unknown>, key: unknown, value: unknown) { if (key === item.children[0]) stored = true; return original.call(this, key, value); });
  try { expect(() => planner.clone(xml, item, "/word/document.xml")).toThrow(); expect(stored).toBe(false); } finally { spy.mockRestore(); }
});

it("does not census Word-shaped user data as story identities and preserves its bytes", async () => {
  const { editDocumentControlRepeats } = await import("./control-repeat.js");
  const source = await readArchive(await textFixture('<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="2"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Bay</w:t></w:r></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>'), textContext);
  const metadata = new TextEncoder().encode('<data xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:sdtPr><w:id w:val="opaque"/></w:sdtPr><w:bookmarkStart w:id="opaque"/></data>');
  const archive = { ...source, members: [...source.members.map(member => member.name !== "[Content_Types].xml" ? member : { ...member, bytes: new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace('</Types>', '<Override PartName="/customXml/data.xml" ContentType="application/xml"/></Types>')) }), { name: "customXml/data.xml", bytes: metadata, directory: false, modified: new Date("2025-01-01T00:00:00Z") }] };
  const fs = Volume.fromJSON({ "/input": "", "/output": "" }); await writeArchive(archive, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  await editDocumentControlRepeats(new Uint8Array(fs.readFileSync("/input") as Buffer), { control: 1, data: [{ values: [] }], output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { fs.appendFileSync("/output", bytes); } } });
  const output = await readArchive(new Uint8Array(fs.readFileSync("/output") as Buffer), textContext);
  expect(output.members.find(member => member.name === "customXml/data.xml")!.bytes).toEqual(metadata);
});
