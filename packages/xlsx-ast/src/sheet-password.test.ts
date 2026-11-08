import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { UnsupportedRecord, Workbook } from "@poe-code/spreadsheet-ast";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 100000 } };
const protection = (attributes: Record<string, string>): UnsupportedRecord => ({ source: "xlsx", kind: "sheetProtection", disposition: "retained",
  data: { name: "sheetProtection", namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main", attributes, children: [], text: "" } });
for (const edition of ["2006", "2008"] as const) for (const hash of [0, 1, 0x1234, 0x8000, 0xffff]) {
  it(`${edition} preserves and edits legacy worksheet password verifier ${hash}`, async () => {
    const book: Workbook = { sheets: [{ id: "s", name: "Data", cells: [], view: { gnumeric: { Protected: "1" }, protectedPasswordHash: hash } }] };
    const imported = await readXlsx(await createXlsxWriter(edition)(book, [], context), context);
    expect(imported.sheets[0]!.view?.protectedPasswordHash).toBe(hash);
    for (const edited of [0, hash ^ 0xffff]) {
      const reopened = await readXlsx(await createXlsxWriter(edition)({ ...imported, sheets: imported.sheets.map(sheet => ({ ...sheet,
        view: { ...sheet.view, protectedPasswordHash: edited } })) }, [], context), context);
      expect(reopened.sheets[0]!.view?.protectedPasswordHash).toBe(edited);
    }
  });
}
it("imports short and lowercase native legacy hashes and leaves malformed values opaque", async () => {
  for (const password of ["1", "abc", "abcd", "FFFF", "", "12345", "gggg"]) {
    const book = await readXlsx(await createXlsxWriter("2006")({ sheets: [{ id: "s", name: "Data", cells: [],
      unsupportedRecords: [protection({ sheet: "1", password })] }] }, [], context), context);
    expect(book.sheets[0]!.view?.protectedPasswordHash, password).toBe(["", "12345", "gggg"].includes(password) ? undefined : Number.parseInt(password, 16));
  }
});
it("rejects invalid hashes and ambiguous edits alongside modern protection metadata", async () => {
  for (const protectedPasswordHash of [-1, 65536, 1.5, "1234", null]) {
    await expect(createXlsxWriter("2006")({ sheets: [{ id: "s", name: "Data", cells: [], view: { protectedPasswordHash } }] }, [], context))
      .rejects.toThrow("sheet password hash");
  }
  for (const field of ["algorithmName", "hashValue", "saltValue", "spinCount"]) {
    const book: Workbook = { sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: [protection({ sheet: "1", [field]: "synthetic" })] }] };
    const imported = await readXlsx(await createXlsxWriter("2006")(book, [], context), context);
    expect(imported.sheets[0]!.view?.protectedPasswordHash).toBeUndefined();
    await expect(createXlsxWriter("2006")({ ...imported, sheets: imported.sheets.map(sheet => ({ ...sheet,
      view: { ...sheet.view, protectedPasswordHash: 0 } })) }, [], context)).rejects.toThrow("modern protection");
  }
});

it("recognizes represented BIFF PASSWORD records while retaining malformed and unrepresented warnings", async () => {
  for (const bytes of ["3412", "0000", "FFFF", "", "12", "zzzz", "123400"]) {
    const diagnostics: string[] = [];
    await createXlsxWriter("2006")({ sheets: [{ id: "s", name: "Data", cells: [], view: { protectedPasswordHash: 0 },
      unsupportedRecords: [{ source: "biff", kind: "PASSWORD", disposition: "retained", data: { opcode: 0x13, bytes } }] }] }, [],
    { ...context, diagnostic: async item => { diagnostics.push(item.message); } });
    expect(diagnostics, bytes).toHaveLength(["3412", "0000", "FFFF"].includes(bytes) ? 0 : 1);
  }
  const diagnostics: string[] = [];
  await createXlsxWriter("2006")({ sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: [
    { source: "biff", kind: "PASSWORD", disposition: "retained", data: { opcode: 0x13, bytes: "3412" } }] }] }, [],
  { ...context, diagnostic: async item => { diagnostics.push(item.message); } });
  expect(diagnostics).toHaveLength(1);
});
