import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "cli"] as const)
it(`existing comment ID owned by glossary cannot acquire body anchor; strict=${strict}; kind=${kind}; route=${route}`, async () => {
  const seed = await api.readArchive(await textFixture("<w:p><w:r><w:t>Unselected anchor</w:t></w:r></w:p>", {
    glossary: { kind: "glossaryDocument", xml: `<w:glossaryDocument xmlns:w="${w}"><w:docParts><w:docPart><w:docPartPr><w:name w:val="Coastal fragment"/></w:docPartPr><w:docPartBody><w:p><w:commentRangeStart w:id="23"/><w:r><w:t>Already anchored</w:t></w:r><w:commentRangeEnd w:id="23"/><w:r><w:commentReference w:id="23"/></w:r></w:p></w:docPartBody></w:docPart></w:docParts><!--retained--><?audit exact?></w:glossaryDocument>` },
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="23"><w:p><w:r><w:t>Existing note</w:t></w:r></w:p></w:comment></w:comments>` }
  }, strict, { kind }), textContext);
  const types = new api.DocumentXmlEditor(seed.members.find(member => member.name === "[Content_Types].xml")!.bytes);
  types.setAttribute(types.root.children.find(node => node.attributes.some(attribute => attribute.localName === "PartName" && attribute.value === "/word/glossary.xml"))!, "ContentType", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml");
  const temporary = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ ...seed, members: [...seed.members.map(member => member.name === "[Content_Types].xml" ? { ...member, bytes: types.serialize() } : member), { name: "word/_rels/glossary.xml.rels", bytes: new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="Comments" Type="${strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}/comments" Target="comments.xml"/></Relationships>`), directory: false, modified: new Date("1980-01-01T00:00:00Z") }] }, { async write(bytes: Uint8Array) { temporary.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(temporary.readFileSync("/input") as Buffer);
  const locations = await api.openDocumentLocations(input, textContext), select = locations.at("paragraph", 1).token;
  const operations = [
    { operation: "paragraphs.get", arguments: { select }, resultHandle: "paragraph" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: { resultHandle: "paragraph" }, arguments: {}, resultHandle: "runs" },
    { operation: "model.text.run.Run.mark_comment_range.call", receiver: { resultHandle: "runs", index: 0 }, arguments: { lastRun: { resultHandle: "runs", index: 0 }, commentId: 23 } }
  ];
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  if (route === "sdk") {
    await expect(api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit", operationIndex: 2 });
    expect(memory.statSync("/output").size).toBe(0);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const retained = new TextEncoder().encode("Retained destination"); await fs.writeFile("/destination", retained); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /operations --output /destination --force --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ affected: 0, errors: [{ code: "unsupported-edit", operationIndex: 2 }] }); expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/destination")).toEqual(retained); } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
