import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const histories = ["ins", "tblPrChange", "tblGridChange", "trPrChange", "tcPrChange", "cellIns", "cellDel", "cellMerge"] as const;
for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const history of histories) for (const action of ["cell-add", "paragraph-add", "level", "restart"] as const)
for (const route of ["sdk", "cli"] as const)
it(`${route} refuses affected list ${action} through native ${history} ${carrier} strict=${strict}`, async () => {
  const snapshot = history === "tblPrChange" ? "<w:tblPr/>" : history === "tblGridChange" ? '<w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid>' : history === "trPrChange" ? "<w:trPr/>" : history === "tcPrChange" ? "<w:tcPr/>" : "";
  const marker = `<w:${history} w:id="7" w:author="Original reviewer" w:date="2026-01-02T03:04:06Z"${history === "cellMerge" ? ' w:vMerge="rest" w:vMergeOrig="cont"' : ""}>${snapshot}</w:${history}>`;
  const wrapped = carrier === "direct" ? marker : carrier === "process" ? `<f:pass>${marker}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? marker : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? marker : ""}</mc:Fallback></mc:AlternateContent>`;
  const body = `<w:tbl xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:list-history" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:tblPr>${history === "tblPrChange" ? wrapped : ""}</w:tblPr><w:tblGrid><w:gridCol w:w="1440"/>${history === "tblGridChange" ? wrapped : ""}</w:tblGrid><w:tr><w:trPr>${history === "ins" || history === "trPrChange" ? wrapped : ""}</w:trPr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1440"/>${["tcPrChange", "cellIns", "cellDel", "cellMerge"].includes(history) ? wrapped : ""}</w:tcPr><w:p><w:pPr><w:keepNext/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:rPr><w:i/><w:rtl/></w:rPr><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Outside retained</w:t></w:r></w:p>`;
  const levels = [0, 1].map(level => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${level + 1}."/></w:lvl>`).join("");
  const input = await textFixture(body, { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="2">${levels}</w:abstractNum><w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num></w:numbering>` } }, strict);
  expect((await api.validateDocument(input, textContext)).valid).toBe(true);
  const document = await api.Document(input, textContext), before = document.part.blob;
  expect(document.tables[0]!.cell(0, 0).text).toBe("Retain 日本 עברית é 🌊");
  expect(document.part.blob).toEqual(before);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "Original destination" });
  const operation = action.endsWith("add") ? "lists.add" : "lists.set";
  const selection = action === "cell-add" ? { table: 1, cell: "A1" } : { table: 1, cell: "A1", paragraph: 1 };
  const request = action === "cell-add" || action === "paragraph-add" ? { operation: "lists.add" as const, options: { ...selection, kind: "decimal" as const, text: "New item", start: 5, output: "-" } } : { operation: "lists.set" as const, options: { ...selection, ...(action === "restart" ? { restart: true, start: 5 } : { level: 1 }), output: "-" } };
  if (route === "sdk") {
    await expect(api.editDocumentLists(input, request, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(memory.readFileSync("/out").toString()).toBe("Original destination");
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const flags = action.endsWith("add") ? "--kind decimal --text 'New item' --start 5" : action === "restart" ? "--restart true --start 5" : "--level 1";
      const result = await shell.exec(`docx ${operation.split(".").join(" ")} /input --table 1 --cell A1 ${action === "cell-add" ? "" : "--paragraph 1"} ${flags} --output /out --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, locations: [], errors: [{ code: "unsupported-edit" }] });
      expect(await fs.readFile("/out")).toEqual(new TextEncoder().encode("Original destination")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
  expect(readPackage(input).get("word/document.xml")).toEqual(before);
});
