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
for (const guard of ["native-overlap", "native-field", "opaque-crossing"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} retains ${guard} rejection beside foreign closing markers; strict=${strict}; kind=${kind}`, async () => {
  const foreign = '<u:commentRangeEnd xmlns:u="urn:coastal:uninterpreted" u:id="0"/><u:fldChar xmlns:u="urn:coastal:uninterpreted" u:fldCharType="end"/>';
  const start = guard === "native-overlap" ? '<w:commentRangeStart w:id="0"/>' : guard === "native-field" ? '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' : "";
  const end = guard === "native-overlap" ? '<w:commentRangeEnd w:id="0"/>' : guard === "native-field" ? '<w:r><w:fldChar w:fldCharType="end"/></w:r>' : "";
  const body = guard === "opaque-crossing" ? `<w:p><w:r><w:t>First coast</w:t></w:r>${foreign}<w:r><w:t>Last coast</w:t></w:r></w:p>` : `<w:p>${start}${foreign}</w:p><w:p><w:r><w:t>Selected coast</w:t></w:r></w:p><w:p>${end}</w:p>`;
  const { input: original } = await nativeStoryFixture("document.DocumentPart", strict, kind, body);
  const context = { ...textContext, timestamp: new Date("2026-03-04T05:06:07Z") }, index = guard === "opaque-crossing" ? 0 : 1;
  const prepared = Volume.fromJSON({ "/input": "", "/prepared": "" });
  const seedInput = guard === "native-overlap" ? (await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p/>")).input : original;
  const seed = await api.Document(seedInput, context);
  if (guard === "native-overlap") seed.comments.add_comment("Existing anchored note", "Coast");
  await seed.save({ async write(bytes) { prepared.appendFileSync("/prepared", bytes); } });
  const members = readPackage(new Uint8Array(prepared.readFileSync("/prepared") as Buffer));
  members.set("word/document.xml", readPackage(original).get("word/document.xml")!);
  await api.writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) },
    { async write(bytes) { prepared.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context);
  const input = new Uint8Array(prepared.readFileSync("/input") as Buffer);
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", index), arguments: {}, resultHandle: "runs" },
    { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: ref("runs"), text: "Guarded note", author: "Coast" } }
  ];
  if (route === "model") {
    const doc = await api.Document(input, context), memory = Volume.fromJSON({ "/output": "" });
    expect(() => doc.add_comment(doc.paragraphs[index]!.runs, "Guarded note", "Coast")).toThrow(expect.objectContaining({ code: "unsupported-edit" }));
    await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
    expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(readPackage(input));
  } else if (route === "sdk") await expect(api.applyStyleModelBatch(input, { version: 1, operations }, context)).rejects.toMatchObject({ code: "unsupported-edit", operationIndex: 2 });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("retained")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json --timestamp 2026-03-04T05:06:07Z");
      expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit", operationIndex: 2 }] });
      expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/output")).toEqual(enc("retained"));
    } finally { await shell.dispose(); }
  }
});
