import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, DocumentBudget, Twips, createDocxInspectionCommandEngine, executeDocumentBatch, parseDocumentXml, readArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const enc = (text: string) => new TextEncoder().encode(text);
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const cell = (text: string, span = 1, merge = "") => `<w:tc><w:tcPr><w:tcW w:w="${span * 720}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}${merge ? `<w:vMerge w:val="${merge}"/>` : ""}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const layouts = ["horizontal", "vertical", "combined"] as const;
const carriers = ["direct", "grid-choice", "row-choice"] as const;
for (const strict of [false, true]) for (const route of ["model", "sdk", "cli"] as const)
for (const layout of layouts) it.each(carriers)(
  `F19-F20 append column preserves ${layout} aliases and original cells; ${route} strict=${strict} carrier=%s`,
  async carrier => {
    const horizontal = layout !== "vertical", vertical = layout !== "horizontal";
    const rows = [0, 1].map(row => `<w:tr>${horizontal ? cell(row && vertical ? "" : row ? "Second 海" : "Owner é", 2, vertical ? row ? "continue" : "restart" : "") : cell(row ? "" : "Owner é", 1, row ? "continue" : "restart") + cell(row ? "Second 海" : "Neighbor")}</w:tr>`);
    const grid = '<w:tblGrid><w:gridCol w:w="720"/><w:gridCol w:w="720"/></w:tblGrid>';
    const wrap = (xml: string) => `<mc:AlternateContent><mc:Choice Requires="w">${xml}</mc:Choice><mc:Fallback><f:retain stamp="untouched"/></mc:Fallback></mc:AlternateContent>`;
    const input = await textFixture(`<w:tbl xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f"><w:tblPr><!--keep--><?original keep?><w:tblW w:w="1440" w:type="dxa"/></w:tblPr>${carrier === "grid-choice" ? wrap(grid) : grid}${rows.map(row => carrier === "row-choice" ? wrap(row) : row).join("")}</w:tbl>`, {}, strict);
    const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
    const batch = { version: 1, operations: [
      { operation: "model.document.Document.tables.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "tables" },
      { operation: "model.table.Table.add_column.call", receiver: { resultHandle: "tables", index: 0 }, arguments: { width: { value: 360, unit: "twip" } }, resultHandle: "column" }
    ] };
    if (route === "model") {
      const doc = await Document(input, textContext), table = doc.tables[0]!, owner = table.cell(0, 0);
      const column = table.add_column(Twips(360)); expect(column.cells).toHaveLength(2); expect(column.width?.twips).toBe(360);
      expect(owner.text).toBe("Owner é"); expect(table.cell(0, 0)).toBe(owner);
      await doc.save(sink);
    } else if (route === "sdk") {
      const result = await executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
      expect(result.results[1]!.affected).toBe(1);
    } else {
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["batch", "/input", "--ops-json", JSON.stringify(batch), "--output", "-"].map(enc), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: sink,
        stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
    }
    const output = new Uint8Array(volume.readFileSync("/out") as Buffer), table = (await Document(output, textContext)).tables[0]!;
    expect(table.rows.length).toBe(2); expect(table.columns.length).toBe(3);
    for (const row of [0, 1]) { expect(table.cell(row, 2).text).toBe(""); expect(table.cell(row, 2).paragraphs).toHaveLength(1); expect(table.cell(row, 2).width?.twips).toBe(360); }
    if (horizontal) expect(table.cell(0, 0)).toBe(table.cell(0, 1));
    if (vertical) expect(table.cell(0, 0)).toBe(table.cell(1, 0));
    const before = await readArchive(input, textContext), after = await readArchive(output, textContext);
    for (const member of before.members) {
      const saved = after.members.find(item => item.name === member.name)!.bytes;
      if (member.name !== "word/document.xml") expect(saved).toEqual(member.bytes);
      else {
        const originalXml = new TextDecoder().decode(member.bytes), savedXml = new TextDecoder().decode(saved);
        for (const row of rows) {
          const source = strict ? row.split("http://schemas.openxmlformats.org/wordprocessingml/2006/main").join("http://purl.oclc.org/ooxml/wordprocessingml/main") : row;
          expect(savedXml).toContain(source.slice(0, -"</w:tr>".length));
        }
        expect(savedXml).toContain('<!--keep--><?original keep?>');
        if (carrier !== "direct") expect(savedXml.split('<f:retain stamp="untouched"/>').length).toBe(originalXml.split('<f:retain stamp="untouched"/>').length);
        const root = parseDocumentXml(saved).root; expect(root.namespace).toBe(parseDocumentXml(member.bytes).root.namespace);
      }
    }
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  }
);

it.each([{ tableColumns: 2 }, { tableCells: 4 }])("F19 column append preflights %j without changing any model bytes", async limits => {
  const input = await textFixture(`<w:tbl><w:tblGrid><w:gridCol w:w="720"/><w:gridCol w:w="720"/></w:tblGrid><w:tr>${cell("A")}${cell("B")}</w:tr><w:tr>${cell("C")}${cell("D")}</w:tr></w:tbl>`);
  const doc = await Document(input, { ...textContext, budget: new DocumentBudget(limits) }), before = doc.element.serialize();
  expect(() => doc.tables[0]!.add_column(Twips(360))).toThrow(expect.objectContaining({ code: "limit-exceeded" }));
  expect(doc.element.serialize()).toEqual(before);
});
