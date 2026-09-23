import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { readPackage } from "../tests/assertions.js";
import { Document, DocumentBudget, Twips, WD_TABLE_ALIGNMENT, WD_TABLE_DIRECTION, WD_CELL_VERTICAL_ALIGNMENT, WD_ROW_HEIGHT_RULE, applyStyleModelBatch, createDocxInspectionCommandEngine, executeDocumentBatch, writeArchive, inspectDocumentTables, readArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const alternate = (source: string, fallback = "", requires = "w") => `<mc:AlternateContent><mc:Choice Requires="${requires}">${source}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
const fixtures = ["direct control", "selected properties", "fallback properties", "selected containers", "inherited ProcessContent", "ancestor ProcessContent"] as const;

async function inputFor(fixture: typeof fixtures[number], strict: boolean) {
    const property = (kind: string, source: string) => {
      if (fixture === "selected containers") return alternate(`<w:${kind}>${source}</w:${kind}>`);
      const contents = fixture === "selected properties" ? alternate(source) : fixture === "fallback properties" ? alternate("", source, "f") : fixture.includes("ProcessContent") ? `<f:pass>${source}</f:pass>` : source;
      return `<w:${kind}>${contents}</w:${kind}>`;
    };
    const attrs = `xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"`;
    const table = `<w:tbl ${fixture === "ancestor ProcessContent" ? "" : attrs}>${property("tblPr", '<w:jc w:val="center"/><w:tblLayout w:type="fixed"/><w:bidiVisual/>')}<w:tblGrid>${'<w:gridCol w:w="720"/>'.repeat(4)}</w:tblGrid><w:tr>${property("trPr", '<w:gridBefore w:val="1"/><w:gridAfter w:val="1"/><w:trHeight w:val="360" w:hRule="exact"/>')}<w:tc>${property("tcPr", '<w:tcW w:type="dxa" w:w="1440"/><w:gridSpan w:val="2"/><w:vAlign w:val="center"/>')}<w:p><w:r><w:t>Original cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    return textFixture(fixture === "ancestor ProcessContent" ? `<f:pass ${attrs}>${table}</f:pass>` : table, {}, strict);
}

for (const strict of [false, true]) for (const route of ["model", "batch", "inventory"] as const) it.each(fixtures)(
  `${strict ? "Strict" : "Transitional"} ${route} reads table %s without rewriting stored properties`,
  async fixture => {
    const input = await inputFor(fixture, strict);
    if (route === "model") {
      const doc = await Document(input, textContext), table = doc.tables[0]!, row = table.rows.at(0), cell = table.cell(0, 1);
      expect({ alignment: table.alignment?.name, autofit: table.autofit, direction: table.table_direction?.name, before: row.grid_cols_before, after: row.grid_cols_after, height: row.height?.twips, rule: row.height_rule?.name, span: cell.grid_span, width: cell.width?.twips, vertical: cell.vertical_alignment?.name }).toEqual({ alignment: "CENTER", autofit: false, direction: "RTL", before: 1, after: 1, height: 360, rule: "EXACTLY", span: 2, width: 1440, vertical: "CENTER" });
      expect(table.columns.length).toBe(4);
      expect(row.cells).toHaveLength(2);
      expect(table.cell(0, 2)).toBe(cell);
      const volume = Volume.fromJSON({ "/out": "" });
      await doc.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
      const saved = new Uint8Array(volume.readFileSync("/out") as Buffer), before = await readArchive(input, textContext), after = await readArchive(saved, textContext);
      expect(after.members.map(member => [member.name, member.bytes])).toEqual(before.members.map(member => [member.name, member.bytes]));
      expect((await Document(saved, textContext)).tables[0]!.cell(0, 1).text).toBe("Original cell");
    } else {
      const batch = { version: 1, operations: [
        { operation: "model.document.Document.tables.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "tables" },
        { operation: "model.table.Table.cell.call", receiver: { resultHandle: "tables", index: 0 }, arguments: { rowIdx: 0, colIdx: 1 }, resultHandle: "cell" },
        { operation: "model.table.Table.alignment.get", receiver: { resultHandle: "tables", index: 0 }, arguments: {} },
        { operation: "model.table._Cell.vertical_alignment.get", receiver: { resultHandle: "cell" }, arguments: {} },
        { operation: "model.table._Cell.grid_span.get", receiver: { resultHandle: "cell" }, arguments: {} }
      ] };
      const expected = [{ enum: "WD_TABLE_ALIGNMENT", name: "CENTER" }, { enum: "WD_CELL_VERTICAL_ALIGNMENT", name: "CENTER" }, 2];
      const details = { rows: 1, columns: 4, cells: [{ row: 1, column: 2, rowSpan: 1, columnSpan: 2, text: "Original cell" }], omitted: [{ row: 1, before: 1, after: 1 }] };
      if (route === "batch") {
        const sdk = await applyStyleModelBatch(input, batch, textContext);
        expect(sdk.affected).toBe(0);
        expect(sdk.results.slice(2).map(result => result.value)).toEqual(expected);
      } else expect((await inspectDocumentTables(input, {}, textContext)).items[0]?.details).toMatchObject(details);
      const volume = Volume.fromJSON({ "/out": "", "/err": "", "/input.docx": Buffer.from(input) });
      const args = route === "batch" ? ["batch", "/input.docx", "--ops-json", JSON.stringify(batch), "--json"] : ["tables", "list", "/input.docx", "--json"];
      const cli = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: args.map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(cli.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
      const envelope = JSON.parse(volume.readFileSync("/out", "utf8") as string);
      expect(envelope.affected).toBe(0);
      if (route === "batch") expect(envelope.data.results.slice(2).map((result: { data: unknown }) => result.data)).toEqual(expected);
      else expect(envelope.data.items[0].details).toMatchObject(details);
      expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
    }
  }
);

for (const strict of [false, true]) it(`reads a selected ${strict ? "Strict" : "Transitional"} table style reference`, async () => {
  const input = await textFixture(`<w:tbl xmlns:mc="${mc}"><w:tblPr>${alternate('<w:tblStyle w:val="Original"/>')}</w:tblPr><w:tblGrid><w:gridCol w:w="720"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>`, {
    styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="table" w:styleId="Original"><w:name w:val="Original"/></w:style></w:styles>` }
  }, strict);
  const doc = await Document(input, textContext);
  expect(doc.tables[0]!.style?.style_id).toBe("Original");
});

it("keeps repeated logical table grid and property reads bounded and cancellable", async () => {
  const markup = '<w:tbl><w:tblPr><w:jc w:val="center"/></w:tblPr><w:tblGrid><w:gridCol w:w="720"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Original</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const input = await textFixture(markup.repeat(40)), controller = new AbortController();
  const budget = new DocumentBudget({ retainedBytes: 4 * 1024 * 1024 }, controller.signal);
  const doc = await Document(input, { ...textContext, signal: controller.signal, budget });
  expect(doc.tables.map(table => [table.cell(0, 0).text, table.alignment?.name])).toEqual(Array.from({ length: 40 }, () => ["Original", "CENTER"]));
  const table = doc.tables[0]!, before = budget.usage;
  for (let i = 0; i < 100; i++) {
    expect(table.rows.length).toBe(1);
    expect(table.columns.length).toBe(1);
    expect(table.alignment?.name).toBe("CENTER");
  }
  expect(budget.usage.retainedBytes).toBe(before.retainedBytes);
  expect(budget.usage.work).toBeGreaterThan(before.work);
  controller.abort();
  expect(() => table.rows.length).toThrow("cancelled");
});

for (const strict of [false, true]) it(`reads selected columns of an empty ${strict ? "Strict" : "Transitional"} table`, async () => {
  const input = await textFixture(`<w:tbl xmlns:mc="${mc}">${alternate('<w:tblGrid><w:gridCol w:w="720"/><w:gridCol w:w="1440"/></w:tblGrid>')}</w:tbl>`, {}, strict);
  const table = (await Document(input, textContext)).tables[0]!;
  expect(table.rows.length).toBe(0);
  expect(table.columns.length).toBe(2);
  expect(table.columns.at(1).width?.twips).toBe(1440);
});

for (const strict of [false, true]) it.each(fixtures.filter(fixture => fixture !== "direct control"))(
  `supports active table properties and resets in ${strict ? "Strict" : "Transitional"} %s`,
  async fixture => {
    const input = await inputFor(fixture, strict);
    const actions = ["alignment", "alignment reset", "autofit", "direction", "vertical", "vertical reset", "width", "width reset", "height", "height reset", "height rule", "height rule reset"];
    const outcomes = [];
    for (const action of actions) {
      const doc = await Document(input, textContext), table = doc.tables[0]!, row = table.rows.at(0), cell = table.cell(0, 1), before = doc.element.serialize();
      let code = "no error";
      try {
        if (action === "alignment") table.alignment = WD_TABLE_ALIGNMENT.LEFT;
        if (action === "alignment reset") table.alignment = null;
        if (action === "autofit") table.autofit = true;
        if (action === "direction") table.table_direction = WD_TABLE_DIRECTION.LTR;
        if (action === "vertical") cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.TOP;
        if (action === "vertical reset") cell.vertical_alignment = null;
        if (action === "width") cell.width = Twips(720);
        if (action === "width reset") cell.width = null;
        if (action === "height") row.height = Twips(240);
        if (action === "height reset") row.height = null;
        if (action === "height rule") row.height_rule = WD_ROW_HEIGHT_RULE.AUTO;
        if (action === "height rule reset") row.height_rule = null;
      } catch (error) { code = error instanceof Error && "code" in error ? String(error.code) : String(error); }
      if (action === "height reset" || action === "height rule reset") {
        const attribute = action === "height reset" ? 'w:val="360"' : 'w:hRule="exact"';
        expect(new TextDecoder().decode(doc.element.serialize())).toBe(new TextDecoder().decode(before).replace(attribute, ""));
        expect(row.height?.twips ?? null).toBe(action === "height reset" ? null : 360);
        expect(row.height_rule?.name).toBe(action === "height reset" ? "EXACTLY" : "AT_LEAST");
      }
      outcomes.push({ action, code, retained: Buffer.from(doc.element.serialize()).equals(Buffer.from(before)) });
    }
    expect(outcomes).toEqual(actions.map(action => ({action, code: "no error", retained: false})));
  }
);

it("refreshes cached table grids after ordinary edits and isolates document owners", async () => {
  const input = await inputFor("direct control", false), doc = await Document(input, textContext), other = await Document(input, textContext);
  const table = doc.tables[0]!, cell = table.cell(0, 1), column = table.columns.at(0);
  expect(table.rows.length).toBe(1);
  table.add_row();
  expect(table.rows.length).toBe(2);
  expect(cell.text).toBe("Original cell");
  expect(other.tables[0]!.rows.length).toBe(1);
  column.width = Twips(1440);
  expect(table.columns.at(0).width?.twips).toBe(1440);
  expect(other.tables[0]!.columns.at(0).width?.twips).toBe(720);
});

const nativeEdits = [
  {owner: "table", property: "alignment", value: WD_TABLE_ALIGNMENT.LEFT, tag: "jc", expected: "LEFT"},
  {owner: "table", property: "alignment", value: null, tag: "jc", expected: null},
  {owner: "table", property: "autofit", value: true, tag: "tblLayout", expected: true},
  {owner: "table", property: "table_direction", value: WD_TABLE_DIRECTION.LTR, tag: "bidiVisual", expected: "LTR"},
  {owner: "cell", property: "vertical_alignment", value: WD_CELL_VERTICAL_ALIGNMENT.TOP, tag: "vAlign", expected: "TOP"},
  {owner: "cell", property: "vertical_alignment", value: null, tag: "vAlign", expected: null},
  {owner: "cell", property: "width", value: Twips(720), tag: "tcW", expected: 720},
  {owner: "cell", property: "width", value: null, tag: "tcW", expected: null},
  {owner: "row", property: "height", value: Twips(240), tag: "trHeight", expected: 240},
  {owner: "row", property: "height", value: null, tag: "trHeight", expected: null},
  {owner: "row", property: "height_rule", value: WD_ROW_HEIGHT_RULE.AUTO, tag: "trHeight", expected: "AUTO"},
  {owner: "row", property: "height_rule", value: null, tag: "trHeight", expected: "AT_LEAST"}
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["utf8", "utf16be"] as const) for (const fixture of fixtures)
for (const route of ["model", "sdk", "shell"] as const) it.each(nativeEdits)(
  `${route} saves native $owner $property=$expected with carrier retention; ${fixture} ${encoding} ${kind} strict=${strict}`,
  async edit => {
    const enc = (text: string) => new TextEncoder().encode(text), parts = readPackage(await inputFor(fixture, strict));
    const originalXml = new TextDecoder().decode(parts.get("word/document.xml"));
    if (encoding === "utf16be") parts.set("word/document.xml", new Uint8Array(Buffer.from("\ufeff" + originalXml, "utf16le").swap16()));
    if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
    const volume = Volume.fromJSON({"/input": "", "/output": ""});
    await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {volume.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
    const input = new Uint8Array(volume.readFileSync("/input") as Buffer), sink = {async write(bytes: Uint8Array) {volume.appendFileSync("/output", bytes);}};
    const ref = (resultHandle: string, index?: number) => ({resultHandle, ...(index === undefined ? {} : {index})});
    const batch = {version: 1, operations: [
      {operation: "model.document.Document.tables.get", receiver: ref("document"), arguments: {}, resultHandle: "tables"},
      {operation: "model.table.Table.rows.get", receiver: ref("tables", 0), arguments: {}, resultHandle: "rows"},
      {operation: "model.table._Rows.__getitem__.get", receiver: ref("rows"), arguments: {index: 0}, resultHandle: "row"},
      {operation: "model.table.Table.cell.call", receiver: ref("tables", 0), arguments: {rowIdx: 0, colIdx: 1}, resultHandle: "cell"},
      {operation: `model.table.${edit.owner === "table" ? "Table" : edit.owner === "cell" ? "_Cell" : "_Row"}.${edit.property}.set`, receiver: edit.owner === "table" ? ref("tables", 0) : ref(edit.owner), arguments: {value: edit.value !== null && (edit.property === "width" || edit.property === "height") ? {value: edit.expected, unit: "twip"} : edit.value}}
    ]};
    if (route === "model") {
      const doc = await Document(input, textContext), table = doc.tables[0]!;
      Reflect.set(edit.owner === "table" ? table : edit.owner === "cell" ? table.cell(0, 1) : table.rows.at(0), edit.property, edit.value);
      await doc.save(sink);
    } else if (route === "sdk") {
      const result = await executeDocumentBatch(input, batch, {output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
      expect(result.results.at(-1)?.affected).toBe(1); expect(result.publication?.changed).toBe(true);
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify(batch)));
      const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx batch /input --ops-file /ops --output - > /output");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); volume.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    }
    const output = new Uint8Array(volume.readFileSync("/output") as Buffer), saved = readPackage(output);
    for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name)).toEqual(bytes);
    const actualXml = new TextDecoder(encoding === "utf16be" ? "utf-16be" : "utf-8").decode(saved.get("word/document.xml"));
    const erased = edit.value === null && !["height", "height_rule"].includes(edit.property);
    const mask = (source: string, removed: boolean) => {
      if (removed) return source;
      const start = source.indexOf(`<w:${edit.tag}`); expect(start).toBeGreaterThanOrEqual(0);
      const openEnd = source.indexOf(">", start), end = source[openEnd - 1] === "/" ? openEnd + 1 : source.indexOf(`</w:${edit.tag}>`, openEnd) + edit.tag.length + 5;
      expect(end).toBeGreaterThan(start); return source.slice(0, start) + source.slice(end);
    };
    expect(mask(actualXml, erased)).toBe(mask(originalXml, false));
    if (encoding === "utf16be") expect(saved.get("word/document.xml")!.slice(0, 2)).toEqual(Uint8Array.of(254, 255));
    const table = (await Document(output, textContext)).tables[0]!, row = table.rows.at(0), cell = table.cell(0, 1);
    const state = {alignment: table.alignment?.name ?? null, autofit: table.autofit, table_direction: table.table_direction?.name ?? null, vertical_alignment: cell.vertical_alignment?.name ?? null, width: cell.width?.twips ?? null, height: row.height?.twips ?? null, height_rule: row.height_rule?.name ?? null};
    expect(state).toEqual({alignment: "CENTER", autofit: false, table_direction: "RTL", vertical_alignment: "CENTER", width: 1440, height: 360, height_rule: "EXACTLY", [edit.property]: edit.expected});
    expect([row.grid_cols_before, row.grid_cols_after, cell.grid_span, table.columns.length]).toEqual([1, 1, 2, 4]);
    expect(row.cells.map(item => item.text)).toEqual(["Original cell", "Original cell"]); expect(table.cell(0, 2)).toBe(cell);
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  }
);

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const) for (const attribute of ["height", "height_rule"] as const)
it.each(fixtures.filter(fixture => fixture !== "direct control"))(
  `${route} saves the ${attribute} native reset with exact unrelated retention; ${kind} strict=${strict} carrier=%s`,
  async fixture => {
    const enc = (text: string) => new TextEncoder().encode(text);
    const parts = readPackage(await inputFor(fixture, strict));
    if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
    const volume = Volume.fromJSON({ "/input": "", "/output": "" });
    await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
    const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
    const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
    const batch = { version: 1, operations: [
      { operation: "model.document.Document.tables.get", receiver: ref("document"), arguments: {}, resultHandle: "tables" },
      { operation: "model.table.Table.rows.get", receiver: ref("tables", 0), arguments: {}, resultHandle: "rows" },
      { operation: "model.table._Rows.__getitem__.get", receiver: ref("rows"), arguments: { index: 0 }, resultHandle: "row" },
      { operation: `model.table._Row.${attribute}.set`, receiver: ref("row"), arguments: { value: null } }
    ] };
    const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/output", bytes); } };
    if (route === "model") {
      const model = await Document(input, textContext); model.tables[0]!.rows.at(0)[attribute] = null; await model.save(sink);
    } else if (route === "sdk") {
      const result = await executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
      expect(result.results.at(-1)?.affected).toBe(1); expect(result.publication?.changed).toBe(true);
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify(batch)));
      const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec("docx batch /input --ops-file /ops --output - > /output");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); volume.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    }
    const output = new Uint8Array(volume.readFileSync("/output") as Buffer), after = readPackage(output);
    for (const [name, bytes] of parts) expect(after.get(name)).toEqual(name === "word/document.xml" ? enc(new TextDecoder().decode(bytes).replace(attribute === "height" ? 'w:val="360"' : 'w:hRule="exact"', "")) : bytes);
    const row = (await Document(output, textContext)).tables[0]!.rows.at(0);
    expect(row.height?.twips ?? null).toBe(attribute === "height" ? null : 360);
    expect(row.height_rule?.name).toBe(attribute === "height" ? "EXACTLY" : "AT_LEAST");
    expect(row.cells.map(cell => cell.text)).toEqual(["Original cell", "Original cell"]);
  }
);

for (const strict of [false, true]) for (const route of ["model", "sdk", "cli"] as const) it(`saves an ordinary ${strict ? "Strict" : "Transitional"} table edit through ${route} beside preserved properties`, async () => {
  const row = '<w:tblGrid><w:gridCol w:w="720"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Original</w:t></w:r></w:p></w:tc></w:tr>';
  const retained = `<w:tbl xmlns:mc="${mc}"><w:tblPr>${alternate('<w:jc w:val="center"/>')}</w:tblPr>${row}</w:tbl>`;
  const input = await textFixture(`<w:tbl><w:tblPr><w:jc w:val="center"/></w:tblPr>${row}</w:tbl>${retained}`, {}, strict);
  const volume = Volume.fromJSON({ "/out": "", "/err": "" });
  const batch = { version: 1, operations: [
    { operation: "model.document.Document.tables.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "tables" },
    { operation: "model.table.Table.alignment.set", receiver: { resultHandle: "tables", index: 0 }, arguments: { value: WD_TABLE_ALIGNMENT.RIGHT } }
  ] };
  if (route === "model") {
    const doc = await Document(input, textContext);
    doc.tables[0]!.alignment = WD_TABLE_ALIGNMENT.RIGHT;
    await doc.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  } else if (route === "sdk") {
    const sdk = await applyStyleModelBatch(input, batch, textContext);
    expect(sdk.affected).toBe(1);
    await sdk.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  } else {
    const cli = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: ["batch", "/input.docx", "--ops-json", JSON.stringify(batch), "--output", "-"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
    });
    expect(cli.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), reopened = await Document(output, textContext);
  expect(reopened.tables.map(table => table.alignment?.name)).toEqual(["RIGHT", "CENTER"]);
  const before = await readArchive(input, textContext), after = await readArchive(output, textContext);
  for (const member of before.members) {
    const next = after.members.find(item => item.name === member.name)!;
    if (member.name === "word/document.xml") expect(new TextDecoder().decode(next.bytes)).toContain(retained);
    else expect(next.bytes).toEqual(member.bytes);
  }
});

for (const strict of [false, true]) for (const route of ["sdk", "cli"] as const) it(`saves active ${strict ? "Strict" : "Transitional"} table resets through ${route} with exact retention`, async () => {
  const input = await inputFor("selected containers", strict), volume = Volume.fromJSON({ "/out": "", "/err": "" });
  const batch = { version: 1, operations: [
    { operation: "model.document.Document.tables.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "tables" },
    { operation: "model.table.Table.alignment.set", receiver: { resultHandle: "tables", index: 0 }, arguments: { value: null } }
  ] };
  if (route === "sdk") {const result = await applyStyleModelBatch(input, batch, textContext); expect(result.affected).toBe(1); await result.save({async write(bytes) {volume.appendFileSync("/out", bytes);}});}
  else {
    const cli = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: ["batch", "/input.docx", "--ops-json", JSON.stringify(batch), "--output", "-"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
    });
    expect(cli.exitCode).toBe(0);
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  for (const [name, bytes] of before) expect(after.get(name)).toEqual(name === "word/document.xml" ? new TextEncoder().encode(new TextDecoder().decode(bytes).replace('<w:jc w:val="center"/>', "")) : bytes);
  expect((await Document(output, textContext)).tables[0]!.alignment).toBeNull();
});
