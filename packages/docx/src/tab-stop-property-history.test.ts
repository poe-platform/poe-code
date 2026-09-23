import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const encode = (text: string) => new TextEncoder().encode(text);

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const history of ["opaque", "inert", "supported", "table"] as const)
for (const member of ["position", "alignment", "leader"] as const)
for (const route of ["model", "sdk", "cli"] as const)
it(`tab stop respects owned property history; ${route}; ${member}; ${history}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const wrap = (content: string) => carrier === "direct" ? content : carrier === "process" ? `<f:pass>${content}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? content : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? content : ""}</mc:Fallback></mc:AlternateContent>`;
  const marker = '<w:pPrChange w:id="7" w:author="Original reviewer"><w:pPr><w:tabs><w:tab w:pos="360" w:val="left"/></w:tabs></w:pPr></w:pPrChange>';
  const retainedHistory = history === "supported" ? wrap('<w:pPrChange w:id="7" w:author="Original reviewer"><w:pPr/></w:pPrChange>') : history === "inert" ? `<f:ignored>${wrap(marker)}</f:ignored>` : history === "opaque" ? wrap(marker) : "";
  const paragraph = `<w:p><w:pPr><w:keepNext/><w:tabs><!--retained tabs--><w:tab w:pos="720" w:val="center" w:leader="dot"/><w:tab w:pos="1800" w:val="center"/></w:tabs>${retainedHistory}</w:pPr><w:r><w:rPr><w:b/><w:rtl/></w:rPr><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>`;
  const tableHistory = wrap('<w:tblPrChange w:id="9" w:author="Original reviewer"><w:tblPr><w:tblW w:type="dxa" w:w="1440"/></w:tblPr></w:tblPrChange>');
  const body = history === "table" ? `<w:tbl><w:tblPr>${tableHistory}</w:tblPr><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:p/><w:p/></w:tc></w:tr></w:tbl>`.replace("<w:p/><w:p/>", paragraph) : paragraph;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<f:pass xmlns:f="urn:original:tab-history" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass">${body}</f:pass>`);
  const blocked = history === "opaque" || history === "table";
  const value = member === "position" ? { value: 2200, unit: "twip" as const } : member === "alignment" ? api.WD_TAB_ALIGNMENT.CENTER : api.WD_TAB_LEADER.DASHES;
  const operations = [
    ...(history === "table" ? [
      { operation: "model.document.Document.tables.get", receiver: ref("document"), arguments: {}, resultHandle: "tables" },
      { operation: "model.table.Table.cell.call", receiver: ref("tables", 0), arguments: { rowIdx: 0, colIdx: 0 }, resultHandle: "cell" },
      { operation: "model.table._Cell.paragraphs.get", receiver: ref("cell"), arguments: {}, resultHandle: "paragraphs" }
    ] : [{ operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" }]),
    { operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "format" },
    { operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: ref("format"), arguments: {}, resultHandle: "stops" },
    { operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: ref("stops"), arguments: { index: 0 }, resultHandle: "stop" },
    { operation: `model.text.tabstops.TabStop.${member}.set`, receiver: ref("stop"), arguments: { value } }
  ];
  const memory = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, textContext), target = history === "table" ? doc.tables[0]!.cell(0, 0).paragraphs[0]! : doc.paragraphs[0]!, stop = target.paragraph_format.tab_stops.at(0), before = doc.part.blob;
    const change = () => { if (member === "position") stop.position = { value: 2200, unit: "twip" }; else if (member === "alignment") stop.alignment = api.WD_TAB_ALIGNMENT.CENTER; else stop.leader = api.WD_TAB_LEADER.DASHES; };
    if (blocked) {
      expect(change).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
      expect(doc.part.blob).toEqual(before);
      expect(stop.position.twips).toBe(720); expect(stop.alignment.name).toBe("CENTER"); expect(stop.leader.name).toBe("DOTS");
    } else change();
    await doc.save(sink);
  } else if (route === "sdk") {
    const result = api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    if (blocked) { await expect(result).rejects.toMatchObject({ code: "unsupported-edit" }); expect(memory.readFileSync("/out").length).toBe(0); return; }
    await (await result).save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(blocked ? 1 : 0);
      expect(await fs.readFile("/input")).toEqual(input);
      if (blocked) { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, data: null, locations: [], errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/out")).toEqual(encode("Original destination")); return; }
      memory.writeFileSync("/out", await fs.readFile("/out"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  for (const [name, bytes] of before) if (blocked || name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, textContext), target = history === "table" ? doc.tables[0]!.cell(0, 0).paragraphs[0]! : doc.paragraphs[0]!, stops = [...target.paragraph_format.tab_stops];
  expect(stops.map(stop => [stop.position.twips, stop.alignment.name, stop.leader.name])).toEqual(!blocked && member === "position" ? [[1800, "CENTER", "SPACES"], [2200, "CENTER", "DOTS"]] : [[720, "CENTER", !blocked && member === "leader" ? "DASHES" : "DOTS"], [1800, "CENTER", "SPACES"]]);
  expect(target.text).toBe("Retain é 日本 עברית 🌊"); expect(target.paragraph_format.keep_with_next).toBe(true); expect(target.runs[0]!.bold).toBe(true); expect(target.runs[0]!.font.rtl).toBe(true);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml).toContain(retainedHistory); if (blocked && history === "table") expect(xml).toContain(tableHistory); expect(xml.split("<!--retained tabs-->")).toHaveLength(2);
});
