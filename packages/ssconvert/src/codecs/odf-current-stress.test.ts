import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import type { CapabilityContext } from "../contracts.js";
import { readOdf } from "./odf.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 1000 } };
async function spreadsheet(cells: string) {
  const xml = `<o:document-content xmlns:o="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:t="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><o:body><o:spreadsheet><t:table t:name="S"><t:table-row>${cells}</t:table-row></t:table></o:spreadsheet></o:body></o:document-content>`;
  const codec = createZipCodec(), limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
    maxMembers: 10, maxPathBytes: 100, maxDepth: 10, maxPaxBytes: 1000, maxTextBytes: 100000, chunkSize: 4096 };
  const entries = [];
  for (const [name, source] of [["mimetype", "application/vnd.oasis.opendocument.spreadsheet"], ["content.xml", xml]]) {
    entries.push(await codec.makeZipEntry(name!, new TextEncoder().encode(source!), { modified: new Date("2000-01-01Z"),
      mode: 0o644, directory: false, symlink: false, compression: "deflate" }, limits, context.signal));
  }
  return codec.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}

it("matches released OpenCalc boolean lexical rules with renamed namespace prefixes", async () => {
  // oo_attr_bool: only case-insensitive false and exact 0 are false.
  const values = ["FALSE", "False", "0", "true", "TRUE", "1", "yes", "", " false "];
  const bytes = await spreadsheet(values.map(value => `<t:table-cell o:boolean-value="${value}"/>`).join(""));
  expect((await readOdf(bytes, context)).sheets[0]!.cells.map(cell => cell.value)).toEqual(
    [false, false, false, true, true, true, true, true, true].map(value => ({ kind: "boolean", value })));
});

it("preserves the first typed attribute even when the boolean spelling is noncanonical", async () => {
  const bytes = await spreadsheet('<t:table-cell o:boolean-value="FALSE" o:value="7"/><t:table-cell o:value="7" o:boolean-value="FALSE"/>');
  expect((await readOdf(bytes, context)).sheets[0]!.cells.map(cell => cell.value)).toEqual(
    [{ kind: "boolean", value: false }, { kind: "number", value: 7 }]);
});

it("does not interpret familiar attribute names in an attacker namespace", async () => {
  const bytes = await spreadsheet('<t:table-cell xmlns:evil="https://invalid.example/office" evil:value="9" evil:boolean-value="true" evil:formula="of:=1"/><t:table-cell o:value="4"/>');
  const cells = (await readOdf(bytes, context)).sheets[0]!.cells;
  expect(cells).toEqual([{ row: 0, column: 1, value: { kind: "number", value: 4 } }]);
});

it("admits large empty repeated columns sparsely but rejects materialized copies at the budget", async () => {
  const blank = await spreadsheet('<t:table-cell t:number-columns-repeated="10000"/><t:table-cell o:value="4"/>');
  const limits = { ...context.limits, cells: 1 };
  expect((await readOdf(blank, { ...context, limits })).sheets[0]!.cells).toEqual(
    [{ row: 0, column: 10000, value: { kind: "number", value: 4 } }]);
  const repeated = await spreadsheet('<t:table-cell t:number-columns-repeated="2" o:value="4"/>');
  await expect(readOdf(repeated, { ...context, limits })).rejects.toMatchObject({ code: "resource-limit" });
});

it("rejects malicious repeat syntax and checks a pre-aborted authority before parsing", async () => {
  const bytes = await spreadsheet('<t:table-cell t:number-columns-repeated="-1" o:value="4"/>');
  await expect(readOdf(bytes, context)).rejects.toMatchObject({ code: "io" });
  const controller = new AbortController(), reason = new Error("independent cancellation");
  controller.abort(reason);
  await expect(readOdf(bytes, { ...context, signal: controller.signal })).rejects.toBe(reason);
});

it("rejects a work budget before any sparse repeat can bypass accounting", async () => {
  const bytes = await spreadsheet('<t:table-cell t:number-columns-repeated="10000"/>');
  await expect(readOdf(bytes, { ...context, limits: { ...context.limits, workbookWork: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it("keeps a valid date when the optional clock cannot be scanned completely", async () => {
  const bytes = await spreadsheet('<t:table-cell o:date-value="1900-03-01Tbad:00:00"/><t:table-cell o:date-value="1900-03-01T12:bad:00"/><t:table-cell o:date-value="1900-03-01T12:00:bad"/><t:table-cell o:date-value="1900-03-01T12:00:00"/>');
  expect((await readOdf(bytes, context)).sheets[0]!.cells.map(cell => cell.value)).toEqual(
    [61, 61, 61, 61.5].map(value => ({ kind: "number", value })));
});
