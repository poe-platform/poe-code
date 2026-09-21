import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["document", "template"] as const)
for (const revision of ["tblPrChange", "tblGridChange", "trPrChange", "tcPrChange", "cellIns", "cellDel", "cellMerge"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const view of ["final", "original", "all"] as const) for (const route of ["sdk", "cli"] as const)
it(`${route} refuses preserving replacement of native ${revision} table property history; ${carrier} ${view} ${kind} strict=${strict}`, async () => {
  const snapshot = revision === "tblPrChange" ? '<w:tblPr><w:tblW w:type="dxa" w:w="1440"/></w:tblPr>' : revision === "tblGridChange" ? '<w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid>' : revision === "trPrChange" ? '<w:trPr><w:cantSplit/></w:trPr>' : revision === "tcPrChange" ? '<w:tcPr><w:tcW w:type="dxa" w:w="1440"/></w:tcPr>' : "";
  const marker = `<w:${revision} w:id="7" w:author="Original reviewer" w:date="2026-01-02T03:04:06Z"${revision === "cellMerge" ? ' w:vMerge="rest" w:vMergeOrig="cont"' : ""}>${snapshot}</w:${revision}>`;
  const wrap = (active: string) => carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : ""}</mc:Fallback></mc:AlternateContent>`;
  const outside = "<w:p><w:r><w:t>Outside retained</w:t></w:r></w:p>";
  const history = wrap(marker);
  const body = `<w:tbl><w:tblPr>${revision === "tblPrChange" ? history : ""}</w:tblPr><w:tblGrid><w:gridCol w:w="1440"/>${revision === "tblGridChange" ? history : ""}</w:tblGrid><w:tr><w:trPr>${revision === "trPrChange" ? history : ""}</w:trPr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1440"/>${!["tblPrChange", "tblGridChange", "trPrChange"].includes(revision) ? history : ""}</w:tcPr><w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Row é 日本 עברית 🌊</w:t></w:r></w:p></w:tc></w:tr></w:tbl>${outside}`;
  const parts = readPackage(await textFixture(body, {}, strict));
  const main = parts.get("word/document.xml")!;
  parts.set("word/document.xml", new TextEncoder().encode(new TextDecoder().decode(main).replace("<w:document ", '<w:document xmlns:f="urn:original:row-carrier" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass" ')));
  if (kind === "template") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "Original destination" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  expect((await api.validateDocument(input, textContext)).valid).toBe(true);
  const native = await api.Document(input, textContext), originalPart = native.part.blob;
  expect(native.tables[0]!.cell(0, 0).text).toBe("Row é 日本 עברית 🌊");
  expect(native.part.blob).toEqual(originalPart);
  expect((await api.extractDocumentText(input, textContext, { view })).text).toBe("Row é 日本 עברית 🌊\nOutside retained");
  if (route === "sdk") {
    await expect(api.replaceDocumentText(input, { find: "é 日本 עברית 🌊", with: "Replacement", all: true, view, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(memory.readFileSync("/output", "utf8")).toBe("Original destination");
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx text replace /input --find 'é 日本 עברית 🌊' --with Replacement --all --view ${view} --output /out --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(false); expect(envelope.errors[0].code).toBe("unsupported-edit"); expect(envelope.data).toBeNull(); expect(envelope.affected).toBe(0); expect(envelope.locations).toEqual([]);
      expect(await fs.readFile("/out")).toEqual(new TextEncoder().encode("Original destination")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
