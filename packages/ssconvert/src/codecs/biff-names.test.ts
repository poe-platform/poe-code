import { expect, it } from "vitest";
import { readBiff } from "./biff.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";
import { biffContext, concat, record } from "./biff.test.js";

function namedWorkbook(revision: number, characters: readonly number[], wide = false, builtin = true): Uint8Array {
  const header = new Uint8Array(14), view = new DataView(header.buffer);
  view.setUint16(0, builtin ? 0x20 : 0, true); header[3] = characters.length;
  view.setUint16(4, 3, true);
  const text = new Uint8Array(characters.flatMap(character => wide ? [character & 255, character >> 8] : [character]));
  return concat(record(0x809, [0, revision === 8 ? 6 : 5, 5, 0]),
    record(0x18, concat(header, ...(revision === 8 ? [new Uint8Array([wide ? 1 : 0])] : []), text, new Uint8Array([0x1e, 42, 0]))),
    record(10), record(0x809, [0, revision === 8 ? 6 : 5, 16, 0]), record(10));
}

it.each([7, 8])("imports every stable built-in NAME identifier in BIFF%i", async revision => {
  const expected = ["Consolidate_Area", "Auto_Open", "Auto_Close", "Extract", "Database", "Criteria",
    "Print_Area", "Print_Titles", "Recorder", "Data_Form", "Auto_Activate", "Auto_Deactivate", "Sheet_Title", "_FilterDatabase"];
  for (let id = 0; id < expected.length; id++) {
    expect((await readBiff(namedWorkbook(revision, [id]), biffContext)).names).toEqual([{ name: expected[id], expression: "=42" }]);
  }
});

it.each([false, true])("consumes the complete BIFF8 built-in character and suffix (wide=%s)", async wide => {
  expect((await readBiff(namedWorkbook(8, [12, 95, 65], wide), biffContext)).names)
    .toEqual([{ name: "Sheet_Title_A", expression: "=42" }]);
});

it("keeps ordinary wide names independent of built-in identifiers", async () => {
  expect((await readBiff(namedWorkbook(8, [0x3a9, 65], true, false), biffContext)).names)
    .toEqual([{ name: "ΩA", expression: "=42" }]);
});

it("exports BIFF names using native Gnumeric expression syntax for replay", async () => {
  const book = await readBiff(namedWorkbook(8, [12, 95, 65], true), biffContext);
  const output = await writeGnumeric(book, [], biffContext);
  // Native replay loses the expression when the XML value starts with '='.
  expect(new TextDecoder().decode(output)).toContain("<gnm:value>42</gnm:value>");
  expect((await readGnumeric(output, biffContext)).names).toMatchObject([{ name: "Sheet_Title_A", expression: "42" }]);
});
