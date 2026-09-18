import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, Font, createDocxInspectionCommandEngine, formatDocumentRuns } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const future = "urn:original:text-carrier";

for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process"] as const)
 for (const owner of ["p", "r"] as const) for (const placement of ["container", "history"] as const)
 for (const active of [false, true]) for (const route of ["sdk", "shell", "model"] as const)
 it(`${route} formatting admits only inert ${owner} history in ${placement} ${carrier}; active=${active} strict=${strict}`, async () => {
  const snapshot = owner === "r" ? '<w:color w:val="884466"/>' : '<w:spacing w:after="120"/>';
  const history = `<w:${owner}PrChange w:id="7" w:author="Reviewer"><w:${owner}Pr>${snapshot}</w:${owner}Pr></w:${owner}PrChange>`;
  const wrap = (selected: string, inactive: string) => carrier === "process" ? `<f:pass>${selected}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? selected : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? selected : inactive}</mc:Fallback></mc:AlternateContent>`;
  const base = owner === "r" ? '<w:b w:val="0"/>' : '<w:keepNext/>';
  const properties = placement === "history" ? `<w:${owner}Pr>${base}${wrap(active ? history : "", active ? "" : history)}</w:${owner}Pr>` : wrap(`<w:${owner}Pr>${base}${active ? history : ""}</w:${owner}Pr>`, `<w:${owner}Pr>${active ? "" : history}</w:${owner}Pr>`);
  const input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="${future}" mc:Ignorable="f" mc:ProcessContent="f:pass">${owner === "p" ? properties : ""}<w:r>${owner === "r" ? properties : '<w:rPr><w:b w:val="0"/></w:rPr>'}<w:t>coast</w:t></w:r></w:p>`, {}, strict), original = input.slice(), memory = Volume.fromJSON({ "/out": "" });
  if (route === "model") {
   const doc = await Document(input, textContext), run = doc.paragraphs[0]!.runs[0]!;
   if (active) expect(() => { run.bold = true; }).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
   else { run.bold = true; await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } }); }
  } else if (route === "sdk") {
   const result = formatDocumentRuns(input, { paragraph: 1, run: 1, bold: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
   if (active) await expect(result).rejects.toMatchObject({ code: "unsupported-edit" }); else expect((await result).changed).toBe(true);
  } else {
   const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const result = await shell.exec("docx runs set /input --paragraph 1 --run 1 --bold true --output - > /out"); expect(result.exitCode, result.stdout + result.stderr).toBe(active ? 1 : 0); if (active) expect(result.stderr).toContain("unsupported-edit"); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original);
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer);
  if (active) expect(output).toHaveLength(0);
  else { const before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes); const p = (await Document(output, textContext)).paragraphs[0]!; expect(p.text).toBe("coast"); expect(p.runs[0]!.bold).toBe(true); expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain(history); }
 });

for (const strict of [false, true]) for (const active of [false, true])
 it(`standalone model refuses only complex selected property history; active=${active} strict=${strict}`, () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const history = '<w:rPrChange w:id="7" w:author="Reviewer"><w:rPr><w:color w:val="884466"/></w:rPr></w:rPrChange>';
  const source = `<w:r xmlns:w="${w}" xmlns:mc="${mc}" xmlns:f="${future}" mc:Ignorable="f"><w:rPr><w:b w:val="0"/>${active ? history : `<f:opaque>${history}</f:opaque>`}</w:rPr><w:t>coast</w:t></w:r>`;
  const memory = Volume.fromJSON({ "/owner.xml": source }), font = new Font({ getXml: () => memory.readFileSync("/owner.xml", "utf8") as string, setXml: source => { memory.writeFileSync("/owner.xml", source); } });
  if (active) { expect(() => { font.bold = true; }).toThrowError(expect.objectContaining({ code: "unsupported-edit" })); expect(memory.readFileSync("/owner.xml", "utf8")).toBe(source); }
  else { font.bold = true; expect(font.bold).toBe(true); expect(memory.readFileSync("/owner.xml", "utf8")).toContain(history); }
 });
