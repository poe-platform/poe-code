import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readBiffRecords, readCfb } from "./biff-binary.js";
import { writeCfb } from "./biff-write-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 8, operations: 10000 } };

// Duplicate NAME records cannot be expressed by the public workbook model.
// Replace only the same-length spelling; retain every indexed reference token.
async function duplicateInput(profile: 7 | 8 | "dsf", local: boolean, placeholder: boolean): Promise<Uint8Array> {
  const scope = local ? { sheet: "here" } : {};
  const book: Workbook = { names: [
    { name: "Early", expression: placeholder ? "#NAME?" : "11", ...scope },
    { name: "Watch", expression: "Early", ...scope },
    { name: "Later", expression: "17", ...scope },
    { name: "Bridge", expression: "Later", ...scope }
  ], sheets: [{ id: "here", name: "Here", cells: ["Early", "Later", "Watch", "Bridge"].map((name, row) =>
    ({ row, column: 0, formula: "=" + name, value: { kind: "number", value: 999 } })) }] };
  const streams = new Map(readCfb(await createBiffWriter(profile)(book, [], context), context));
  for (const [name, original] of streams) {
    const stream = new Uint8Array(original), revision = name === "Book" ? 7 : 8;
    let changed = 0;
    for (const record of readBiffRecords(stream, context)) {
      if (record.opcode !== 0x18) continue;
      const start = revision === 8 ? 15 : 14;
      const wide = revision === 8 && (record.data.u8(14) & 1) !== 0;
      const encoding = wide ? "utf16le" : "latin1";
      if (record.data.u8(3) === 5 && Buffer.from(record.data.bytes.subarray(start, start + (wide ? 10 : 5))).toString(encoding) === "Later") {
        stream.set(Buffer.from("Early", encoding), record.offset + 4 + start); changed++;
      }
    }
    expect(changed).toBe(1);
    streams.set(name, stream);
  }
  return writeCfb(streams, context);
}

for (const local of [false, true]) for (const placeholder of [false, true]) it.each([7, 8, "dsf"] as const)(
  `handles duplicate BIFF %s names in ${local ? "sheet" : "workbook"} scope; placeholder=${placeholder}`, async profile => {
    const input = await duplicateInput(profile, local, placeholder), before = new Uint8Array(input);
    const diagnostics: string[] = [];
    const reopened = await readBiff(input, { ...context, async diagnostic(value) { diagnostics.push(value.message); } });
    expect(diagnostics).toEqual([]);
    expect(reopened.names?.filter(name => name.name === "Early")).toHaveLength(1);
    const number = (value: number) => ({ kind: "number", value });
    const missing = { kind: "error", value: "#REF!" };
    expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(
      placeholder ? [number(17), number(17), number(17), number(17)] : [number(11), missing, number(11), missing]);
    expect(input).toEqual(before);
  }
);
