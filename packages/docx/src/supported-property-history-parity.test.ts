import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const owner of ["p", "r"] as const) for (const route of ["model", "sdk", "shell", "sdk-batch", "shell-batch"] as const)
 it(`${route} whole ${owner} formatting preserves supported property history through ${carrier}; strict=${strict}`, async () => {
  const old = owner === "r" ? '<w:b/><w:i/><w:rtl/><w:vanish/><w:rStyle w:val="OldCharacter"/><w:lang w:val="ar-SA" w:eastAsia="ja-JP" w:bidi="ar-SA"/><w:rFonts w:ascii="Original Latin" w:hAnsi="Original Latin" w:eastAsia="Original CJK" w:cs="Original Arabic"/>' : '<w:pStyle w:val="OldParagraph"/><w:bidi/>';
  const history = `<w:${owner}PrChange w:id="7" w:author="Original Reviewer" w:date="2026-01-02T03:04:06Z"><w:${owner}Pr>${old}</w:${owner}Pr></w:${owner}PrChange>`;
  const wrap = (active: string) => carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : ""}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:supported-property-history" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:pPr><w:jc w:val="left"/>${owner === "p" ? wrap(history) : ""}</w:pPr><w:r><w:rPr><w:b w:val="0"/>${owner === "r" ? wrap(history) : ""}</w:rPr><w:t>العربية é 漢字 🌊</w:t></w:r></w:p>`, {}, strict), memory = Volume.fromJSON({ "/out": "" });
  const operation = owner === "r" ? "runs.set" as const : "paragraphs.set" as const, args = owner === "r" ? { paragraph: 1, run: 1, bold: true } : { paragraph: 1, alignment: api.WD_PARAGRAPH_ALIGNMENT.RIGHT }, batch = { version: 1 as const, operations: [{ operation, arguments: args }] }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } };
  if (route === "model") { const doc = await api.Document(input, textContext); if (owner === "r") doc.paragraphs[0]!.runs[0]!.bold = true; else doc.paragraphs[0]!.paragraph_format.alignment = api.WD_PARAGRAPH_ALIGNMENT.RIGHT; await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } }); }
  else if (route === "sdk") { if (owner === "r") await api.formatDocumentRuns(input, { paragraph: 1, run: 1, bold: true, output: "-" }, context); else await api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { paragraph: 1, alignment: api.WD_PARAGRAPH_ALIGNMENT.RIGHT, output: "-" } }, context); }
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, context);
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(route === "shell" ? `docx ${operation.split(".").join(" ")} /input --paragraph 1 ${owner === "r" ? "--run 1 --bold true" : "--alignment RIGHT"} --output - > /out` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const p = (await api.Document(output, textContext)).paragraphs[0]!; expect(p.text).toBe("العربية é 漢字 🌊"); if (owner === "r") expect(p.runs[0]!.bold).toBe(true); else expect(p.paragraph_format.alignment).toEqual(api.WD_PARAGRAPH_ALIGNMENT.RIGHT);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml.split(history)).toHaveLength(2);
 });
