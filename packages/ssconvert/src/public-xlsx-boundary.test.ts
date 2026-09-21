import { expect, it } from "vitest";
import { createXlsxWriter, readXlsx, type CapabilityContext, type Workbook } from "./index.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 10, sheets: 2, operations: 20 }
};

it.each(["2006", "2008"] as const)("public %s writer rejects duplicate addresses rather than silently losing cells", async edition => {
  const book: Workbook = { sheets: [{ id: "s", name: "Original", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "first" } },
    { row: 0, column: 0, value: { kind: "string", value: "second" } }
  ] }] };
  await expect(createXlsxWriter(edition)(book, [], context))
    .rejects.toMatchObject({ code: "invalid-request", message: "Duplicate cell address" });
});

it("public writer owns caller workbook data before asynchronous package work", async () => {
  const value = { kind: "string" as const, value: "before" };
  const sheet = { id: "s", name: "Original", cells: [{ row: 0, column: 0, value }] };
  const pending = createXlsxWriter("2008")({ sheets: [sheet] }, [], context);
  value.value = "after";
  sheet.name = "Changed";
  const reopened = await readXlsx(await pending, context);
  expect(reopened.sheets[0]?.name).toBe("Original");
  expect(reopened.sheets[0]?.cells[0]?.value).toEqual({ kind: "string", value: "before" });
});

it("public writer rejects workbook accessors without executing caller code", async () => {
  let calls = 0;
  const book: Workbook = { get sheets() { calls++; return []; } };
  await expect(createXlsxWriter("2008")(book, [], context))
    .rejects.toMatchObject({ code: "invalid-request" });
  expect(calls).toBe(0);
});
