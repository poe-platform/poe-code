import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["document", "template"] as const)
for (const revision of ["ins", "del"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const route of ["sdk", "cli"] as const)
it(`${route} omits hidden native ${revision} table rows from logical text; ${carrier} ${revision === 'del' ? 'final' : 'original'} ${kind} strict=${strict}`, async () => {
  const view = revision === "del" ? "final" : "original";
  const marker = `<w:${revision} w:id="7" w:author="Original reviewer" w:date="2026-01-02T03:04:06Z"/>`;
  const wrap = (active: string) => carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : ""}</mc:Fallback></mc:AlternateContent>`;
  const outside = "<w:p><w:r><w:t>Outside retained</w:t></w:r></w:p>";
  const body = `<w:tbl><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:trPr>${wrap(marker)}</w:trPr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1440"/></w:tcPr><w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Row é 日本 עברית 🌊</w:t></w:r></w:p></w:tc></w:tr></w:tbl>${outside}`;
  const parts = readPackage(await textFixture(body, {}, strict));
  const main = parts.get("word/document.xml")!;
  parts.set("word/document.xml", new TextEncoder().encode(new TextDecoder().decode(main).replace("<w:document ", '<w:document xmlns:f="urn:original:row-carrier" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass" ')));
  if (kind === "template") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "Original destination" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), hidden = revision === "del" && view === "final" || revision === "ins" && view === "original";
  expect((await api.validateDocument(input, textContext)).valid).toBe(true);
  const document = await api.Document(input, textContext), originalMain = document.part.blob;
  expect(document.tables[0]!.cell(0, 0).text).toBe("Row é 日本 עברית 🌊");
  expect(document.part.blob).toEqual(originalMain);
  expect(hidden).toBe(true);
  if (route === "sdk") expect((await api.extractDocumentText(input, textContext, { view })).text).toBe("Outside retained");
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx text /input --view ${view} --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(true); expect(envelope.errors).toEqual([]); expect(envelope.affected).toBe(0);
      expect(envelope.data.text).toBe("Outside retained");
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
