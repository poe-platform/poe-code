import { expect, it } from "vitest";
import { chartWorkbookRange, workbookColumn } from "./chart-workbook.js";
import { createChartXml, validateChartData } from "./chart-editing.js";

it.each([
  [2, "B"],
  [26, "Z"],
  [27, "AA"],
  [52, "AZ"],
  [53, "BA"],
  [676, "YZ"],
  [677, "ZA"],
  [702, "ZZ"],
  [703, "AAA"],
  [728, "AAZ"],
  [729, "ABA"],
  [1378, "AZZ"],
  [1379, "BAA"],
  [16384, "XFD"]
] as const)("addresses worksheet column %s as %s", (ordinal, expected) => {
  expect(workbookColumn(ordinal - 1)).toBe(expected);
  expect(chartWorkbookRange(`'Harbor''s data'!$${expected}$1048576`, "Harbor's data")).toEqual({
    start: { column: ordinal, row: 1048576 },
    end: { column: ordinal, row: 1048576 }
  });
});
it.each([0, -1, 16385, 30433, 1.5, NaN, Infinity])(
  "rejects invalid worksheet column ordinal %s",
  (ordinal) => {
    expect(() => workbookColumn(ordinal - 1)).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
  }
);
it.each([
  "Sheet1!A0",
  "Sheet1!XFE1",
  "Sheet1!A1048577",
  "Sheet1!A01",
  "Sheet1!A3:A2",
  "Sheet1!C2:B2",
  "Sheet1!A1:B2:C3",
  "Other!A1",
  "[book]Sheet1!A1",
  "SUM(Sheet1!A1)",
  "Sheet1!A1,Sheet1!B1",
  "Sheet1!1:2",
  "Sheet1!$A$",
  "Sheet1!A1+1"
])("rejects nonlocal or invalid range %s", (formula) => {
  expect(() => chartWorkbookRange(formula, "Sheet1")).toThrowError(
    expect.objectContaining({ code: "unsupported-edit" })
  );
});
it.each([
  [1, 1, 0, "A", "B", 2],
  [1, 3, 3, "A", "E", 4],
  [2, 4, 0, "B", "C", 5],
  [3, 8, 3, "C", "G", 9],
  [3, 1, 0, "C", "D", 2],
  [1, 3, 1, "A", "C", 4],
  [2, 5, 0, "B", "C", 6],
  [3, 7, 2, "C", "F", 8]
] as const)(
  "keeps category depth %s and leaf count %s aligned with series %s",
  (depth, leaves, seriesIndex, right, values, bottom) => {
    const xml = createChartXml("COLUMN_CLUSTERED", {
      categoryLevels: Array.from({ length: depth }, (_, level) =>
        Array.from({ length: leaves }, (_, index) => `Level ${level} label ${index}`)
      ),
      series: Array.from({ length: seriesIndex + 1 }, (_, index) => ({
        name: `Measure ${index}`,
        values: Array.from({ length: leaves }, (_, point) => point - index)
      }))
    });
    expect(xml).toContain(`<c:f>Sheet1!$A$2:$${right}$${bottom}</c:f>`);
    expect(xml).toContain(`<c:f>Sheet1!$${values}$1</c:f>`);
    expect(xml).toContain(`<c:f>Sheet1!$${values}$2:$${values}$${bottom}</c:f>`);
  }
);
it("rejects an absent category range before producing chart bytes", () => {
  expect(() =>
    validateChartData(
      { categories: [], series: [{ name: "Empty", values: [1] }] },
      "COLUMN_CLUSTERED"
    )
  ).toThrow();
});
