import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const context = { ...textContext, timestamp: new Date("2026-03-04T05:06:07Z") };

async function fixture(kind: "docx" | "dotx", strict: boolean, appendix: boolean) {
  const volume = Volume.fromJSON({ "/source": "", "/input": "" });
  const archive = await api.createDocumentArchive({ kind, dialect: strict ? "strict" : "transitional", content: { version: 1, blocks: [{ kind: "paragraph", text: "Main coast" }] } }, context);
  await api.writeArchive(archive, { async write(bytes) { volume.appendFileSync("/source", bytes); } }, { order: "input", compression: "store" }, context);
  const document = await api.Document(new Uint8Array(volume.readFileSync("/source") as Buffer), context);
  if (appendix) {
    const part = await api.DocumentPartView.load("/appendix/chapter.xml", document.part.content_type, encode(`<w:document xmlns:w="${document.element.namespace}"><w:body><w:p><w:r><w:t>Appendix coast</w:t></w:r></w:p></w:body></w:document>`), document.part.package);
    document.part.relate_to(part, "urn:original:appendix");
  }
  await document.save({ async write(bytes) { volume.appendFileSync("/input", bytes); } });
  return new Uint8Array(volume.readFileSync("/input") as Buffer);
}

for (const kind of ["docx", "dotx"] as const) for (const strict of [false, true])
for (const foreignPackage of [false, true]) for (const action of ["add", "mark"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} classifies ${action} comment ownership, foreign-package=${foreignPackage}; ${kind} strict=${strict}`, async () => {
  const input = await fixture(kind, strict, true), other = await fixture(kind, !strict, false), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/foreign": Buffer.from(other), "/output": "Retained sentinel", "/saved": "" });
  if (route === "model") {
    const document = await api.Document(input, context), foreign = foreignPackage ? await api.Document(other, context) : (document.part.part_related_by("urn:original:appendix") as api.DocumentPartView).document;
    const localRun = document.paragraphs[0]!.runs[0]!, foreignRun = foreign.paragraphs[0]!.runs[0]!;
    const invoke = () => action === "add" ? document.add_comment(foreignRun, "Review", "Coast") : localRun.mark_comment_range(foreignRun, 0);
    expect(invoke).toThrow(api.OwnershipError);
    expect(invoke).toThrow(expect.objectContaining({ code: "conflict" }));
    await document.save({ async write(bytes) { volume.appendFileSync("/saved", bytes); } });
    expect(readPackage(new Uint8Array(volume.readFileSync("/saved") as Buffer))).toEqual(readPackage(input));
  } else {
    const operations: api.DocxBatchOperation[] = [
      { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
      ...(foreignPackage ? [
        { operation: "model.package.Package.open.call", arguments: { pkgFile: { path: "/foreign", capability: "command" }, context: { vfs: "command" } }, resultHandle: "foreignPackage" },
        { operation: "model.package.Package.main_document_part.get", receiver: ref("foreignPackage"), arguments: {}, resultHandle: "foreignPart" }
      ] : [{ operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: "urn:original:appendix" }, resultHandle: "foreignPart" }]),
      { operation: "model.parts.document.DocumentPart.document.get", receiver: ref("foreignPart"), arguments: {}, resultHandle: "foreignDocument" },
      { operation: "model.document.Document.paragraphs.get", receiver: ref("foreignDocument"), arguments: {}, resultHandle: "foreignParagraphs" },
      { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("foreignParagraphs", 0), arguments: {}, resultHandle: "foreignRuns" },
      { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "localParagraphs" },
      { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("localParagraphs", 0), arguments: {}, resultHandle: "localRuns" },
      action === "add" ? { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: ref("foreignRuns", 0), text: "Review", author: "Coast" } }
        : { operation: "model.text.run.Run.mark_comment_range.call", receiver: ref("localRuns", 0), arguments: { lastRun: ref("foreignRuns", 0), commentId: 0 } }
    ];
    const batch = { version: 1 as const, operations }, operationIndex = operations.length - 1;
    if (route === "sdk") {
      let failure: unknown;
      try { await api.applyStyleModelBatch(input, batch, { ...context, binaryResolver: { capability: "command", async *open(path) { yield new Uint8Array(volume.readFileSync(path) as Buffer); } } }); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(api.OwnershipError); expect(failure).toMatchObject({ code: "conflict", operationIndex });
    } else {
      const fs = new MemoryFileSystem(); for (const path of ["/input", "/foreign", "/output"]) await fs.writeFile(path, new Uint8Array(volume.readFileSync(path) as Buffer));
      await fs.writeFile("/ops", encode(JSON.stringify(batch)));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json --timestamp 2026-03-04T05:06:07Z");
        expect(result.exitCode, result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "conflict", operationIndex }] });
        for (const path of ["/input", "/foreign", "/output"]) expect(await fs.readFile(path)).toEqual(new Uint8Array(volume.readFileSync(path) as Buffer));
      } finally { await shell.dispose(); }
    }
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input)); expect(volume.readFileSync("/foreign")).toEqual(Buffer.from(other)); expect(volume.readFileSync("/output", "utf8")).toBe("Retained sentinel");
});

for (const kind of ["docx", "dotx"] as const) for (const strict of [false, true]) for (const action of ["add", "mark"] as const)
it(`keeps wrong comment ${action} argument types distinct; ${kind} strict=${strict}`, async () => {
  const input = await fixture(kind, strict, false), document = await api.Document(input, context), before = document.part.blob;
  expect(() => action === "add" ? document.add_comment({} as api.Run, "Review", "Coast") : document.paragraphs[0]!.runs[0]!.mark_comment_range({} as api.Run, 0)).toThrow(api.InputTypeError);
  expect(document.part.blob).toEqual(before);
});

it("retains unsupported cross-story comment ranges within one document", async () => {
  const document = await api.Document(undefined, context), body = document.add_paragraph("Body").runs[0]!, header = document.sections.at(0).header.add_paragraph("Header").runs[0]!, before = document.part.blob;
  expect(() => document.add_comment([body, header], "Review", "Coast")).toThrow(api.UnsupportedEditError);
  expect(() => body.mark_comment_range(header, 0)).toThrow(api.UnsupportedEditError);
  expect(document.part.blob).toEqual(before);
});
