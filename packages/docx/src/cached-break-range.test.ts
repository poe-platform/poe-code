import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
 for (const position of ["before", "inside", "after"] as const) for (const route of ["sdk", "shell"] as const)
 it(`${route} formats scalar ranges across zero-width ${position} ${carrier} cached breaks; strict=${strict}`, async () => {
  const cache = '<w:lastRenderedPageBreak/>', leaves = position === "before" ? cache + '<w:t>coast</w:t>' : position === "after" ? '<w:t>coast</w:t>' + cache : '<w:t>co</w:t>' + cache + '<w:t>ast</w:t>';
  const inactive = '<w:t>Inactive</w:t>';
  const content = carrier === "direct" ? leaves : carrier === "process" ? `<f:pass>${leaves}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? leaves : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? leaves : inactive}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:cached-range" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:r><w:rPr><w:b/><w:color w:val="224466"/></w:rPr>${content}</w:r></w:p>`, {}, strict);
  const locations = await api.openDocumentLocations(input, textContext), p = locations.at("paragraph", 1), select = locations.range(locations.at("run", 1, { owner: p.token }).token, 1, 4).token;
  expect(locations.text({ select: p.token }).text).toBe("coast");
  const memory = Volume.fromJSON({ "/out": "" });
  if (route === "sdk") await api.formatDocumentRuns(input, { select, bold: false, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
  else {
   const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const result = await shell.exec(`docx runs set /input --select '${select}' --bold false --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const paragraph = (await api.Document(output, textContext)).paragraphs[0]!;
  expect(paragraph.text).toBe("coast"); expect(paragraph.runs.filter(run => run.text).map(run => [run.text, run.bold])).toEqual([["c", true], ["oas", false], ["t", true]]);
  expect(paragraph.runs.every(run => run.font.color.rgb?.toString() === "224466")).toBe(true);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml.split(cache)).toHaveLength(2); if (carrier !== "direct") expect(xml.split(inactive)).toHaveLength(2);
 });

for (const strict of [false, true]) for (const operation of ["paragraphs.set", "paragraphs.add", "runs.add"] as const)
 for (const route of ["sdk", "shell"] as const)
 it(`${route} ${operation} applies zero-width cached-break semantics to assignment or caret splitting; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>co</w:t><w:lastRenderedPageBreak/><w:t>ast</w:t></w:r></w:p>', {}, strict);
  const locations = await api.openDocumentLocations(input, textContext), paragraph = locations.at("paragraph", 1), select = operation === "paragraphs.set" ? paragraph.token : locations.range(paragraph.token, 2, 2).token;
  const memory = Volume.fromJSON({ "/out": "" });
  if (route === "sdk") await api.editDocumentParagraphs(input, { operation, options: { select, text: "NEW", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
  else {
   const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const result = await shell.exec(`docx ${operation.split(".").join(" ")} /input --select '${select}' --text NEW --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect((await api.extractDocumentText(output, textContext)).text).toBe(operation === "paragraphs.set" ? "NEW" : operation === "runs.add" ? "coNEWast" : "co\nNEW\nast");
  const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml.split('<w:lastRenderedPageBreak/>')).toHaveLength(operation === "paragraphs.set" ? 1 : 2);
  expect((await api.Document(output, textContext)).paragraphs[0]!.paragraph_format.keep_with_next).toBe(true);
 });

for (const strict of [false, true]) it(`model paragraph assignment removes cached content and retains paragraph formatting; strict=${strict}`, async () => {
 const input = await textFixture('<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>co</w:t><w:lastRenderedPageBreak/><w:t>ast</w:t></w:r></w:p>', {}, strict);
 const doc = await api.Document(input, textContext); doc.paragraphs[0]!.text = "NEW"; expect(doc.paragraphs[0]!.text).toBe("NEW"); expect(doc.paragraphs[0]!.paragraph_format.keep_with_next).toBe(true);
 const memory = Volume.fromJSON({ "/out": "" }); await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
 const parts = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer)); assertPackageLinks(parts); expect(new TextDecoder().decode(parts.get("word/document.xml"))).not.toContain("lastRenderedPageBreak");
});
