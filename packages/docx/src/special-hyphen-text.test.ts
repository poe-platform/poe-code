import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, extractDocumentText, replaceDocumentText, openDocumentLocations, formatDocumentRuns, editDocumentParagraphs } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const leaf of ["noBreakHyphen", "softHyphen"] as const)
 for (const route of ["sdk", "shell"] as const) for (const action of ["range", "format", "paragraph", "insert"] as const)
 it(`${route} ${action} treats ${leaf} as one logical scalar; strict=${strict}`, async () => {
  const character = leaf === "noBreakHyphen" ? "\u2011" : "\u00ad", marker = `<w:${leaf}/>`;
  const input = await textFixture(`<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>🌊A</w:t>${marker}<w:t>B</w:t></w:r></w:p>`, {}, strict);
  expect((await extractDocumentText(input, textContext)).text).toBe(`🌊A${character}B`);
  const locations = await openDocumentLocations(input, textContext);
  const select = locations.range(locations.at("paragraph", 1).token, 2, action === "insert" ? 2 : 3).token;
  expect(() => locations.range(locations.at("paragraph", 1).token, 0, 5)).toThrow();
  const memory = Volume.fromJSON({ "/out": "" });
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } };
  if (route === "sdk") {
   if (action === "range") await replaceDocumentText(input, { select, find: character, with: "X", all: true, output: "-" }, context);
   else if (action === "format") await formatDocumentRuns(input, { select, italic: true, output: "-" }, context);
   else await editDocumentParagraphs(input, action === "paragraph" ? { operation: "paragraphs.set", options: { paragraph: 1, text: "Changed", output: "-" } } : { operation: "runs.add", options: { select, text: "X", output: "-" } }, context);
  } else {
   const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
   const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try {
    const command = action === "range" ? `text replace /input --select '${select}' --find '${character}' --with X --all` : action === "format" ? `runs set /input --select '${select}' --italic true` : action === "paragraph" ? "paragraphs set /input --paragraph 1 --text Changed" : `runs add /input --select '${select}' --text X`;
    const result = await shell.exec("docx " + command + " --output - > /out");
    expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input);
    memory.writeFileSync("/out", await fs.readFile("/out"));
   } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect((await extractDocumentText(output, textContext)).text).toBe(action === "range" ? "🌊AXB" : action === "paragraph" ? "Changed" : action === "insert" ? `🌊AX${character}B` : `🌊A${character}B`);
  const p = (await Document(output, textContext)).paragraphs[0]!; expect(p.paragraph_format.keep_with_next).toBe(true);
  if (action === "format") { expect(p.runs).toHaveLength(3); expect(p.runs.map(r => r.italic)).toEqual([null, true, null]); expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain(marker); }
 });

for (const strict of [false, true]) for (const leaf of ["noBreakHyphen", "softHyphen"] as const) for (const action of ["set", "clear", "paragraph"] as const)
 it(`model ${action} removes ${leaf} within its documented scope; strict=${strict}`, async () => {
  const input = await textFixture(`<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Before</w:t><w:${leaf}/><w:t>After</w:t></w:r></w:p>`, {}, strict);
  const doc = await Document(input, textContext), p = doc.paragraphs[0]!, run = p.runs[0]!;
  if (action === "set") run.text = "Changed"; else if (action === "clear") run.clear(); else p.text = "Changed";
  const memory = Volume.fromJSON({ "/out": "" }); await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), loaded = (await Document(output, textContext)).paragraphs[0]!;
  expect(loaded.text).toBe(action === "clear" ? "" : "Changed"); expect(loaded.paragraph_format.keep_with_next).toBe(true);
  if (action !== "paragraph") expect(loaded.runs[0]!.bold).toBe(true); else expect(loaded.runs[0]!.bold).toBe(null);
  expect(new TextDecoder().decode(readPackage(output).get("word/document.xml"))).not.toContain(`<w:${leaf}/>`);
 });
