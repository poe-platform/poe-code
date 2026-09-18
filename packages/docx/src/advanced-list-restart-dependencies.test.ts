import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { w, textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const route of ["sdk", "shell"] as const)
 it(`${route} retains acyclic advanced restart metadata through subsequent list edits; strict=${strict}`, async () => {
  const numbering = `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="7"/></w:num></w:numbering>`;
  const input = await textFixture('<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Original</w:t></w:r></w:p>', { numbering: { kind: "numbering", xml: numbering } }, strict), batch = { version: 1, operations: [{ operation: "paragraphs.get", arguments: { paragraph: 1 }, resultHandle: "owner" }, { operation: "lists.levels.set", receiver: { resultHandle: "owner" }, arguments: { levels: [{ level: 0, format: "decimal", text: "%1.", start: 1, restartAfter: 1 }, { level: 1, format: "lowerLetter", text: "%2.", start: 1, restartAfter: null }] } }] }, memory = Volume.fromJSON({ "/advanced": "", "/restart": "" });
  const context = (path: string) => ({ ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync(path, bytes); } } });
  if (route === "sdk") { await api.executeDocumentBatch(input, batch, { output: "-" }, context("/advanced")); await api.editDocumentLists(new Uint8Array(memory.readFileSync("/advanced") as Buffer), { operation: "lists.set", options: { paragraph: 1, restart: true, start: 3, output: "-" } }, context("/restart")); }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try {
    for (const command of [`docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /advanced`, 'docx lists set /advanced --paragraph 1 --restart true --start 3 --output - > /restart']) { const result = await shell.exec(command); expect(result.exitCode, result.stdout + result.stderr).toBe(0); }
    expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/advanced", await fs.readFile("/advanced")); memory.writeFileSync("/restart", await fs.readFile("/restart"));
   } finally { await shell.dispose(); } }
  const advanced = readPackage(new Uint8Array(memory.readFileSync("/advanced") as Buffer)), restarted = readPackage(new Uint8Array(memory.readFileSync("/restart") as Buffer)); assertPackageLinks(advanced); assertPackageLinks(restarted);
  expect(new TextDecoder().decode(advanced.get("word/numbering.xml"))).toContain('nl:val="2"'); expect((await api.Document(new Uint8Array(memory.readFileSync("/restart") as Buffer), textContext)).paragraphs[0]!.text).toBe("Original"); for (const [name, bytes] of advanced) if (!["word/document.xml", "word/numbering.xml"].includes(name)) expect(restarted.get(name)).toEqual(bytes);
 });
