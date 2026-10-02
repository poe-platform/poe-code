import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (text: string) => new TextEncoder().encode(text);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const mode of ["create", "mark"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} ${mode}s an additional-document comment with owner-scoped body and IDs; strict=${strict}; kind=${kind}`, async () => {
  const context = { ...textContext, timestamp: new Date("2026-03-04T05:06:07Z") };
  const fixture = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Primary coast</w:t></w:r></w:p>');
  const seed = await api.Document(fixture.input, context), w = seed.element.namespace;
  seed.add_comment(seed.paragraphs[0]!.runs[0]!, "Primary note", "Coast");
  const child = await api.DocumentPartView.load("/appendix/chapter.xml", seed.part.content_type,
    enc(`<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Appendix coast</w:t></w:r></w:p></w:body></w:document>`), seed.part.package);
  seed.part.relate_to(child, "urn:coast:appendix");
  if (mode === "mark") expect(child.comments.add_comment("Appendix note", "Coast").comment_id).toBe(0);
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await seed.save({ async write(bytes) { memory.appendFileSync("/input", bytes); } });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input);
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.opc.part.Part.part_related_by.call", receiver: ref("main"), arguments: { reltype: "urn:coast:appendix" }, resultHandle: "chapter" },
    { operation: "model.parts.document.DocumentPart.document.get", receiver: ref("chapter"), arguments: {}, resultHandle: "appendix" },
    { operation: "model.document.Document.paragraphs.get", receiver: ref("appendix"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    ...(mode === "create" ? [{ operation: "model.document.Document.add_comment.call", receiver: ref("appendix"), arguments: { runs: ref("runs", 0), text: "Appendix note", author: "Coast" } }] : [{ operation: "model.text.run.Run.mark_comment_range.call", receiver: ref("runs", 0), arguments: { lastRun: ref("runs", 0), commentId: 0 } }])
  ];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const document = await api.Document(input, context), appendix = (document.part.part_related_by("urn:coast:appendix") as api.DocumentPartView).document;
    const run = appendix.paragraphs[0]!.runs[0]!;
    if (mode === "create") expect(appendix.add_comment(run, "Appendix note", "Coast").comment_id).toBe(0);
    else run.mark_comment_range(run, 0);
    expect(appendix.comments.get(0)?.text).toBe("Appendix note"); await document.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, context); await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json --timestamp 2026-03-04T05:06:07Z"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  const reopened = await api.Document(output, context), appendix = (reopened.part.part_related_by("urn:coast:appendix") as api.DocumentPartView).document;
  expect(appendix.comments.get(0)?.text).toBe("Appendix note");
  const xml = new TextDecoder().decode(after.get("appendix/chapter.xml"));
  expect(xml).toContain("commentRangeStart"); expect(xml).toContain("commentRangeEnd"); expect(xml).toContain("commentReference");
  for (const [name, bytes] of before) if (name !== "[Content_Types].xml" && !name.startsWith("appendix/")) expect(after.get(name), name).toEqual(bytes);
});
