import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const operation of ["paragraphs.format.set", "runs.fonts.set"] as const)
 for (const route of ["model-batch", "sdk-batch", "shell-batch"] as const)
 it(`${route} executes required advanced ${operation} using admitted native owners; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/><w:rtl/><w:rFonts w:ascii="Original" w:hAnsi="Original" w:cs="Original CS"/><w:lang w:val="en-US" w:eastAsia="ja-JP" w:bidi="ar-SA"/></w:rPr><w:t>🌊 é日本 עברית</w:t></w:r></w:p>', {}, strict);
  const isRun = operation === "runs.fonts.set", argumentsValue = isRun ? { eastAsia: "New CJK", theme: { complexScript: "majorBidi" }, language: { eastAsia: "zh-Hant", bidi: "he-IL" } } : { borders: { top: { style: "double", width: { value: 1, unit: "pt" }, color: "224466" } }, shading: { fill: "8899AA", pattern: "clear" } };
  const batch = { version: 1, operations: [{ operation: isRun ? "runs.get" : "paragraphs.get", arguments: isRun ? { paragraph: 1, run: 1 } : { paragraph: 1 }, resultHandle: "owner" }, { operation, receiver: { resultHandle: "owner" }, arguments: argumentsValue }] };
  const memory = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  if (route === "model-batch") { const result = await api.applyStyleModelBatch(input, batch, textContext); await result.save(sink); }
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const p = (await api.Document(output, textContext)).paragraphs[0]!; expect(p.text).toBe("🌊 é日本 עברית"); expect(p.paragraph_format.keep_with_next).toBe(true); expect(p.runs[0]!.bold).toBe(true); expect(p.runs[0]!.font.rtl).toBe(true);
  const root = api.parseDocumentXml(after.get("word/document.xml")!).root, paragraph = root.children[0]!.children[0]!, child = (node: api.XmlElement, name: string) => node.children.find(c => c.namespace === root.namespace && c.localName === name)!, attr = (node: api.XmlElement, name: string) => node.attributes.find(a => a.namespace === root.namespace && a.localName === name)?.value;
  if (isRun) { const props = child(child(paragraph, "r"), "rPr"), fonts = child(props, "rFonts"), lang = child(props, "lang"); expect([attr(fonts, "ascii"), attr(fonts, "hAnsi"), attr(fonts, "cs"), attr(fonts, "eastAsia"), attr(fonts, "cstheme")]).toEqual(["Original", "Original", "Original CS", "New CJK", "majorBidi"]); expect([attr(lang, "val"), attr(lang, "eastAsia"), attr(lang, "bidi")]).toEqual(["en-US", "zh-Hant", "he-IL"]); }
  else { const props = child(paragraph, "pPr"), border = child(child(props, "pBdr"), "top"), shading = child(props, "shd"); expect([attr(border, "val"), attr(border, "sz"), attr(border, "space"), attr(border, "color")]).toEqual(["double", "8", "0", "224466"]); expect([attr(shading, "val"), attr(shading, "fill"), attr(shading, "color")]).toEqual(["clear", "8899AA", "000000"]); }
 });

for (const strict of [false, true]) for (const route of ["sdk", "shell"] as const)
 it(`${route} retains omitted existing paragraph border space; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="8" w:space="6" w:color="112233"/></w:pBdr></w:pPr><w:r><w:t>coast</w:t></w:r></w:p>', {}, strict), memory = Volume.fromJSON({ "/out": "" });
  const borders = { top: { style: "double" as const, width: { value: 2, unit: "pt" as const }, color: "224466" } };
  if (route === "sdk") await api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { paragraph: 1, borders, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const result = await shell.exec(`docx paragraphs set /input --paragraph 1 --borders-json '${JSON.stringify(borders)}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const root = api.parseDocumentXml(after.get("word/document.xml")!).root, border = root.children[0]!.children[0]!.children[0]!.children[0]!.children[0]!;
  expect(border.attributes.find(a => a.namespace === root.namespace && a.localName === "space")?.value).toBe("6"); expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe("coast");
 });
