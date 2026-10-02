import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["document", "template"] as const)
for (const revision of ["ins", "del", "tblPrChange", "tblGridChange", "trPrChange", "tcPrChange", "cellIns", "cellDel", "cellMerge"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const mode of ["outside", "inactive", "foreign"] as const) for (const route of ["model", "sdk", "cli"] as const)
it(`${route} permits legitimate ${mode} edits beside ${revision} table history; ${carrier} ${kind} strict=${strict}`, async () => {
  const snapshot = revision === "tblPrChange" ? '<w:tblPr><w:tblW w:type="dxa" w:w="1440"/></w:tblPr>' : revision === "tblGridChange" ? '<w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid>' : revision === "trPrChange" ? '<w:trPr><w:cantSplit/></w:trPr>' : revision === "tcPrChange" ? '<w:tcPr><w:tcW w:type="dxa" w:w="1440"/></w:tcPr>' : "";
  const marker = `<w:${revision} w:id="7" w:author="Original reviewer" w:date="2026-01-02T03:04:06Z"${revision === "cellMerge" ? ' w:vMerge="rest" w:vMergeOrig="cont"' : ""}>${snapshot}</w:${revision}>`;
  const wrap = (active: string) => carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : ""}</mc:Fallback></mc:AlternateContent>`;
  const outside = "<w:p><w:r><w:t>Outside retained</w:t></w:r></w:p>";
  const admitted = mode === "foreign" ? marker.replace(`<w:${revision}`, `<f:${revision}`).replace(`</w:${revision}>`, `</f:${revision}>`) : mode === "inactive" ? `<mc:AlternateContent><mc:Choice Requires="w"/><mc:Fallback>${marker}</mc:Fallback></mc:AlternateContent>` : marker;
  const history = wrap(admitted);
  const body = `<w:tbl><w:tblPr>${revision === "tblPrChange" ? history : ""}</w:tblPr><w:tblGrid><w:gridCol w:w="1440"/>${revision === "tblGridChange" ? history : ""}</w:tblGrid><w:tr><w:trPr>${["ins", "del", "trPrChange"].includes(revision) ? history : ""}</w:trPr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1440"/>${!["ins", "del", "tblPrChange", "tblGridChange", "trPrChange"].includes(revision) ? history : ""}</w:tcPr><w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Row é 日本 עברית 🌊</w:t></w:r></w:p></w:tc></w:tr></w:tbl>${outside}`;
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
  const find = mode === "outside" ? "Outside retained" : "é 日本 עברית 🌊";
  const expected = mode === "outside" ? "Replacement" : "Row Replacement";
  memory.writeFileSync("/output", "");
  let output: Uint8Array;
  if (route === "model") {
    const paragraph = mode === "outside" ? native.paragraphs[0]! : native.tables[0]!.cell(0, 0).paragraphs[0]!;
    paragraph.runs[0]!.text = expected;
    await native.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
    output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  } else if (route === "sdk") {
    await api.replaceDocumentText(input, { find, with: "Replacement", all: true, view: "all", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx text replace /input --find '${find}' --with Replacement --all --view all --output /out --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(true); expect(envelope.errors).toEqual([]); expect(envelope.affected).toBe(1);
      output = await fs.readFile("/out"); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const saved = readPackage(output), old = readPackage(input);
  expect([...saved.keys()]).toEqual([...old.keys()]);
  for (const [name, bytes] of old) if (name !== "word/document.xml") expect(saved.get(name)).toEqual(bytes);
  expect(new TextDecoder().decode(saved.get("word/document.xml"))).toContain(history);
  const reopened = await api.Document(output, textContext);
  const target = mode === "outside" ? reopened.paragraphs[0]! : reopened.tables[0]!.cell(0, 0).paragraphs[0]!;
  expect(target.text).toBe(expected);
  expect(reopened.tables[0]!.cell(0, 0).text).toBe(mode === "outside" ? "Row é 日本 עברית 🌊" : "Row Replacement");
  if (mode !== "outside") { expect(target.runs[0]!.italic).toBe(true); expect(target.paragraph_format.keep_with_next).toBe(true); }
  expect((await api.validateDocument(output, textContext)).valid).toBe(true);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
