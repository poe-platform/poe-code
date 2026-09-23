import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { readPackage } from "../tests/assertions.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const owner of ["paragraphs", "runs", "xml", "sections", "colors", "slices"] as const)
it(`negative numeric ${owner} access requires explicit at; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>日本 עברית é 🌊</w:t></w:r></w:p><w:p><w:r><w:t>Last</w:t></w:r></w:p><w:sectPr/>', {}, strict);
  const doc = await api.Document(input, textContext);
  const items = owner === "paragraphs" ? doc.paragraphs : owner === "runs" ? doc.paragraphs[0]!.runs : owner === "xml" ? doc.paragraphs[0]!.element.children : owner === "sections" ? doc.sections : owner === "colors" ? new api.RGBColor(16, 32, 48).toArray() : doc.paragraphs.slice(-1);
  expect(items.at(-1)).toBeDefined();
  if (owner === "sections") expect(doc.sections.at(-1).equals(doc.sections[0])).toBe(true);
  else expect(items.at(-1)).toBe(items[items.length - 1]);
  expect(() => items[-1]).toThrow(api.BoundsError);
  expect(() => items[-items.length]).toThrow(api.BoundsError);
  expect(() => items[-items.length - 1]).toThrow(api.BoundsError);
  expect(() => items.at(-items.length - 1)).toThrow(api.BoundsError);
  expect([...items]).toHaveLength(items.length);
  expect(doc.paragraphs[0]!.text).toBe("日本 עברית é 🌊");
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "" });
  await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
  expect(readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});

for (const strict of [false, true]) for (const route of ["sdk", "cli"] as const)
it(`${route} negative result-handle selection refuses without publication; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Last</w:t></w:r></w:p>', {}, strict);
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.text.get", receiver: { resultHandle: "paragraphs", index: -1 }, arguments: {} }
  ];
  if (route === "sdk") {
    await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "usage" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const destination = new TextEncoder().encode("Keep destination"); await fs.writeFile("/out", destination);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "usage" }] });
      expect(await fs.readFile("/input")).toEqual(input);
      expect(await fs.readFile("/out")).toEqual(destination);
    } finally { await shell.dispose(); }
  }
});
