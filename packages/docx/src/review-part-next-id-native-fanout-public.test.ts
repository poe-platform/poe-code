import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const count of [1024, 131072]) for (const route of ["model", "sdk", "cli"] as const)
it(`returned comment story part ID read admits physical fanout; strict=${strict}; kind=${kind}; count=${count}; route=${route}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const archive = await api.readArchive(await textFixture('<w:p><w:r><w:t>Retained海🌊</w:t></w:r></w:p>', { comments: { kind: "comments", xml: `<w:comments xmlns:w="${word}"><w:comment w:id="2" w:author="Archive"><w:p/></w:comment></w:comments>` } }, strict, { kind }), textContext);
  const retained = `<f:opaque id="31">${"<f:leaf/>".repeat(count)}</f:opaque>`;
  const comments = `<w:comments xmlns:w="${word}" xmlns:f="urn:original:review-part-id-fanout" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:comment w:id="2" w:author="Archive"><w:p/></w:comment>${retained}<!--retain--><?audit exact?></w:comments>`;
  const limits = { ...textContext.limits, maxArchiveBytes: 4194304, maxEntryBytes: 2097152, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 }, documentLimits = { retainedBytes: 2147483648, work: 2147483648 }, signal = new AbortController().signal;
  const context = { ...textContext, limits, signal, budget: new api.DocumentBudget(documentLimits, signal), encoding: { order: "input", compression: "store" } as const };
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ ...archive, members: archive.members.map(member => member.name === "word/comments.xml" ? { ...member, bytes: new TextEncoder().encode(comments) } : member) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: (strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships") + "/comments" }, resultHandle: "commentsPart" },
    { operation: "model.parts.comments.CommentsPart.comments.get", receiver: ref("commentsPart"), arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.get.call", receiver: ref("comments"), arguments: { commentId: 2 }, resultHandle: "comment" },
    { operation: "model.comments.Comment.part.get", receiver: ref("comment"), arguments: {}, resultHandle: "part" },
    { operation: "model.parts.story.StoryPart.next_id.get", receiver: ref("part"), arguments: {} }
  ];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const document = await api.Document(input, context), part = document.comments.get(2)!.part;
    expect(part.next_id).toBe(32); expect(part.blob).toEqual(new TextEncoder().encode(comments)); await document.save(sink);
  } else if (route === "sdk") {
    const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, context); expect(batch.results.at(-1)!.value).toBe(32); expect(batch.affected).toBe(0); await batch.save(sink);
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/destination", destination); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /operations --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, affected: 0, data: { publication: null, results: [{}, {}, {}, {}, {}, { data: 32 }] }, errors: [] });
      expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/destination")).toEqual(destination); memory.writeFileSync("/output", input);
    } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(input); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
