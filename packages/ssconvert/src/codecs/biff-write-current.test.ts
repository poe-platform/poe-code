import { expect, it } from "vitest";
import { createBiffWriter, readBiff } from "./biff.js";
import { readBiffRecords, readCfb } from "./biff-binary.js";
import { biffNode } from "./biff-metadata.js";
import { metadataNode } from "./xlsx-write-support.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 1000, sheets: 8, operations: 1000 }
};

// Gnumeric 1.12.61 excel_write_PAGE_BREAK caps records, rather than failing a save.
it.each([7, 8, "dsf"] as const)("caps %s manual page breaks at each stream's native record limit", async profile => {
  const breaks = Array.from({ length: 1400 }, (_, index) => biffNode("break", { pos: index + 1, type: "manual" }));
  const bytes = await createBiffWriter(profile)({ sheets: [{ id: "s", name: "S", cells: [],
    unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained",
      data: biffNode("PrintInformation", {}, "", [biffNode("hPageBreaks", {}, "", breaks), biffNode("vPageBreaks", {}, "", breaks)]) }]
  }] }, [], context);
  for (const [name, stream] of readCfb(bytes, context)) {
    const records = readBiffRecords(stream, context), modern = name === "Workbook";
    const maximum = modern ? 1370 : 1038;
    for (const opcode of [0x1a, 0x1b]) {
      const record = records.filter(record => record.opcode === opcode);
      expect(record).toHaveLength(1);
      expect(record[0]!.data.u16(0)).toBe(maximum);
      expect(record[0]!.data.bytes.length).toBe(2 + maximum * (modern ? 6 : 2));
      expect(record[0]!.data.u16(2)).toBe(1);
      expect(record[0]!.data.u16(2 + (maximum - 1) * (modern ? 6 : 2))).toBe(maximum);
      if (modern) expect(record[0]!.data.u16(6)).toBe(opcode === 0x1b ? 256 : 0);
    }
  }
});

it.each([7, 8] as const)("filters BIFF%i automatic page breaks without reordering manual breaks", async profile => {
  const bytes = await createBiffWriter(profile)({ sheets: [{ id: "s", name: "S", cells: [],
    unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained",
      data: biffNode("PrintInformation", {}, "", [biffNode("hPageBreaks", {}, "", [
        biffNode("break", { pos: 9, type: "auto" }), biffNode("break", { pos: 5, type: "manual" }),
        biffNode("break", { pos: 7, type: "manual" }) ])]) }]
  }] }, [], context);
  const records = readBiffRecords(readCfb(bytes, context).values().next().value!, context);
  const record = records.find(record => record.opcode === 0x1b)!;
  expect(record.data.u16(0)).toBe(2);
  expect(record.data.u16(2)).toBe(5);
  expect(record.data.u16(profile === 8 ? 8 : 4)).toBe(7);
});

it.each([7, 8] as const)("uses BIFF%i native horizontal and vertical page-break opcodes", async profile => {
  const bytes = await createBiffWriter(profile)({ sheets: [{ id: "s", name: "S", cells: [],
    unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained",
      data: biffNode("PrintInformation", {}, "", [
        biffNode("hPageBreaks", {}, "", [biffNode("break", { pos: 7, type: "manual" })]),
        biffNode("vPageBreaks", {}, "", [biffNode("break", { pos: 3, type: "manual" })])
      ]) }]
  }] }, [], context);
  const records = readBiffRecords(readCfb(bytes, context).values().next().value!, context);
  expect(records.find(record => record.opcode === 0x1b)!.data.u16(2)).toBe(7);
  expect(records.find(record => record.opcode === 0x1a)!.data.u16(2)).toBe(3);
  // Mutate the raw wire bytes to independent values; replay must use the native names.
  const raw = readCfb(bytes, context).values().next().value!;
  const rawRecords = readBiffRecords(raw, context);
  raw[rawRecords.find(record => record.opcode === 0x1b)!.offset + 6] = 11;
  raw[rawRecords.find(record => record.opcode === 0x1a)!.offset + 6] = 13;
  const reopened = await readBiff(raw, context);
  const print = reopened.sheets[0]!.unsupportedRecords!.find(record => record.kind === "PrintInformation")!;
  const node = metadataNode(print.data)!;
  expect(node.children.find(n => n.name === "hPageBreaks")!.children[0]!.attributes.pos).toBe("11");
  expect(node.children.find(n => n.name === "vPageBreaks")!.children[0]!.attributes.pos).toBe("13");
});

it.each([7, 8] as const)("preserves BIFF%i accounting underlines across product replay", async profile => {
  const book = { sheets: [{ id: "s", name: "S", cells: [3, 4].map((underline, column) => ({
    row: 0, column, value: { kind: "string" as const, value: "styled" },
    style: { gnumeric: biffNode("Style", {}, "", [biffNode("Font", { Underline: underline }, "Sans")]) }
  })) }] };
  const once = await readBiff(await createBiffWriter(profile)(book, [], context), context);
  const twice = await readBiff(await createBiffWriter(profile)(once, [], context), context);
  for (const [index, expected] of ["3", "4"].entries()) {
    for (const reopened of [once, twice]) {
      expect(JSON.stringify(reopened.sheets[0]!.cells[index]!.style)).toContain(`"name":"Underline","namespace":"","value":"${expected}"`);
    }
  }
});

it.each([-1, 270, 315] as const)("preserves native BIFF8 rotation %s across product replay", async rotation => {
  const bytes = await createBiffWriter(8)({ sheets: [{ id: "s", name: "S", cells: [{
    row: 0, column: 0, value: { kind: "number", value: 1 }, style: { gnumeric: biffNode("Style", { Rotation: rotation }) }
  }] }] }, [], context);
  const once = await readBiff(bytes, context);
  const twice = await readBiff(await createBiffWriter(8)(once, [], context), context);
  for (const reopened of [once, twice]) expect(JSON.stringify(reopened.sheets[0]!.cells[0]!.style))
    .toContain(`"name":"Rotation","namespace":"","value":"${rotation}"`);
});

it.each([7, 8, "dsf"] as const)("reports only the first %s native extent warning across axes and sheets", async profile => {
  const warnings: string[] = [];
  const cells = [{ row: 65536, column: 256, value: { kind: "number" as const, value: 1 } }];
  await createBiffWriter(profile)({ sheets: [{ id: "s", name: "S", cells }, { id: "t", name: "T", cells }] }, [],
    { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(warnings).toEqual(["W Some content will be lost when saving.  This format only supports 256 columns, and this workbook has 256"]);
});
