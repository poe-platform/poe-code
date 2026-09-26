import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";
import { createBiffWriter, readBiff } from "./biff.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 10000 } };

for (const local of [false, true]) it.each(["xml", 7, 8, "dsf"] as const)(
  `retains an empty ${local ? "local" : "global"} native name through %s replay`, async profile => {
    const declarations = '<gnm:Names><gnm:Name><gnm:name>Empty</gnm:name><gnm:value/><gnm:position>A1</gnm:position></gnm:Name>' +
      '<gnm:Name><gnm:name>Alias</gnm:name><gnm:value>Empty</gnm:value><gnm:position>A1</gnm:position></gnm:Name></gnm:Names>';
    const prefix = local ? "Data!" : "";
    const input = new TextEncoder().encode(`<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd">
      <gnm:Version Epoch="1" Major="12" Minor="61"/><gnm:SheetNameIndex><gnm:SheetName>Here</gnm:SheetName><gnm:SheetName>Data</gnm:SheetName></gnm:SheetNameIndex>
      ${local ? "" : declarations}<gnm:Sheets><gnm:Sheet><gnm:Name>Here</gnm:Name><gnm:Cells>
      <gnm:Cell Row="0" Col="0">=${prefix}Empty</gnm:Cell><gnm:Cell Row="1" Col="0">=${prefix}Alias</gnm:Cell>
      <gnm:Cell Row="2" Col="0">=${prefix}Empty+7</gnm:Cell></gnm:Cells></gnm:Sheet>
      <gnm:Sheet><gnm:Name>Data</gnm:Name>${local ? declarations : ""}<gnm:Cells/></gnm:Sheet></gnm:Sheets></gnm:Workbook>`);
    const messages: string[] = [];
    const book = await readGnumeric(input, { ...context, async diagnostic(d) { messages.push(d.message); } });
    const before = structuredClone(book);
    expect(book.names?.find(name => name.name === "Empty")?.expression).toBe("");
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(
      [0, 0, 7].map(value => ({ kind: "number", value })));
    const bytes = profile === "xml" ? await writeGnumeric(book, [], context) : await createBiffWriter(profile)(book, [], context);
    const reopened = profile === "xml" ? await readGnumeric(bytes, context) : await readBiff(bytes, context);
    expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(
      [0, 0, 7].map(value => ({ kind: "number", value })));
    expect(messages).toEqual([]);
    expect(book).toEqual(before);
  }
);
