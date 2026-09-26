import { expect, it } from "vitest";
import { readBiffRecords } from "./biff-binary.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 2, operations: 10, workbookNodes: 0 } };
it("admits a BIFF record before materializing its payload view", () => {
  expect(() => readBiffRecords(new Uint8Array([1, 0, 255, 255]), context)).toThrowError(
    expect.objectContaining({ code: "resource-limit", message: "ssconvert BIFF record limit exceeded" }));
});
it("keeps empty padding outside the record admission", () => {
  expect(readBiffRecords(new Uint8Array(8), context)).toEqual([]);
});
