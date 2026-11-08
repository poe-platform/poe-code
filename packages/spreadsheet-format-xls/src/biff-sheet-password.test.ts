import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { Binary } from "./biff-binary.js";
import { readBiffMetadata } from "./biff-metadata.js";
import { createBiffWriter, readBiff } from "./biff.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 10000 } };
for (const hash of [0, 1, 0x1234, 0x8000, 0xffff]) it(`preserves worksheet password verifier ${hash} through BIFF7/8 and edits`, async () => {
  const bytes = new Uint8Array([hash & 255, hash >>> 8]);
  expect(readBiffMetadata([{ opcode: 0x13, offset: 0, data: new Binary(bytes) }], 8, 1252, context).view.protectedPasswordHash).toBe(hash);
  for (const revision of [7, 8] as const) {
    const book = { sheets: [{ id: "s", name: "Data", cells: [], view: { gnumeric: { Protected: "1" }, protectedPasswordHash: hash } }] };
    const imported = await readBiff(await createBiffWriter(revision)(book, [], context), context);
    expect(imported.sheets[0]!.view?.protectedPasswordHash).toBe(hash);
    for (const edited of [0, hash ^ 0xffff]) {
      const output = await readBiff(await createBiffWriter(revision)({ ...imported, sheets: imported.sheets.map(sheet => ({ ...sheet,
        view: { ...sheet.view, protectedPasswordHash: edited } })) }, [], context), context);
      expect(output.sheets[0]!.view?.protectedPasswordHash).toBe(edited);
    }
  }
});
it("rejects invalid canonical password verifiers and leaves malformed records unrepresented", async () => {
  for (const protectedPasswordHash of [-1, 65536, 1.5, "1234", null]) {
    await expect(createBiffWriter(8)({ sheets: [{ id: "s", name: "Data", cells: [], view: { protectedPasswordHash } }] }, [], context))
      .rejects.toThrow("sheet password hash");
  }
  for (const bytes of [new Uint8Array(), new Uint8Array(1), new Uint8Array(3)]) {
    expect(readBiffMetadata([{ opcode: 0x13, offset: 0, data: new Binary(bytes) }], 8, 1252, context).view.protectedPasswordHash).toBeUndefined();
  }
});

it("recognizes edited verifiers while retaining malformed PASSWORD warnings", async () => {
  const book = await readBiff(await createBiffWriter(8)({ sheets: [{ id: "s", name: "Data", cells: [],
    view: { protectedPasswordHash: 0x1234 } }] }, [], context), context);
  for (const bytes of ["3412", "", "12", "zzzz", "341200"]) {
    const diagnostics: string[] = [];
    await createBiffWriter(8)({ ...book, sheets: book.sheets.map(sheet => ({ ...sheet,
      view: { ...sheet.view, protectedPasswordHash: 0 }, unsupportedRecords: sheet.unsupportedRecords!.map(record =>
        record.kind === "PASSWORD" ? { ...record, data: { opcode: 0x13, bytes } } : record) })) }, [],
    { ...context, diagnostic: async item => { diagnostics.push(item.message); } });
    expect(diagnostics.includes("Unsupported Excel BIFF export metadata: PASSWORD"), bytes).toBe(bytes !== "3412");
  }
});
