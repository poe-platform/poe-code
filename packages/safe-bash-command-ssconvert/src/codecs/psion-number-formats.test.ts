import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readPsion } from "./psion.js";
import { psionFixture } from "./psion-fixture.test-support.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 4, operations: 1000 } };

it.each([
  [26, "d mmm"], [28, "d mmm yy"], [30, "dd mmm yy"], [36, "mmm yy"], [38, "mmmm yy"], [40, "mmmm d, yyyy"],
  [42, "dd-mm-yyyy h:mm AM/PM"], [44, "dd-mm-yyyy h:mm"], [46, "mm-dd-yyyy h:mm AM/PM"],
  [48, "mm-dd-yyyy h:mm"], [50, "yyyy-mm-dd h:mm AM/PM"], [52, "yyyy-mm-dd h:mm"],
  [54, "h:mm AM/PM"], [56, "h:mm:ss AM/PM"], [58, "h:mm"], [60, "h:mm:ss"]
])("Psion number format %i matches released Gnumeric text", async (code, format) => {
  const fixture = psionFixture([0, 0, 0, 48, 7, 0, 0, 0, 2, 4, 0, Number(code), 4]);
  const book = await readPsion(fixture, context);
  expect(book.sheets[0]!.cells[0]!.format).toBe(format);
});

it("Psion decimals cap at Gnumeric's internal limit of thirty", async () => {
  const book = await readPsion(psionFixture([0, 0, 0, 48, 7, 0, 0, 0, 2, 4, 0, 2, 254]), context);
  expect(book.sheets[0]!.cells[0]!.format).toBe("0.000000000000000000000000000000");
});
