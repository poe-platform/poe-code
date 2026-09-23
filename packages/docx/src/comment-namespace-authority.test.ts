import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const marker of ["commentRangeStart", "commentRangeEnd", "commentReference", "fldChar"])
for (const attribute of ["u", "w"]) for (const method of ["add", "mark"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} ${method} ignores foreign ${marker} with ${attribute} attributes outside the selected range; strict=${strict}; kind=${kind}`, async () => {
  const context = { ...textContext, timestamp: new Date("2026-03-04T05:06:07Z") };
  const foreign = `<u:${marker} xmlns:u="urn:coastal:uninterpreted" ${attribute}:id="0" ${attribute}:fldCharType="begin"/>`;
  const { input: original, relationships } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p>${foreign}</w:p><w:p><w:r><w:t>Coastal annotation</w:t></w:r></w:p>`);
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), seed = await api.Document(original, context);
  seed.comments.add_comment("Existing unanchored note", "Coast");
  const commentsMember = seed.part.part_related_by(relationships + "/comments").partname.toString().slice(1);
  await seed.save({ async write(bytes) { memory.appendFileSync("/input", bytes); } });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 1), arguments: {}, resultHandle: "runs" },
    method === "mark" ? { operation: "model.text.run.Run.mark_comment_range.call", receiver: ref("runs", 0), arguments: { lastRun: ref("runs", 0), commentId: 0 } } :
      { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: ref("runs", 0), text: "Additional note", author: "Coast" } }
  ];
  if (route === "model") {
    const document = await api.Document(input, context), run = document.paragraphs[1]!.runs[0]!;
    if (method === "mark") run.mark_comment_range(run, 0);
    else expect(document.add_comment(run, "Additional note", "Coast").comment_id).toBe(1);
    await document.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, context);
    await result.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json --timestamp 2026-03-04T05:06:07Z");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).ok).toBe(true);
      memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const before = readPackage(input), output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain(foreign);
  expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain(`cm:id="${method === "mark" ? 0 : 1}"`);
  for (const [name, bytes] of before) if (name !== "word/document.xml" && (method !== "add" || name !== commentsMember)) expect(after.get(name), name).toEqual(bytes);
  expect((await api.Document(output, context)).comments.length).toBe(method === "mark" ? 1 : 2);
});
