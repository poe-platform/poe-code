import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { readPackage } from "../tests/assertions.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const noteKind of ["footnote", "endnote"] as const) for (const route of ["sdk", "cli"] as const)
it(`public scoped paragraph model admits ordinary note comment; strict=${strict}; kind=${kind}; note=${noteKind}; route=${route}`, async () => {
  const scope = noteKind === "footnote" ? "footnotes" : "endnotes";
  const input = await textFixture(`<w:p><w:r><w:t>Retained body</w:t></w:r><w:r><w:${noteKind}Reference w:id="12"/></w:r></w:p>`, {
    notes: { kind: `${noteKind}s`, xml: `<w:${noteKind}s xmlns:w="${w}"><w:${noteKind} w:id="12"><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Coastal note</w:t></w:r></w:p></w:${noteKind}><!--retained--><?audit original?></w:${noteKind}s>` }
  }, strict, { kind });
  const context = { ...textContext, timestamp: new Date("2026-03-04T05:06:07Z"), encoding: { order: "input", compression: "store" } as const };
  const locations = await api.openDocumentLocations(input, context), select = locations.at("paragraph", 1, { scope }).token;
  const operations = [
    { operation: "paragraphs.get", arguments: { select }, resultHandle: "paragraph" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraph"), arguments: {}, resultHandle: "runs" },
    { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: ref("runs"), text: "Model note", author: "" }, resultHandle: "comment" },
    { operation: "model.comments.Comment.comment_id.get", receiver: ref("comment"), arguments: {} }
  ];
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  if (route === "sdk") {
    const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, context);
    expect(batch.results.at(-1)!.value).toBe(0);
    await batch.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /operations --timestamp 2026-03-04T05:06:07Z --output /reviewed --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(0);
      memory.writeFileSync("/output", await fs.readFile("/reviewed")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), before = readPackage(input), after = readPackage(output);
  expect(after.get("word/document.xml")).toEqual(before.get("word/document.xml"));
  expect((await api.extractDocumentText(output, context, { scope })).text).toBe("Coastal note");
  expect((await api.inspectDocumentComments(output, { operation: "comments.list", options: {} }, context)).items[0]).toMatchObject({ comment_id: 0, text: "Model note", author: "", range: { start: { part: "/word/notes.xml" }, end: { part: "/word/notes.xml" } }, issues: [] });
  const source = new TextDecoder().decode(after.get("word/notes.xml")); expect(source).toContain("<!--retained-->"); expect(source).toContain("<?audit original?>"); expect(source).toContain("<w:i/>");
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
