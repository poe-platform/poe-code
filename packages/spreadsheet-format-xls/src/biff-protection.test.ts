import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { Binary } from "./biff-binary.js";
import { readBiffMetadata } from "./biff-metadata.js";
import { createBiffWriter, readBiff } from "./biff.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 10000 } };

it.each([
  [[], "1"], [[0], "1"], [[0, 0], "0"], [[1, 0], "1"], [[2, 0], "0"], [[255, 255], "0"]
] as const)("imports native protection payload %j as %s", (bytes, expected) => {
  for (const revision of [2, 3, 4, 5, 7, 8]) for (const opcode of [0x12, 0x63]) {
    const result = readBiffMetadata([{ opcode, offset: 0, data: new Binary(Uint8Array.from(bytes)) }], revision, 1252, context);
    expect(result.view.gnumeric).toMatchObject({ Protected: expected });
  }
});

it("keeps protection record order while scenario protection remains independent", () => {
  const records = [
    { opcode: 0x12, offset: 0, data: new Binary(Uint8Array.of(1, 0)) },
    { opcode: 0xdd, offset: 6, data: new Binary(Uint8Array.of(0, 0)) },
    { opcode: 0x63, offset: 12, data: new Binary(Uint8Array.of(0, 0)) }
  ];
  expect(readBiffMetadata(records.slice(0, 2), 8, 1252, context).view.gnumeric).toMatchObject({ Protected: "1" });
  expect(readBiffMetadata(records, 8, 1252, context).view.gnumeric).toMatchObject({ Protected: "0" });
});

it.each([7, 8] as const)("preserves and clears editable sheet protection in BIFF%i", async revision => {
  const book = { sheets: [{ id: "s", name: "Data", cells: [], view: { gnumeric: { Protected: "1" } } }] };
  const opened = await readBiff(await createBiffWriter(revision)(book, [], context), context);
  expect(opened.sheets[0]!.view!.gnumeric).toMatchObject({ Protected: "1" });
  const cleared = { ...opened, sheets: opened.sheets.map(sheet => ({ ...sheet, view: { ...sheet.view, gnumeric: { Protected: "0" } } })) };
  const reopened = await readBiff(await createBiffWriter(revision)(cleared, [], context), context);
  expect(reopened.sheets[0]!.view!.gnumeric).not.toHaveProperty("Protected", "1");
});
