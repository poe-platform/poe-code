import { expect, test } from "vitest";
import { readCfb } from "./biff-binary.js";
import { writeCfb } from "./biff-write-binary.js";

const context = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 10, sheets: 2, operations: 10 }
};
const streams = new Map([["Workbook", new Uint8Array(4097).fill(7)], ["Book", new Uint8Array(67).fill(3)]]);

test("CFB decoding charges caller work and retained storage across large and mini streams", () => {
  const bytes = writeCfb(streams, context);
  let work = 0, retained = 0;
  expect(readCfb(bytes, { ...context, work: () => { work++; }, retain: bytes => { retained += bytes; } })).toEqual(streams);
  expect(work).toBeGreaterThan(20);
  expect(retained).toBeGreaterThan(4164);
});

for (const budget of ["work", "retain"] as const) test(`CFB decoding stops on caller ${budget} exhaustion`, () => {
  const bytes = writeCfb(streams, context);
  const failure = new Error(`${budget} exhausted`);
  expect(() => readCfb(bytes, { ...context, [budget]: () => { throw failure; } })).toThrow(failure);
});
