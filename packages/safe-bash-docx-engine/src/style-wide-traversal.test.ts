import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentBudget } from "./budget.js";
import { parseDocumentXml } from "./package-xml.js";
import { styleAllocationIds } from "./style-allocation.js";
import { styleIds } from "./style-properties.js";
import { DocumentXmlEditor } from "./xml-write.js";
import { bindXmlElementView } from "./xml-element-view.js";
import type { PackagePart } from "./package.js";
import { inspectDocument } from "./inspection.js";
import type { ArchiveContext } from "./archive.js";
import { writeArchive } from "./archive-write.js";

for (const strict of [false, true]) {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const opaque = '<f:inert/>'.repeat(131072);
  const declarations = `xmlns:w="${w}" xmlns:f="urn:original:wide-style-traversal" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"`;
  it(`reserves a stored reference after an admitted wide settings sequence; strict=${strict}`, () => {
    const memory = Volume.fromJSON({ "/settings": `<w:settings ${declarations}>${opaque}<w:defaultTableStyle w:val="Style1"/></w:settings>` });
    const bytes = new Uint8Array(memory.readFileSync("/settings") as Buffer), budget = new DocumentBudget();
    const root = parseDocumentXml(bytes, {}, budget).root;
    expect(root.children.length).toBe(131073);
    expect(root.children.length).toBeLessThan(budget.limits.xmlNodes);
    const part = { bytes, content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml" } as PackagePart;
    expect([...styleAllocationIds([part], budget, new Map([[bytes, root]]))]).toEqual(["Style1"]);
    expect(Buffer.from(memory.readFileSync("/settings") as Buffer).equals(bytes)).toBe(true);
  });
  it(`reserves native definitions after a wide inert styles sequence; strict=${strict}`, () => {
    const memory = Volume.fromJSON({ "/styles": `<w:styles ${declarations}>${opaque}<w:style w:type="paragraph" w:styleId="Style1"><w:name w:val="First"/></w:style></w:styles>` });
    const bytes = new Uint8Array(memory.readFileSync("/styles") as Buffer), budget = new DocumentBudget();
    expect([...styleIds(parseDocumentXml(bytes, {}, budget).root, budget)]).toEqual(["Style1"]);
    expect(Buffer.from(memory.readFileSync("/styles") as Buffer).equals(bytes)).toBe(true);
  });
  it(`reads nested style XML tail through a wide native part without changing it; strict=${strict}`, () => {
    const memory = Volume.fromJSON({ "/styles": `<w:styles ${declarations}>${opaque}<w:style w:type="paragraph" w:styleId="Style1"><w:name w:val="First"/>日本 עברית é 🌊</w:style></w:styles>` });
    const bytes = new Uint8Array(memory.readFileSync("/styles") as Buffer), budget = new DocumentBudget(), xml = new DocumentXmlEditor(bytes, {}, undefined, budget);
    const view = bindXmlElementView({ budget, read: () => xml, resolve: editor => editor.root, change: () => { throw new Error("Read-only witness must not write."); } });
    expect(view.children.at(-1)!.children[0]!.tail).toBe("日本 עברית é 🌊");
    expect(Buffer.from(xml.serialize()).equals(bytes)).toBe(true);
  });
  it(`inspects an admitted wide native body with exact counts and read purity; strict=${strict}`, async () => {
    const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const memory = Volume.fromJSON({
      "/main.xml": `<w:document ${declarations}><w:body>${opaque}<w:p><w:r><w:t>日本 עברית é 🌊</w:t></w:r></w:p></w:body></w:document>`,
      "/[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/main.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "/_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="main.xml"/></Relationships>`,
      "/input": ""
    });
    const context: ArchiveContext = { signal: new AbortController().signal, limits: { maxArchiveBytes: 4 * 1024 * 1024, maxEntryBytes: 2 * 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024, maxMembers: 8, maxPathBytes: 256, maxDepth: 32, maxExtraBytes: 0, maxCommentBytes: 0, maxRetainedBytes: 512 * 1024 * 1024, chunkSize: 65536 } };
    await writeArchive({ comment: new Uint8Array(), members: ["main.xml", "[Content_Types].xml", "_rels/.rels"].map(name => ({ name, bytes: new Uint8Array(memory.readFileSync("/" + name) as Buffer), directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context);
    const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
    const result = await inspectDocument(input, context);
    expect(result.counts.paragraphs).toBe(1);
    expect(result.counts.runs).toBe(1);
    expect(result.dialect).toBe(strict ? "strict" : "transitional");
    expect(result.parts.find(part => part.name === "/main.xml")!.bytes).toBe(memory.readFileSync("/main.xml").length);
    expect(Buffer.from(memory.readFileSync("/input") as Buffer).equals(input)).toBe(true);
  });
  for (const carrier of ["direct", "choice", "fallback", "process"]) it(`inspects a wide native run sequence with exact counts and read purity; strict=${strict}${carrier === "direct" ? "" : `; carrier=${carrier}`}`, async () => {
    const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const runs = "<w:r/>".repeat(131072) + '<w:r><w:t>日本 עברית é 🌊</w:t></w:r>';
    const selected = carrier === "direct" ? runs : carrier === "process" ? `<f:pass>${runs}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? runs : '<w:r><w:t>INERT</w:t></w:r>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? runs : '<w:r><w:t>INERT</w:t></w:r>'}</mc:Fallback></mc:AlternateContent>`;
    const memory = Volume.fromJSON({
      "/main.xml": `<w:document ${declarations} mc:ProcessContent="f:pass"><w:body><w:p>${selected}</w:p></w:body></w:document>`,
      "/[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/main.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "/_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="main.xml"/></Relationships>`,
      "/input": ""
    });
    const context: ArchiveContext = { signal: new AbortController().signal, limits: { maxArchiveBytes: 4 * 1024 * 1024, maxEntryBytes: 2 * 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024, maxMembers: 8, maxPathBytes: 256, maxDepth: 32, maxExtraBytes: 0, maxCommentBytes: 0, maxRetainedBytes: 512 * 1024 * 1024, chunkSize: 65536 } };
    await writeArchive({ comment: new Uint8Array(), members: ["main.xml", "[Content_Types].xml", "_rels/.rels"].map(name => ({ name, bytes: new Uint8Array(memory.readFileSync("/" + name) as Buffer), directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context);
    const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
    const result = await inspectDocument(input, context);
    expect(result.counts.paragraphs).toBe(1);
    expect(result.counts.runs).toBe(131073);
    expect(result.dialect).toBe(strict ? "strict" : "transitional");
    expect(result.parts.find(part => part.name === "/main.xml")!.bytes).toBe(memory.readFileSync("/main.xml").length);
    expect(Buffer.from(memory.readFileSync("/input") as Buffer).equals(input)).toBe(true);
  });
}
