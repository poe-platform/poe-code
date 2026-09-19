import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
 for (const member of ["superscript", "subscript"] as const)
 for (const value of [false, null])
 for (const route of ["model", "sdk-model", "sdk", "cli-model", "cli"] as const)
 it(`keeps explicit ${value} distinct from inheritance for ${member}; ${route}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:i/><w:vertAlign w:val="${member}"/></w:rPr><w:t>Retain é 日本 עברית 🌊</w:t></w:r><!--retain--><?policy keep?></w:p>`);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  const operations = [
   { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
   { operation: "model.text.paragraph.Paragraph.runs.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "runs" },
   { operation: "model.text.run.Run.font.get", receiver: { resultHandle: "runs", index: 0 }, arguments: {}, resultHandle: "font" },
   { operation: `model.text.run.Font.${member}.set`, receiver: { resultHandle: "font" }, arguments: { value } }
  ];
  if (route === "model") {
   const doc = await api.Document(input, textContext), font = doc.paragraphs[0]!.runs[0]!.font;
   Reflect.set(font, member, value); expect(font.superscript).toBe(value); expect(font.subscript).toBe(value); await doc.save(sink);
  } else if (route === "sdk-model") {
   await (await api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).save(sink);
  } else if (route === "sdk") {
   await api.formatDocumentRuns(input, { paragraph: 1, run: 1, [member]: value, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
  } else {
   const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
   const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try {
    const command = route === "cli-model" ? `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --json` : `docx runs set /input --paragraph 1 --run 1 --${member} ${value} --output /out --json`;
    const result = await shell.exec(command); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).ok).toBe(true);
    memory.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input);
   } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), parts = readPackage(output); assertPackageLinks(parts);
  for (const [name, bytes] of readPackage(input)) if (name !== "word/document.xml") expect(parts.get(name), name).toEqual(bytes);
  const paragraph = (await api.Document(output, textContext)).paragraphs[0]!, font = paragraph.runs[0]!.font;
  expect(font.superscript).toBe(value); expect(font.subscript).toBe(value); expect(font.italic).toBe(true); expect(paragraph.paragraph_format.keep_with_next).toBe(true);
  expect(paragraph.text).toBe("Retain é 日本 עברית 🌊");
  const xml = new TextDecoder().decode(parts.get("word/document.xml")); expect(xml).toContain("<!--retain--><?policy keep?>");
  if (value === false) expect(xml).toContain('baseline'); else expect(xml).not.toContain('vertAlign');
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
 });
