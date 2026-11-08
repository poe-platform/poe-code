import { expect, it } from "vitest";
import { gzipSync, gunzipSync } from "node:zlib";
import { runInNewContext } from "node:vm";
import { readGnumeric, writeGnumeric, writeCompressedGnumeric } from "./gnumeric.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 10000 } };
const encode = (text: string) => new TextEncoder().encode(text);
const workbook = (content: string) => `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd" xmlns:alien="urn:independent:negative"><g:Sheets><g:Sheet><g:Name>S</g:Name>${content}<g:Cells><g:Cell Row="0" Col="0" ValueType="40">3.25</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`;

it("independently filters all six margin attributes while canonicalizing mixed-case aliases", async () => {
  const margins = ["top", "bottom", "left", "right", "header", "footer"];
  const units = ["CeNtImEtEr", "MILLIMETER", "INCHES", "in", "unknown", "Pt"];
  const canonical = ["mm", "mm", "inch", "inch", "points", "points"];
  const input = workbook(`<g:PrintInformation><g:Margins>${margins.map((name, index) => `<g:${name} Points="${40 + index}" PrefUnit="${units[index]}" alien:Points="999" Mystery="drop"/>`).join("")}</g:Margins></g:PrintInformation>`);
  const output = new TextDecoder().decode(await writeGnumeric(await readGnumeric(encode(input), context), [], context));
  margins.forEach((name, index) => expect(output).toContain(`<gnm:${name} Points="${40 + index}" PrefUnit="${canonical[index]}"/>`));
  expect(output).not.toContain("Mystery"); expect(output).not.toContain("999");
});

it("rejects foreign core Style and Font namespaces without removing delegated drawing data", async () => {
  const diagnostics: string[] = [];
  const input = workbook('<g:Styles><g:StyleRegion startCol="0" startRow="0" endCol="0" endRow="0"><g:Style Format="0.00" alien:Format="wrong" Orient="9"><g:Font Unit="13" Bold="1" alien:Unit="99">Serif</g:Font><alien:Font Unit="88">foreign</alien:Font><line width="77"/></g:Style><alien:Style Format="bad"/></g:StyleRegion></g:Styles><g:Objects><g:SheetObjectFilled ObjectBound="A1:B2" Type="101"><Style><line width="2.75" color="00FF00FF"/><font font="Serif 13"/></Style></g:SheetObjectFilled></g:Objects>');
  const book = await readGnumeric(encode(input), { ...context, diagnostic: async d => { diagnostics.push(d.message); } });
  const output = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(output).toContain('<gnm:Font Unit="13" Bold="1">Serif</gnm:Font>');
  expect(output).toContain('<line width="2.75" color="00FF00FF"/>');
  expect(output).toContain('<font font="Serif 13"/>');
  for (const forbidden of ['Orient=', 'Unit="99"', 'Unit="88"', 'width="77"', 'Format="wrong"', 'Format="bad"']) expect(output).not.toContain(forbidden);
  expect(diagnostics.map(d => d.split(" in state")[0])).toEqual(["Unexpected element 'alien:Font'", "Unexpected element 'line'", "Unexpected element 'alien:Style'"]);
});

it("keeps deterministic XML identical across independent gzip writes", async () => {
  const book = await readGnumeric(encode(workbook("")), context);
  const xml = await writeGnumeric(book, [], context);
  const first = await writeCompressedGnumeric(book, [], context);
  const second = await writeCompressedGnumeric(book, [], context);
  expect(gunzipSync(first)).toEqual(Buffer.from(xml));
  expect(second).toEqual(first);
});

it("blocks external-entity content and corrupt compressed input", async () => {
  const entity = '<!DOCTYPE Workbook [<!ENTITY leak SYSTEM "file:///independent-secret">]>' + workbook('<g:Objects>&leak;</g:Objects>');
  await expect(readGnumeric(encode(entity), context)).rejects.toMatchObject({ code: "capability-denied", message: "ssconvert host denies XML DTD and entity declarations" });
  const compressed = gzipSync(workbook("")); compressed[compressed.length - 5] = compressed[compressed.length - 5]! ^ 255;
  await expect(readGnumeric(compressed, context)).rejects.toMatchObject({ code: "io" });
});

it("honors cancellation before gzip or XML acquisition", async () => {
  const controller = new AbortController(); const reason = new Error("independent-cancellation"); controller.abort(reason);
  const cancelled = { ...context, signal: controller.signal };
  await expect(readGnumeric(gzipSync(workbook("")), cancelled)).rejects.toBe(reason);
  await expect(writeGnumeric({ sheets: [] }, [], cancelled)).rejects.toBe(reason);
  await expect(writeCompressedGnumeric({ sheets: [] }, [], cancelled)).rejects.toBe(reason);
});

it("preserves a foreign-realm cancellation reason without relying on instanceof Error", async () => {
  const reason: unknown = runInNewContext('new Error("foreign-preabort")');
  expect(reason instanceof Error).toBe(false);
  const controller = new AbortController(); controller.abort(reason);
  const cancelled = { ...context, signal: controller.signal };
  await expect(readGnumeric(gzipSync(workbook("")), cancelled)).rejects.toBe(reason);
  await expect(writeGnumeric({ sheets: [] }, [], cancelled)).rejects.toBe(reason);
  await expect(writeCompressedGnumeric({ sheets: [] }, [], cancelled)).rejects.toBe(reason);
});

it("rejects independently minimized cell and serialization budget overruns", async () => {
  await expect(readGnumeric(encode(workbook("")), { ...context, limits: { ...context.limits, cells: 0 } })).rejects.toMatchObject({ code: "resource-limit" });
  const book = await readGnumeric(encode(workbook("")), context);
  await expect(writeGnumeric(book, [], { ...context, limits: { ...context.limits, outputBytes: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
  await expect(writeCompressedGnumeric(book, [], { ...context, limits: { ...context.limits, outputBytes: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it("matches mixed descendant text order with CDATA, comment and PI while warning once per rejected subtree", async () => {
  const diagnostics: string[] = [];
  const input = '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:SheetNameIndex><gnm:SheetName gnm:Cols="256" gnm:Rows="65536">ABCDEFGHI&amp;</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>A<gnm:value>B<![CDATA[C]]><deep>D</deep>E</gnm:value>F<value>G</value>H<!--ignored--><?qa ignored?><![CDATA[I&]]></gnm:Name><gnm:Cells><gnm:Cell Row="0" Col="0" ValueType="40">1</gnm:Cell></gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>';
  const book = await readGnumeric(encode(input), { ...context, diagnostic: async d => { diagnostics.push(d.message); } });
  expect(book.sheets.map(sheet => sheet.name)).toEqual(["ABCDEFGHI&"]);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 1 });
  expect(diagnostics).toEqual(["Unexpected element 'gnm:value' in state : \n\tWorkbook -> Sheets -> Sheet -> Name\n", "Unexpected element 'value' in state : \n\tWorkbook -> Sheets -> Sheet -> Name\n"]);
  const output = await writeGnumeric(book, [], context);
  expect(new TextDecoder().decode(output)).toContain('<gnm:Name>ABCDEFGHI&amp;</gnm:Name>');
  expect((await readGnumeric(output, context)).sheets.map(sheet => sheet.name)).toEqual(["ABCDEFGHI&"]);
  await expect(readGnumeric(encode(input.replace('>ABCDEFGHI&amp;</gnm:SheetName>', '>AFHI&amp;</gnm:SheetName>')), context)).rejects.toMatchObject({ code: "io", message: "E File has inconsistent SheetNameIndex element." });
});

it("retains native GogStyle graph properties and rejects GOStyle false type authority", async () => {
  const graph = (type: string) => workbook(`<g:Objects><g:SheetObjectGraph ObjectBound="A1:B2"><GogObject type="GogGraph"><property name="style" type="${type}"><outline width="2.75" color="FF0000FF"/></property></GogObject></g:SheetObjectGraph></g:Objects>`);
  const validWarnings: string[] = [];
  const valid = await readGnumeric(encode(graph("GogStyle")), { ...context, diagnostic: async d => { validWarnings.push(d.message); } });
  expect(validWarnings).toEqual([]);
  expect(new TextDecoder().decode(await writeGnumeric(valid, [], context))).toContain('<outline width="2.75" color="FF0000FF"/>');
  const invalidWarnings: string[] = [];
  const invalid = await readGnumeric(encode(graph("GOStyle")), { ...context, diagnostic: async d => { invalidWarnings.push(d.message); } });
  expect(invalidWarnings).toContain("Unexpected element 'outline' in state : \n\tWorkbook -> Sheets -> Sheet -> Objects -> SheetObjectGraph -> GogObject -> property\n");
  expect(new TextDecoder().decode(await writeGnumeric(invalid, [], context))).not.toContain('width="2.75"');
});

it.each([
  ['name="name" type="GogStyle"', '<outline width="88"/>'],
  ['name="style" type="InvalidStyle"', '<outline width="88"/>'],
  ['name="Style" type="GogStyle"', '<outline width="88"/>'],
  ['name="style" alien:type="GogStyle"', '<outline width="88"/>'],
  ['name="style" type="GogStyle"', '<alien:outline width="88"/>'],
])("rejects false graph property authority %s / %s", async (attributes, child) => {
  const warnings: string[] = [];
  const input = workbook(`<g:Objects><g:SheetObjectGraph ObjectBound="A1:B2"><GogObject type="GogGraph"><property ${attributes}>${child}</property></GogObject></g:SheetObjectGraph></g:Objects>`);
  const book = await readGnumeric(encode(input), { ...context, diagnostic: async d => { warnings.push(d.message); } });
  expect(warnings.some(warning => warning.startsWith("Unexpected element '"))).toBe(true);
  expect(new TextDecoder().decode(await writeGnumeric(book, [], context))).not.toContain('width="88"');
});

it("does not authorize style properties outside a GogObject owner", async () => {
  const warnings: string[] = [];
  const input = workbook('<g:Objects><g:SheetObjectGraph ObjectBound="A1:B2"><property name="style" type="GogStyle"><outline width="88"/></property></g:SheetObjectGraph></g:Objects>');
  const book = await readGnumeric(encode(input), { ...context, diagnostic: async d => { warnings.push(d.message); } });
  expect(warnings).toEqual(["Unexpected element 'property' in state : \n\tWorkbook -> Sheets -> Sheet -> Objects -> SheetObjectGraph\n"]);
  expect(new TextDecoder().decode(await writeGnumeric(book, [], context))).not.toContain('width="88"');
});
