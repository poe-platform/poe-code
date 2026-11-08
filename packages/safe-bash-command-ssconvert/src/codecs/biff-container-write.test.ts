import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readCfb } from "./biff-binary.js";
import { writeCfb } from "./biff-write-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 10, sheets: 2, operations: 10 } };

it.each([[0], [1], [63], [64], [65], [4095], [4096], [4097], [4095, 4095], [67, 4097], [4097, 67], [4097, 8193]])(
  "preserves exact stream lengths across mini-stream and sector boundaries (%j)", (...lengths) => {
    const streams = new Map(lengths.map((length, i) => [i ? "Workbook" : "Book", Uint8Array.from({ length }, (_, n) => n % 251)]));
    const output = writeCfb(streams, context), reopened = readCfb(output, context);
    expect([...reopened.keys()].sort()).toEqual([...streams.keys()].sort());
    for (const [name, bytes] of streams) {
      expect(reopened.get(name)?.length).toBe(bytes.length);
      expect(reopened.get(name)).toEqual(bytes);
    }
  });

it.each([3, 4, 7, 8, 15, 16])("stores %i workbook/property streams in a valid CFB directory tree", count => {
  const names = ["Workbook", "Book", "\u0005SummaryInformation", "\u0005DocumentSummaryInformation",
    ...Array.from({ length: 12 }, (_, n) => `Property${n}`)].slice(0, count);
  const streams = new Map(names.map((name, n) => [name, new Uint8Array(n % 3 === 0 ? 4097 : n * 37).fill(n)]));
  const bytes = writeCfb(streams, context), view = new DataView(bytes.buffer);
  const fat = (id: number) => view.getUint32((view.getUint32(76, true) + 1) * 512 + id * 4, true);
  const directory: number[] = [];
  for (let id = view.getUint32(48, true); id !== 0xfffffffe; id = fat(id)) {
    expect(directory).not.toContain(id); directory.push(id);
  }
  expect(directory.length).toBe(Math.ceil((count + 1) / 4));
  const at = (id: number) => (directory[Math.floor(id / 4)]! + 1) * 512 + id % 4 * 128;
  const seen = new Set<number>(), ordered: string[] = [];
  const walk = (id: number, parentRed = false): number => {
    if (id === 0xffffffff) return 1;
    expect(id).toBeGreaterThan(0); expect(id).toBeLessThanOrEqual(count);
    expect(seen.has(id)).toBe(false); seen.add(id);
    const offset = at(id), red = view.getUint8(offset + 67) === 0;
    expect(parentRed && red).toBe(false);
    const left = walk(view.getUint32(offset + 68, true), red);
    const length = view.getUint16(offset + 64, true);
    ordered.push(new TextDecoder("utf-16le").decode(bytes.subarray(offset, offset + length - 2)));
    expect(view.getUint32(offset + 76, true)).toBe(0xffffffff);
    const right = walk(view.getUint32(offset + 72, true), red);
    expect(left).toBe(right);
    return left + Number(!red);
  };
  const root = view.getUint32(at(0) + 76, true);
  expect(view.getUint8(at(root) + 67)).toBe(1);
  walk(root);
  expect(seen.size).toBe(count);
  expect(ordered).toEqual([...names].sort((a, b) => a.length - b.length || (a.toUpperCase() < b.toUpperCase() ? -1 : 1)));
  const reopened = readCfb(bytes, context);
  expect(reopened.size).toBe(count);
  for (const [name, data] of streams) expect(reopened.get(name)).toEqual(data);
});

it("admits directory nodes before allocating a larger CFB", () => {
  const streams = new Map(["Book", "Workbook", "\u0005SummaryInformation", "\u0005DocumentSummaryInformation"].map(name => [name, new Uint8Array()]));
  expect(() => writeCfb(streams, { ...context, limits: { ...context.limits, workbookNodes: 4 } })).toThrow("CFB directory node limit");
  expect(() => writeCfb(streams, { ...context, limits: { ...context.limits, outputBytes: 2047 } })).toThrow("CFB output bytes limit");
  expect(() => writeCfb(streams, { ...context, limits: { ...context.limits, workbookWork: 1 } })).toThrow("CFB directory work limit");
});
