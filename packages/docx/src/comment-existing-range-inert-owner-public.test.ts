import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { readPackage } from "../tests/assertions.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "cli"] as const)
it(`inert custom XML comments edge cannot become story owner; strict=${strict}; kind=${kind}; route=${route}`, async () => {
  const seed = await api.readArchive(await textFixture("<w:p><w:r><w:t>Coastal anchor</w:t></w:r></w:p>", {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="23"><w:p><w:r><w:t>Existing note</w:t></w:r></w:p></w:comment></w:comments>` },
    data: { kind: "customXml", xml: `<d:data xmlns:d="urn:original:inert" xmlns:w="${w}"><w:commentReference w:id="23"/><!--inert--><?audit exact?></d:data>` }
  }, strict, { kind }), textContext);
  const types = new api.DocumentXmlEditor(seed.members.find(member => member.name === "[Content_Types].xml")!.bytes);
  types.setAttribute(types.root.children.find(node => node.attributes.some(attribute => attribute.localName === "PartName" && attribute.value === "/word/data.xml"))!, "ContentType", "application/xml");
  const relationship = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="Inert" Type="${strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}/comments" Target="comments.xml"/></Relationships>`;
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  await api.writeArchive({ ...seed, members: [...seed.members.map(member => member.name === "[Content_Types].xml" ? { ...member, bytes: types.serialize() } : member), { name: "word/_rels/data.xml.rels", bytes: new TextEncoder().encode(relationship), directory: false, modified: new Date("1980-01-01T00:00:00Z") }] }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "runs" },
    { operation: "model.text.run.Run.mark_comment_range.call", receiver: { resultHandle: "runs", index: 0 }, arguments: { lastRun: { resultHandle: "runs", index: 0 }, commentId: 23 } }
  ];
  if (route === "model") { const doc = await api.Document(input, context), run = doc.paragraphs[0]!.runs[0]!; run.mark_comment_range(run, 23); await doc.save(sink); }
  else if (route === "sdk") await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations }))); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /operations --output /destination --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/output", await fs.readFile("/destination")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), before = readPackage(input), after = readPackage(output);
  expect(after.get("word/data.xml")).toEqual(before.get("word/data.xml")); expect(after.get("word/_rels/data.xml.rels")).toEqual(before.get("word/_rels/data.xml.rels")); expect(after.get("word/comments.xml")).toEqual(before.get("word/comments.xml"));
  const inventory = await api.inspectDocumentComments(output, { operation: "comments.list", options: {} }, context); expect(inventory.items[0], JSON.stringify(inventory.items[0])).toMatchObject({ comment_id: 23, text: "Existing note", issues: [], range: { start: { part: "/word/document.xml" }, end: { part: "/word/document.xml" } } });
  expect((await api.Document(output, context)).paragraphs[0]!.text).toBe("Coastal anchor"); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
