import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, extractDocumentText, openDocumentLocations, formatDocumentRuns } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const future = "urn:original:text-carrier";

for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process"] as const)
 for (const domain of ["text", "properties", "segmented-text", "segmented-properties"] as const) for (const route of ["sdk", "shell"] as const)
 it(`${route} formats a partial ${domain} ${carrier} run without rejecting native carriers; strict=${strict}`, async () => {
  const textDomain = domain === "text" || domain === "segmented-text", segmented = domain.startsWith("segmented-");
  const content = segmented ? "<w:t>co</w:t><w:tab/><w:t>ast</w:t>" : "<w:t>coast</w:t>";
  const originalText = segmented ? "co\tast" : "coast", middle = segmented ? "o\tas" : "oas";
  const inactive = textDomain ? '<w:t>Inactive coast</w:t>' : '<w:rPr><w:i/></w:rPr>';
  const active = textDomain ? content : '<w:rPr><w:b/><w:color w:val="224466"/></w:rPr>';
  const wrapped = carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const properties = '<w:rPr><w:b/><w:color w:val="224466"/></w:rPr>';
  const run = textDomain ? properties + wrapped : wrapped + content;
  const input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="${future}" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:r>${run}</w:r></w:p>`, {}, strict), memory = Volume.fromJSON({ "/out": "" });
  expect((await extractDocumentText(input, textContext)).text).toBe(originalText);
  const locations = await openDocumentLocations(input, textContext), select = locations.range(locations.at("run", 1, { owner: locations.at("paragraph", 1).token }).token, 1, segmented ? 5 : 4).token;
  if (route === "sdk") await formatDocumentRuns(input, { select, bold: false, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
  else {
   const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const result = await shell.exec(`docx runs set /input --select '${select}' --bold false --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const p = (await Document(output, textContext)).paragraphs[0]!; expect(p.runs.map(r => [r.text, r.bold, r.font.color.rgb?.toString()])).toEqual([["c", true, "224466"], [middle, false, "224466"], ["t", true, "224466"]]);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml.split(inactive)).toHaveLength(2);
 });
