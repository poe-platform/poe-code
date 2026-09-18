import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const receiver of ["document", "appendix"] as const) for (const foreign of [false, true])
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} ${foreign ? "rejects foreign" : "accepts owned"} runs for ${receiver} comments in one package; strict=${strict}; kind=${kind}`, async () => {
  const context = { ...textContext, timestamp: new Date("2026-03-04T05:06:07Z") };
  const { input: original } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Primary coast</w:t></w:r></w:p>');
  const seed = await api.Document(original, context), memory = Volume.fromJSON({ "/input": "", "/output": "" });
  const chapter = await api.DocumentPartView.load("/appendix/chapter.xml", seed.part.content_type, enc(`<w:document xmlns:w="${seed.element.namespace}"><w:body><w:p><w:r><w:t>Appendix coast</w:t></w:r></w:p></w:body></w:document>`), seed.part.package);
  seed.part.relate_to(chapter, "urn:coast:appendix");
  await seed.save({ async write(bytes) { memory.appendFileSync("/input", bytes); } });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), runsOwner = foreign ? receiver === "document" ? "appendix" : "document" : receiver;
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: "urn:coast:appendix" }, resultHandle: "chapter" },
    { operation: "model.parts.document.DocumentPart.document.get", receiver: ref("chapter"), arguments: {}, resultHandle: "appendix" },
    { operation: "model.document.Document.paragraphs.get", receiver: ref(runsOwner), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.document.Document.add_comment.call", receiver: ref(receiver), arguments: { runs: ref("runs", 0), text: "Owned note", author: "Coast" } }
  ];
  if (route === "model") {
    const document = await api.Document(input, context), appendix = (document.part.part_related_by("urn:coast:appendix") as api.DocumentPartView).document;
    const documents = { document, appendix }, run = documents[runsOwner].paragraphs[0]!.runs[0]!;
    if (foreign) expect(() => documents[receiver].add_comment(run, "Owned note", "Coast")).toThrow(expect.objectContaining({ code: "conflict" }));
    else expect(documents[receiver].add_comment(run, "Owned note", "Coast").comment_id).toBe(0);
    await document.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else if (route === "sdk") {
    const pending = api.applyStyleModelBatch(input, { version: 1, operations }, context);
    if (foreign) await expect(pending).rejects.toMatchObject({ code: "conflict", operationIndex: 5 });
    else await (await pending).save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("Retained destination")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json --timestamp 2026-03-04T05:06:07Z");
      expect(result.exitCode, result.stdout + result.stderr).toBe(foreign ? 1 : 0);
      if (foreign) { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "conflict", operationIndex: 5 }] }); expect(await fs.readFile("/output")).toEqual(enc("Retained destination")); }
      else memory.writeFileSync("/output", await fs.readFile("/output"));
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (foreign && route === "model") expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(readPackage(input));
  if (!foreign) {
    const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
    const unaffected = receiver === "document" ? "appendix/chapter.xml" : "word/document.xml";
    expect(after.get(unaffected)).toEqual(readPackage(input).get(unaffected));
    const owner = receiver === "document" ? "word/document.xml" : "appendix/chapter.xml";
    expect(new TextDecoder().decode(after.get(owner))).toContain("commentRangeStart");
  }
});
