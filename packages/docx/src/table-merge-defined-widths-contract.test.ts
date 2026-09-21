import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, Twips, applyStyleModelBatch, createDocxInspectionCommandEngine, editDocumentTables } from "./index.js";
import { readPackage } from "../tests/assertions.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "process"] as const) for (const route of ["model", "sdk", "utility", "cli"] as const)
it(`${route} merge sums defined preferred cell widths with distinct grid widths; ${kind}; strict=${strict}; ${carrier}`, async () => {
  const wrap = (xml: string) => carrier === "direct" ? xml : `<f:pass>${xml}</f:pass>`;
  const cell = (width: number, text: string, wrapped = true) => `<w:tc><w:tcPr>${wrapped ? wrap(`<w:tcW w:w="${width}" w:type="dxa"/>`) : `<w:tcW w:w="${width}" w:type="dxa"/>`}<w:shd w:fill="E0F0D0"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const table = `<w:tbl xmlns:f="urn:original:preferred-width" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="1440"/></w:tblGrid><w:tr>${cell(1200, "Left é 日本 🌊")}${cell(2400, "Right עברית", false)}</w:tr></w:tbl>`;
  const input = await textFixture(table + '<w:sectPr/>', {}, strict, { kind });
  const parts = readPackage(input), memory = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "" });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
  const batch = { version: 1, operations: [
    { operation: "model.document.Document.tables.get", receiver: ref("document"), arguments: {}, resultHandle: "tables" },
    { operation: "model.table.Table.cell.call", receiver: ref("tables", 0), arguments: { rowIdx: 0, colIdx: 0 }, resultHandle: "left" },
    { operation: "model.table.Table.cell.call", receiver: ref("tables", 0), arguments: { rowIdx: 0, colIdx: 1 }, resultHandle: "right" },
    { operation: "model.table._Cell.merge.call", receiver: ref("left"), arguments: { otherCell: ref("right") }, resultHandle: "merged" },
    { operation: "model.table._Cell.width.get", receiver: ref("merged"), arguments: {} }
  ] };
  if (route === "model") {
    const document = await Document(input, textContext), owner = document.tables[0]!;
    expect(owner.cell(0, 0).width?.twips).toBe(1200); expect(owner.cell(0, 1).width?.twips).toBe(2400);
    expect(owner.cell(0, 0).merge(owner.cell(0, 1)).width?.twips).toBe(3600);
    await document.save(sink);
  } else if (route === "sdk") {
    const result = await applyStyleModelBatch(input, batch, textContext);
    expect(result.results.at(-1)!.value).toEqual({ value: 3600 * 635, unit: "emu" });
    await result.save(sink);
  } else if (route === "utility") {
    await editDocumentTables(input, { operation: "tables.merge", options: { table: 1, from: "A1", to: "B1", join: "paragraphs", output: "-" } }, { ...textContext, encoding: {order: "input", compression: "store"}, stdout: sink });
  } else {
    const filesystem = new MemoryFileSystem(); await filesystem.writeFile("/input", input);
    const shell = new Shell({ fs: filesystem }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx tables merge /input --table 1 --from A1 --to B1 --join paragraphs --output - > /out`);
      expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe("");
      memory.writeFileSync("/out", await filesystem.readFile("/out")); expect(await filesystem.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), after = readPackage(output);
  expect(after.size).toBe(parts.size);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const reopened = await Document(output, textContext), owner = reopened.tables[0]!;
  expect(owner.cell(0, 0).width?.twips).toBe(3600);
  owner.cell(0, 1).width = Twips(3601);
  expect(owner.cell(0, 0).width?.twips).toBe(3601);
  owner.cell(0, 0).width = Twips(3600);
  expect(owner.cell(0, 1).width?.twips).toBe(3600);
  expect(owner.cell(0, 0).text).toBe("Left é 日本 🌊\nRight עברית");
  expect(owner.cell(0, 0).paragraphs.map(p => p.runs[0]!.bold)).toEqual([true, true]);
  expect(owner.columns[0]!.width?.twips).toBe(1440); expect(owner.columns[1]!.width?.twips).toBe(1440);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "utility", "cli"] as const) for (const stamped of [false, true])
it(`${route} refuses merge that would delete an absorbed property carrier; ${kind}; strict=${strict}; stamped=${stamped}`, async () => {
  const cell = (width: number) => `<w:tc><w:tcPr><f:pass${stamped ? ' keep="original"' : ""}><w:tcW w:w="${width}" w:type="dxa"/></f:pass></w:tcPr><w:p><w:r><w:t>Preserved</w:t></w:r></w:p></w:tc>`;
  const input = await textFixture(`<w:tbl xmlns:f="urn:original:absorbed-property" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="1440"/></w:tblGrid><w:tr>${cell(1200)}${cell(2400)}</w:tr></w:tbl>`, {}, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "" });
  if (route === "model") {
    const document = await Document(input, textContext), table = document.tables[0]!;
    const before = table.element.serialize(), left = table.cell(0, 0), right = table.cell(0, 1);
    expect(() => left.merge(right)).toThrow("preservation");
    expect(table.element.serialize()).toEqual(before);
    expect(left.width?.twips).toBe(1200); expect(right.width?.twips).toBe(2400);
    expect(left.text).toBe("Preserved"); expect(right.text).toBe("Preserved");
    await document.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
    const parts = readPackage(input), after = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer));
    expect(after.size).toBe(parts.size); for (const [name, bytes] of parts) expect(after.get(name), name).toEqual(bytes);
  } else if (route === "sdk") {
    const ref = (resultHandle: string, index?: number) => ({resultHandle, ...(index === undefined ? {} : {index})});
    const batch = {version: 1, operations: [
      {operation: "model.document.Document.tables.get", receiver: ref("document"), arguments: {}, resultHandle: "tables"},
      {operation: "model.table.Table.cell.call", receiver: ref("tables", 0), arguments: {rowIdx: 0, colIdx: 0}, resultHandle: "left"},
      {operation: "model.table.Table.cell.call", receiver: ref("tables", 0), arguments: {rowIdx: 0, colIdx: 1}, resultHandle: "right"},
      {operation: "model.table._Cell.merge.call", receiver: ref("left"), arguments: {otherCell: ref("right")}}
    ]};
    await expect(applyStyleModelBatch(input, batch, textContext)).rejects.toMatchObject({code: "unsupported-edit"});
    expect(memory.readFileSync("/out")).toHaveLength(0);
  } else if (route === "utility") {
    await expect(editDocumentTables(input, { operation: "tables.merge", options: { table: 1, from: "A1", to: "B1", join: "paragraphs", output: "-" } }, { ...textContext, encoding: {order: "input", compression: "store"}, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(memory.readFileSync("/out")).toHaveLength(0);
  } else {
    const filesystem = new MemoryFileSystem(); await filesystem.writeFile("/input", input); await filesystem.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs: filesystem }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx tables merge /input --table 1 --from A1 --to B1 --join paragraphs --output /out --force --json");
      expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, errors: [{code: "unsupported-edit"}] });
      expect(new TextDecoder().decode(await filesystem.readFile("/out"))).toBe("Original destination");
      expect(await filesystem.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
