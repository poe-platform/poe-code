import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readBiff } from "./biff.js";

const biffContext: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 8, operations: 1000 } };
function record(opcode: number, bytes: readonly number[] | Uint8Array = []): Uint8Array {
  const result = new Uint8Array(4 + bytes.length), view = new DataView(result.buffer);
  view.setUint16(0, opcode, true); view.setUint16(2, bytes.length, true); result.set(bytes, 4); return result;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}

function indexedName(index: number, revision: number, token = 0x23): Uint8Array {
  const bytes = new Uint8Array(revision === 8 ? 5 : 15);
  bytes[0] = token;
  new DataView(bytes.buffer).setUint16(1, index, true);
  return bytes;
}

function workbook(revision: number, padding: number, declaredFirst: boolean, token: number): Uint8Array {
  const functionIndex = declaredFirst ? 1 : padding + 2;
  const call = concat(indexedName(functionIndex, revision, token), new Uint8Array([
    0x1e, 1, 0, 0x1e, 0, 0, 0x06, 0x1e, 23, 0, 0x42, 3, 0xff, 0
  ]));
  const functionName = { name: "_xlfn.IFERROR", tokens: new Uint8Array(), flags: 0xe };
  const macro = { name: "Macro", tokens: call, flags: 0 };
  const filler = Array.from({ length: padding }, (_, at) => ({ name: `Pad_${at}`, tokens: new Uint8Array([0x1e, 1, 0]), flags: 0 }));
  const names = (declaredFirst ? [functionName, ...filler, macro] : [macro, ...filler, functionName]).map(name => {
    const header = new Uint8Array(14), view = new DataView(header.buffer);
    view.setUint16(0, name.flags, true); header[3] = name.name.length; view.setUint16(4, name.tokens.length, true);
    return record(0x18, concat(header, new Uint8Array(revision === 8 ? [0] : []), new TextEncoder().encode(name.name), name.tokens));
  });
  const cellTokens = indexedName(declaredFirst ? padding + 2 : 1, revision);
  const cell = new Uint8Array(22 + cellTokens.length), view = new DataView(cell.buffer);
  view.setFloat64(6, 999, true); view.setUint16(20, cellTokens.length, true); cell.set(cellTokens, 22);
  return concat(record(0x809, [0, revision === 8 ? 6 : 5, 5, 0]), ...names, record(10),
    record(0x809, [0, revision === 8 ? 6 : 5, 16, 0]), record(6, cell), record(10));
}

for (const padding of [0, 256]) for (const declaredFirst of [false, true]) it.each([7, 8])(
  `captures BIFF %s custom-function identity at parse time; padding=${padding}; declaredFirst=${declaredFirst}`, async revision => {
    for (const token of [0x23, 0x43, 0x63]) {
      const input = workbook(revision, padding, declaredFirst, token), before = new Uint8Array(input);
      const book = await readBiff(input, biffContext);
      expect(recalculateWorkbook(book, biffContext, true).sheets[0]!.cells[0]!.value).toEqual(declaredFirst ?
        { kind: "number", value: 23 } : { kind: "error", value: padding === 0 ? "#NAME?" : "#Unknown!" });
      expect(input).toEqual(before);
    }
  }
);
