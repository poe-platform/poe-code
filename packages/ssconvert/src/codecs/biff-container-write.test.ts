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
