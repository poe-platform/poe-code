import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["font", "format"] as const) for (const value of [true, false])
for (const route of ["model", "sdk", "cli"] as const)
it(`retains spaced stored boolean property on same-value assignment; ${owner}=${value}; ${route}; ${kind}; strict=${strict}`, async () => {
  const tag = owner === "font" ? "b" : "keepNext", property = owner === "font" ? "bold" : "keep_with_next", markup = `<w:${tag} w:val=" &#x9;${value}&#xA; "/>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:pPr>${owner === "format" ? markup : ""}</w:pPr><w:r><w:rPr>${owner === "font" ? markup : ""}</w:rPr><w:t>Retain 日本 עברית é 🌊</w:t></w:r><!--retain--><?policy keep?></w:p>`);
  const memory = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
    ...(owner === "font" ? [
      { operation: "model.text.paragraph.Paragraph.runs.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "runs" },
      { operation: "model.text.run.Run.font.get", receiver: { resultHandle: "runs", index: 0 }, arguments: {}, resultHandle: "font" }
    ] : [{ operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "format" }]),
    { operation: `model.${owner === "font" ? "text.run.Font" : "text.parfmt.ParagraphFormat"}.${property}.set`, receiver: { resultHandle: owner }, arguments: { value } }
  ];
  if (route === "model") { const d = await api.Document(input, textContext), p = d.paragraphs[0]!; Reflect.set(owner === "font" ? p.runs[0]!.font : p.paragraph_format, property, value); await d.save(sink); }
  else if (route === "sdk") await (await api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).save(sink);
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --json`); expect(r.exitCode, r.stdout + r.stderr).toBe(0); memory.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
  }
  expect(readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
});
