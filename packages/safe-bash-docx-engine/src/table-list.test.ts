import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { executeDocumentBatch } from "./batch.js";
import { paragraph, table, textContext, textFixture, w } from "../tests/fixtures/text.js";

it("lists original logical table records in body order and returns empty reads", async () => {
  const input = await textFixture(table([paragraph("First")]) + table([paragraph("Second")]));
  const volume = Volume.fromJSON({ "/input": Buffer.from(input) });
  const bytes = new Uint8Array(volume.readFileSync("/input") as Buffer);
  const data = await docx.inspectDocumentTables(bytes, {}, textContext);
  expect(data.items.map(item => ({ kind: item.kind, support: item.support, text: item.details.cells[0]?.text }))).toEqual([
    { kind: "tables", support: "read", text: "First" },
    { kind: "tables", support: "read", text: "Second" }
  ]);
  expect(data.items.map(item => item.location.positions.table)).toEqual([1, 2]);
  expect(data.items.every(item => item.properties.length === 0 && item.references.length === 0)).toBe(true);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  expect(await docx.inspectDocumentTables(await textFixture(paragraph("Empty")), {}, textContext)).toEqual({ items: [] });
});

it("honors explicit header scope and table selectors without reading body siblings", async () => {
  const input = await textFixture(table([paragraph("Body")]) + '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>', {
    header: { kind: "header", xml: `<w:hdr xmlns:w="${w}">` + table([paragraph("Header")]) + '</w:hdr>' }
  });
  const volume = Volume.fromJSON({ "/input": Buffer.from(input) });
  const bytes = new Uint8Array(volume.readFileSync("/input") as Buffer);
  const scoped = await docx.inspectDocumentTables(bytes, { scope: "headers", table: 1 }, textContext);
  expect(scoped.items.map(item => item.details.cells[0]?.text)).toEqual(["Header"]);
  expect(scoped.items[0]?.location.value.part).toBe("/word/header.xml");
  expect(await docx.inspectDocumentTables(bytes, { select: scoped.items[0]!.location.token }, textContext)).toEqual(scoped);
  await expect(docx.inspectDocumentTables(bytes, { scope: "headers", table: 2 }, textContext)).rejects.toMatchObject({ code: "missing-selection" });
});

it("rejects undeclared flags and stale table selectors rather than ignoring them", async () => {
  const bytes = await textFixture(table([paragraph("Current")]));
  const old = await docx.openDocumentLocations(await textFixture(table([paragraph("Old")])), textContext);
  await expect(docx.inspectDocumentTables(bytes, { select: old.at("table", 1).token }, textContext)).rejects.toMatchObject({ code: "stale-selection" });
  await expect(docx.inspectDocumentTables(bytes, { output: "/ignored" } as never, textContext)).rejects.toMatchObject({ code: "usage" });
});

it("executes the same table listing through the ordered batch adapter", async () => {
  const input = await textFixture(table([paragraph("Batch")]) + table([paragraph("Sibling")]));
  const volume = Volume.fromJSON({ "/input": Buffer.from(input) });
  const bytes = new Uint8Array(volume.readFileSync("/input") as Buffer);
  const result = await executeDocumentBatch(bytes, { version: 1, operations: [{ operation: "tables.list", arguments: { table: 2 } }] }, { dryRun: true }, { ...textContext, encoding: { order: "input", compression: "store" } });
  const expected = await docx.inspectDocumentTables(bytes, { table: 2 }, textContext);
  expect(result.results[0]).toMatchObject({ version: 1, operation: "tables.list", ok: true, data: expected, affected: 0, warnings: [], errors: [], locations: expected.items.map(item => item.location) });
  expect(result.publication).toBeNull();
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});

it("publishes the table collection result schema and read support", () => {
  const parsed = docx.parseDocxArguments(["schema", "tables", "list"].map(word => new TextEncoder().encode(word)));
  const discovery = docx.getDocxDiscovery(parsed)!;
  expect(discovery.data).toMatchObject({ operations: [{ support: "read", result: { oneOf: [{ properties: { data: { properties: { items: { type: "array", items: { properties: { kind: { const: "tables" } } } } } } } }, {}] } }] });
});
