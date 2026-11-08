import { expect, it } from "vitest";
import { decodeCcittFax } from "./filters.js";

it("decodes all fax rows without an explicit positive Rows value", () => {
  // Group 4 vertical-zero codes: each one bit produces a white row.
  const bytes = new Uint8Array(300).fill(255);
  for (const Rows of [undefined, 0]) {
    const decoded = decodeCcittFax(bytes, { K: -1, Columns: 8, Rows });
    expect(decoded).toEqual(new Uint8Array(2400).fill(255));
  }
  expect(decodeCcittFax(bytes, { K: -1, Columns: 8, Rows: 10 })).toHaveLength(10);
});
