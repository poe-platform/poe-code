import { expect, it } from "vitest";
import {
  createChartXml,
  validateChartData,
  validateChartUpdate,
  chartTypes
} from "./chart-editing.js";
import { parseXmlPart } from "./xml.js";
import { inspectChart } from "./charts.js";
const data = {
  categories: ["West", null, "East", "West"],
  series: [{ name: "", values: [0, null, -2, 7] }]
};
const parse = (xml: string) =>
  inspectChart(
    parseXmlPart(new TextEncoder().encode(xml), { maxBytes: 100000, maxNodes: 5000, maxDepth: 40 })
  );
it("writes ordered categories and sparse numeric caches with independently specified indices", () => {
  const xml = createChartXml("COLUMN_CLUSTERED", data);
  expect(xml).toContain(
    '<c:strCache><c:ptCount val="4"/><c:pt idx="0"><c:v>West</c:v></c:pt><c:pt idx="2"><c:v>East</c:v></c:pt><c:pt idx="3"><c:v>West</c:v></c:pt></c:strCache>'
  );
  expect(xml).toContain(
    '<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="4"/><c:pt idx="0"><c:v>0</c:v></c:pt><c:pt idx="2"><c:v>-2</c:v></c:pt><c:pt idx="3"><c:v>7</c:v></c:pt></c:numCache>'
  );
  expect(parse(xml).axes.map((a) => [a.id, a.crossAxisId, a.properties.axPos])).toEqual([
    ["1", "2", "b"],
    ["2", "1", "l"]
  ]);
  expect(xml).toContain("<c:f>Sheet1!$B$2:$B$5</c:f>");
});
it.each(chartTypes)("creates deterministic XML for %s", (type) => {
  const d = type.startsWith("XY_")
    ? { series: [{ name: "Pair", xValues: [2, 1], values: [4, null] }] }
    : data;
  expect(createChartXml(type, d)).toBe(createChartXml(type, d));
  expect(parse(createChartXml(type, d)).plots).toHaveLength(1);
});
it("retains paired scatter ordering and uses two value axes", () => {
  const chart = parse(
    createChartXml("XY_SCATTER", {
      series: [{ name: "Track", xValues: [3, 1, 3], values: [5, null, 9] }]
    })
  );
  expect(chart.plots[0]!.series[0]!.xValues!.points).toEqual([
    { index: "0", value: "3" },
    { index: "1", value: "1" },
    { index: "2", value: "3" }
  ]);
  expect(chart.plots[0]!.series[0]!.yValues!.points).toEqual([
    { index: "0", value: "5" },
    { index: "2", value: "9" }
  ]);
  expect(chart.axes.map((a) => a.type)).toEqual(["valAx", "valAx"]);
});
it.each([
  { categories: [], series: [{ name: "a", values: [] }] },
  { categories: ["a"], series: [{ name: "a", values: [1, 2] }] },
  { categories: ["a", 2], series: [{ name: "a", values: [1, 2] }] },
  { categories: ["a"], series: [{ name: "a", values: [Infinity] }] },
  { categories: ["a"], series: [] }
])("rejects invalid category data %#", (value) =>
  expect(() => validateChartData(value, "LINE")).toThrow()
);
it.each([
  { series: [{ name: "x", xValues: [1], values: [1, 2] }] },
  { series: [{ name: "x", xValues: [null], values: [1] }] },
  { categories: ["a"], series: [{ name: "x", xValues: [1], values: [1] }] }
])("rejects invalid scatter pairs %#", (value) =>
  expect(() => validateChartData(value as never, "XY_SCATTER")).toThrow()
);
it("requires one pie series and explicit valid style values", () => {
  expect(() =>
    createChartXml("PIE", {
      categories: ["a"],
      series: [
        { name: "a", values: [1] },
        { name: "b", values: [2] }
      ]
    })
  ).toThrow();
  for (const style of [0, 49, 1.2, NaN]) expect(() => validateChartUpdate({ style })).toThrow();
  const chart = parse(
    createChartXml(
      "PIE",
      { categories: ["a"], series: [{ name: "a", values: [1] }] },
      { style: 48, title: "", legend: true }
    )
  );
  expect(chart.style).toBe("48");
  expect(chart.title).not.toBeNull();
  expect(chart.legend).not.toBeNull();
  expect(chart.axes).toEqual([]);
});
it("serializes UTC category days across the 1900 leap boundary", () => {
  const chart = parse(
    createChartXml("LINE", {
      categories: ["1900-02-28T22:10:00Z", "1900-03-01T00:00:00Z"],
      series: [{ name: "days", values: [1, 2] }]
    })
  );
  expect(chart.plots[0]!.series[0]!.categories!.points).toEqual([
    { index: "0", value: "59" },
    { index: "1", value: "61" }
  ]);
  expect(chart.plots[0]!.series[0]!.categories!.formatCode).toBe("yyyy-mm-dd");
  expect(chart.axes[0]!.type).toBe("dateAx");
});
it("rejects mixed date and text labels and invalid UTC calendar dates", () => {
  for (const categories of [["1900-03-01T00:00:00Z", "text"], ["2025-02-29T00:00:00Z"]])
    expect(() =>
      validateChartData(
        { categories, series: [{ name: "a", values: categories.map(() => 1) }] },
        "LINE"
      )
    ).toThrow();
});
it("rejects selector accessors and unsupported part filters before input admission", async () => {
  const { setCharts } = await import("./chart-editing.js");
  let reads = 0;
  const context = {} as never;
  await expect(
    setCharts(
      new Uint8Array(),
      {
        get slide() {
          reads++;
          return 1;
        }
      },
      { style: 1 },
      context
    )
  ).rejects.toMatchObject({ code: "invalid-value" });
  expect(reads).toBe(0);
  await expect(
    setCharts(new Uint8Array(), { part: "/ppt/slides/slide1.xml" }, { style: 1 }, context)
  ).rejects.toMatchObject({ code: "invalid-value" });
});
