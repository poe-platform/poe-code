import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { tablePropertyBoundaries } from "../tests/fixtures/table-property-public-boundaries.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const families: Record<string, keyof typeof api> = { alignment: "WD_TABLE_ALIGNMENT", table_direction: "WD_TABLE_DIRECTION", vertical_alignment: "WD_CELL_VERTICAL_ALIGNMENT", height_rule: "WD_ROW_HEIGHT_RULE" };
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const incompleteLabels = new Set([
  ...[112, 113, 114, 115].map(id => `cell grid_span boundary ${id}`),
  ...Array.from({ length: 10 }, (_, index) => `cell vertical_alignment boundary ${124 + index}`),
  ...Array.from({ length: 6 }, (_, index) => `cell width boundary ${134 + index}`)
]);

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of [false, true]) for (const route of ["model", "sdk", "cli"] as const)
for (const boundary of tablePropertyBoundaries)
for (const complete of incompleteLabels.has(boundary.label) ? [false, true] : [false])
it(`${route} independently executes ${boundary.label}; ${kind}; strict=${strict}; carrier=${carrier}; complete=${complete}`, async () => {
  let body = boundary.body;
  if (complete) {
    const xml = new api.DocumentXmlEditor(new TextEncoder().encode(`<w:body xmlns:w="${w}">${body}</w:body>`));
    const table = xml.root.children[0]!, row = table.children.find(node => node.localName === "tr")!;
    const cell = row.children.find(node => node.localName === "tc")!;
    const replacements = new Map<api.XmlElement, string>();
    if (!cell.children.some(node => node.localName === "p"))
      replacements.set(cell, `<w:tc>${xml.sourceXml(cell, new Map(), true)}<w:p/></w:tc>`);
    const span = cell.children.find(node => node.localName === "tcPr")?.children.find(node => node.localName === "gridSpan");
    const count = span ? Number(span.attributes.find(attr => attr.localName === "val")!.value) : 1;
    if (count > 1) replacements.set(table.children.find(node => node.localName === "tblGrid")!, `<w:tblGrid>${"<w:gridCol/>".repeat(count)}</w:tblGrid>`);
    body = xml.sourceXml(xml.root, replacements, true);
  }
  if (carrier) {
    const xml = new api.DocumentXmlEditor(new TextEncoder().encode(`<w:body xmlns:w="${w}">${body}</w:body>`));
    const pending = [xml.root], replacements = new Map<api.XmlElement, string>();
    while (pending.length) {
      const node = pending.pop()!;
      if (["tblPr", "trPr", "tcPr", "gridCol"].includes(node.localName)) {
        replacements.set(node, `<f:carry xmlns:f="urn:original:table-properties" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:carry">${xml.sourceXml(node)}</f:carry>`);
      } else pending.push(...node.children);
    }
    body = xml.sourceXml(xml.root, replacements, true);
  }
  const bytes = await textFixture(`<w:p><w:r><w:t>Untouched é 日本 עברית 🌊</w:t></w:r></w:p>${body}`, {}, strict, { kind });
  const before = readPackage(bytes), memory = Volume.fromJSON({ "/input": Buffer.from(bytes), "/out": "" });
  const sink = { async write(chunk: Uint8Array) { memory.appendFileSync("/out", chunk); } };
  const { target, property, expected, write } = boundary;
  const prefix = `model.table.${target === "table" ? "Table" : target === "row" ? "_Row" : target === "column" ? "_Column" : "_Cell"}`;
  const enumFamily = families[property];
  const assigned = typeof expected === "string" ? { enum: enumFamily, name: expected } : typeof expected === "number" && ["width", "height"].includes(property) ? { unit: "emu", value: expected } : expected;
  const operations: Record<string, unknown>[] = [{ operation: "model.document.Document.tables.get", receiver: ref("document"), arguments: {}, resultHandle: "tables" }];
  let receiver = ref("tables", 0);
  if (target === "row" || target === "column") {
    operations.push({ operation: `model.table.Table.${target === "row" ? "rows" : "columns"}.get`, receiver, arguments: {}, resultHandle: "owners" });
    receiver = ref("owners", 0);
  } else if (target === "cell") {
    operations.push({ operation: "model.table.Table.cell.call", receiver, arguments: { rowIdx: 0, colIdx: 0 }, resultHandle: "owner" });
    receiver = ref("owner");
  }
  if (write) operations.push({ operation: `${prefix}.${property}.set`, receiver, arguments: { value: assigned } });
  operations.push({ operation: `${prefix}.${property}.get`, receiver, arguments: {} });
  const resetsHeightRule = write && property === "height_rule" && expected === null && boundary.body.includes('w:val="1440"');
  const observedExpected = resetsHeightRule ? { enum: "WD_ROW_HEIGHT_RULE", name: "AT_LEAST" } : assigned;
  const invalidOriginal = incompleteLabels.has(boundary.label) && !complete;
  if (route === "model") {
    const document = await api.Document(bytes, textContext), table = document.tables[0]!;
    const owner = target === "table" ? table : target === "row" ? table.rows.at(0) : target === "column" ? table.columns.at(0) : table.cell(0, 0);
    const value = typeof expected === "string" ? Reflect.get(Reflect.get(api, enumFamily!) as object, expected) : typeof expected === "number" && ["width", "height"].includes(property) ? api.Length(expected) : expected;
    if (write) Reflect.set(owner, property, value);
    const observed = Reflect.get(owner, property) as unknown;
    if (resetsHeightRule) expect(observed).toBe(api.WD_ROW_HEIGHT_RULE.AT_LEAST);
    else if (typeof expected === "number" && ["width", "height"].includes(property)) expect((observed as api.Length).emu).toBe(expected);
    else expect(observed).toBe(value);
    if (invalidOriginal) await expect(document.save(sink)).rejects.toMatchObject({ code: "invalid-package" });
    else await document.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(bytes, { version: 1, operations }, textContext);
    expect(result.results.at(-1)!.value).toEqual(observedExpected);
    if (invalidOriginal) await expect(result.save(sink)).rejects.toMatchObject({ code: "invalid-package" });
    else await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Original destination");
    await fs.writeFile("/input", bytes); await fs.writeFile("/out", destination);
    await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-file /ops --json${write ? " --output /out --force" : ""}`);
      if (write && invalidOriginal) {
        expect(result.exitCode, result.stdout + result.stderr).toBe(1);
        expect(JSON.parse(result.stdout).errors[0].code).toBe("invalid-package");
        expect(await fs.readFile("/out")).toEqual(destination);
      } else {
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        expect(JSON.parse(result.stdout).data.results.at(-1).data).toEqual(observedExpected);
      }
      expect(await fs.readFile("/input")).toEqual(bytes);
      if (write && !invalidOriginal) memory.writeFileSync("/out", await fs.readFile("/out"));
      else expect(await fs.readFile("/out")).toEqual(destination);
    } finally { await shell.dispose(); }
  }
  if (invalidOriginal) expect(memory.readFileSync("/out").length).toBe(0);
  if (memory.readFileSync("/out").length) {
    const output = new Uint8Array(memory.readFileSync("/out") as Buffer), after = readPackage(output);
    assertPackageLinks(after); expect(after.size).toBe(before.size);
    for (const [name, part] of before) if (!write || name !== "word/document.xml") expect(after.get(name), name).toEqual(part);
    const reopened = await api.Document(output, textContext), table = reopened.tables[0]!;
    expect(reopened.paragraphs[0]!.text).toBe("Untouched é 日本 עברית 🌊");
    const owner = target === "table" ? table : target === "row" ? table.rows.at(0) : target === "column" ? table.columns.at(0) : table.cell(0, 0);
    const observed = Reflect.get(owner, property) as unknown;
    if (resetsHeightRule) expect(observed).toBe(api.WD_ROW_HEIGHT_RULE.AT_LEAST);
    else if (typeof expected === "number" && ["width", "height"].includes(property)) expect((observed as api.Length).emu).toBe(expected);
    else if (typeof expected === "string") expect(observed).toBe(Reflect.get(Reflect.get(api, enumFamily!) as object, expected));
    else expect(observed).toBe(expected);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(bytes));
});
