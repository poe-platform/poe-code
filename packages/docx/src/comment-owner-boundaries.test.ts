import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const enc = (text: string) => new TextEncoder().encode(text), ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const connected of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} rejects a second anchor for one native comment body; connected=${connected}; strict=${strict}; kind=${kind}`, async () => {
  const context = { ...textContext, timestamp: new Date("2026-03-04T05:06:07Z") };
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const seed = await api.Document(input, context), w = seed.element.namespace, type = seed.part.content_type;
  const blob = enc(`<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>First coastal range</w:t></w:r></w:p><w:p><w:r><w:t>Second coastal range</w:t></w:r></w:p></w:body></w:document>`);
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.opc.part.Part.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: "model.parts.document.DocumentPart.load.call", arguments: { partname: "/appendix/chapter.xml", contentType: type, blob: { kind: "bytes", base64: Buffer.from(blob).toString("base64") }, ownerPackage: ref("package") }, resultHandle: "chapter" },
    ...(connected ? [{ operation: "model.opc.part.Part.relate_to.call", receiver: ref("main"), arguments: { target: ref("chapter"), reltype: "urn:coast:appendix" } }] : []),
    { operation: "model.parts.document.DocumentPart.comments.get", receiver: ref("chapter"), arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.add_comment.call", receiver: ref("comments"), arguments: { text: "One coastal note", author: "Coast" } },
    { operation: "model.parts.document.DocumentPart.document.get", receiver: ref("chapter"), arguments: {}, resultHandle: "appendix" },
    { operation: "model.document.Document.paragraphs.get", receiver: ref("appendix"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "first" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 1), arguments: {}, resultHandle: "second" },
    { operation: "model.text.run.Run.mark_comment_range.call", receiver: ref("first", 0), arguments: { lastRun: ref("first", 0), commentId: 0 } },
    { operation: "model.text.run.Run.mark_comment_range.call", receiver: ref("second", 0), arguments: { lastRun: ref("second", 0), commentId: 0 } }
  ];
  if (route === "model") {
    const chapter = await api.DocumentPartView.load("/appendix/chapter.xml", type, blob, seed.part.package);
    if (connected) seed.part.relate_to(chapter, "urn:coast:appendix");
    const comment = chapter.comments.add_comment("One coastal note", "Coast"), [first, second] = chapter.document.paragraphs.map(p => p.runs[0]!);
    first!.mark_comment_range(first!, comment.comment_id);
    const memory = Volume.fromJSON({ "/before": "", "/after": "" });
    await seed.save({ async write(bytes) { memory.appendFileSync("/before", bytes); } });
    expect(() => second!.mark_comment_range(second!, comment.comment_id)).toThrow(expect.objectContaining({ code: "unsupported-edit" }));
    await seed.save({ async write(bytes) { memory.appendFileSync("/after", bytes); } });
    expect(readPackage(new Uint8Array(memory.readFileSync("/after") as Buffer))).toEqual(readPackage(new Uint8Array(memory.readFileSync("/before") as Buffer)));
  } else if (route === "sdk") await expect(api.applyStyleModelBatch(input, { version: 1, operations }, context)).rejects.toMatchObject({ code: "unsupported-edit", operationIndex: operations.length - 1 });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations }))); await fs.writeFile("/output", enc("retained"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json --timestamp 2026-03-04T05:06:07Z"); expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, errors: [{ code: "unsupported-edit", operationIndex: operations.length - 1 }] }); expect(await fs.readFile("/output")).toEqual(enc("retained")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
});
