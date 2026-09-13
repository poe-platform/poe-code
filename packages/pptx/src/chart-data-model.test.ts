import { expect, it } from "vitest";
import { Volume } from "memfs";
import { BubbleChartData, Categories, CategoryChartData, XyChartData } from "./chart-data-model.js";
import { inspectZip } from "../tests/zip-reader.js";

it("builds uniform category hierarchies with leaf indexes and levels", () => {
  const data = new CategoryChartData();
  const west = data.add_category("West");
  west.add_sub_category("Bay");
  west.add_sub_category("Port");
  const east = data.add_category("East");
  east.add_sub_category("Hill");
  expect(data.categories.depth).toBe(2);
  expect(data.categories.leaf_count).toBe(3);
  expect(east.idx).toBe(2);
  expect(data.categories.levels).toEqual([
    [
      [0, "Bay"],
      [1, "Port"],
      [2, "Hill"]
    ],
    [
      [0, "West"],
      [2, "East"]
    ]
  ]);
  data.add_series("Count", [1, null, 0]);
  expect(data.categories_ref).toBe("Sheet1!$A$2:$B$4");
  expect(data.at(0).values_ref).toBe("Sheet1!$C$2:$C$4");
  expect(data.to_chart_data().categoryLevels).toEqual([
    ["West", null, "East"],
    ["Bay", "Port", "Hill"]
  ]);
  east.sub_categories[0]!.add_sub_category("Uneven");
  expect(() => data.categories.depth).toThrow();
});
it("preserves numeric and UTC date categories and explicit formats", () => {
  const data = new CategoryChartData();
  data.categories = [new Date("1900-02-28T12:00:00Z"), new Date("1900-03-01T00:00:00Z")];
  expect(data.categories.are_dates).toBe(true);
  expect(data.categories.are_numeric).toBe(true);
  expect(data.categories.number_format).toBe("yyyy\\-mm\\-dd");
  expect(data.categories.at(0).numeric_str_val()).toBe("59.0");
  expect(data.categories.at(1).numeric_str_val()).toBe("61.0");
  data.categories = [new Date("1904-01-01T00:00:00Z")];
  expect(data.categories.at(0).numeric_str_val(true)).toBe("0.0");
  data.categories = [0, 2.5];
  expect(data.categories.are_dates).toBe(false);
  expect(data.categories.number_format).toBe("General");
  data.categories.number_format = "0.00";
  expect(data.categories.number_format).toBe("0.00");
  expect(() => data.add_category("Mixed")).toThrow();
  expect(() => new Categories().add_category(new Date(NaN))).toThrow();
});
it("inherits number formats through owned series and points with sequence protocols", () => {
  const data = new CategoryChartData("0.0");
  data.categories = ["A", "B"];
  const first = data.add_series("First", [3]);
  const point = first.add_data_point(0, "0%");
  const second = data.add_series("Second", [9], "$0");
  expect([
    data.number_format,
    first.number_format,
    first.at(0).number_format,
    point.number_format,
    second.at(0).number_format
  ]).toEqual(["0.0", "0.0", "0.0", "0%", "$0"]);
  expect(data.at(-1)).toBe(second);
  expect(data[0]).toBe(first);
  expect(data.slice(0, 1)).toEqual([first]);
  expect(data.reversed()).toEqual([second, first]);
  expect(data.count(first)).toBe(1);
  expect(data.index(second)).toBe(1);
  expect(second.index).toBe(1);
  expect(second.data_point_offset).toBe(2);
  expect(() => data.at(2)).toThrow();
  expect(() => data.at(0.5)).toThrow();
  expect(() => data.append(new CategoryChartData().add_series("Foreign"))).toThrow();
  expect(() => first.add_data_point(NaN)).toThrow();
});
it("builds independent XY and bubble series with coordinate reference helpers", () => {
  const xy = new XyChartData();
  const a = xy.add_series("One");
  a.add_data_point(-1, 2);
  a.add_data_point(0, null);
  const b = xy.add_series("Two");
  b.add_data_point(7, 8);
  expect(a.x_values).toEqual([-1, 0]);
  expect(a.y_values).toEqual([2, null]);
  expect(b.data_point_offset).toBe(2);
  expect(b.name_ref).toBe("Sheet1!$D$1");
  expect(b.x_values_ref).toBe("Sheet1!$C$2:$C$2");
  expect(b.y_values_ref).toBe("Sheet1!$D$2:$D$2");
  const bubble = new BubbleChartData();
  const series = bubble.add_series("Radius");
  series.add_data_point(2, 3, 0);
  series.add_data_point(4, 5, 6, "0.00");
  expect(series.bubble_sizes).toEqual([0, 6]);
  expect(series.bubble_sizes_ref).toBe("Sheet1!$C$2:$C$3");
  expect(series.at(1).number_format).toBe("0.00");
  expect(new TextDecoder().decode(bubble.xml_bytes("BUBBLE"))).toContain("<c:bubbleChart>");
});
it("serializes workbook bytes through the maintained bounded writer and memfs", async () => {
  const data = new CategoryChartData();
  data.categories = ["Bay"];
  data.add_series("Units", [3]);
  const context = {
    limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
    archiveLimits: {
      maxArchiveBytes: 262144,
      maxEntryBytes: 65536,
      maxTotalBytes: 262144,
      maxMembers: 64,
      maxPathBytes: 256,
      maxDepth: 16,
      maxPaxBytes: 1024,
      maxTextBytes: 65536,
      chunkSize: 4096
    },
    xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
    relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
  };
  const fs = Volume.fromJSON({ "/data.xlsx": Buffer.from(await data.xlsx_blob(context)) });
  const entries = inspectZip(new Uint8Array(fs.readFileSync("/data.xlsx") as Buffer));
  expect(
    new TextDecoder().decode(entries.find((e) => e.name === "xl/worksheets/sheet1.xml")!.payload)
  ).toContain("Bay");
});
it("retains date axis intent and point-specific workbook styles", async () => {
  const data = new CategoryChartData("0.0");
  data.categories = [new Date("2024-01-02T14:00:00Z"), new Date("2024-01-03T00:00:00Z")];
  const series = data.add_series("Reading", [], "0%");
  series.add_data_point(0.2, "0.00%");
  series.add_data_point(0.4);
  expect(new TextDecoder().decode(data.xml_bytes("LINE"))).toContain("<c:dateAx>");
  const context = {
    limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
    archiveLimits: {
      maxArchiveBytes: 262144,
      maxEntryBytes: 65536,
      maxTotalBytes: 262144,
      maxMembers: 64,
      maxPathBytes: 256,
      maxDepth: 16,
      maxPaxBytes: 1024,
      maxTextBytes: 65536,
      chunkSize: 4096
    },
    xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
    relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
  };
  const entries = inspectZip(await data.xlsx_blob(context));
  const sheet = new TextDecoder().decode(
    entries.find((entry) => entry.name === "xl/worksheets/sheet1.xml")!.payload
  );
  const styles = new TextDecoder().decode(
    entries.find((entry) => entry.name === "xl/styles.xml")!.payload
  );
  expect(sheet).toContain('<c r="A2" s="1"><v>45293</v>');
  expect(sheet).toContain('<c r="B2" s="3"><v>0.2</v>');
  expect(sheet).toContain('<c r="B3" s="2"><v>0.4</v>');
  expect(styles).toContain('formatCode="0.00%"');
});
it("validates public collection mutation and isolates category dates and output snapshots", () => {
  const data = new CategoryChartData();
  const original = new Date("2020-06-01T00:00:00Z");
  const category = data.add_category(original);
  original.setUTCFullYear(2021);
  (category.label as Date).setUTCFullYear(2022);
  expect((category.label as Date).getUTCFullYear()).toBe(2020);
  const series = data.add_series("Reading", [2]);
  series.append(series.at(0));
  expect(series.count(series.at(0))).toBe(2);
  expect(series.length).toBe(2);
  expect(series.includes(series.at(0))).toBe(true);
  expect(series.slice(-1)).toEqual([series.at(0)]);
  expect(() => Reflect.set(series, "0", series.at(0))).toThrow();
  expect(() => Object.defineProperty(series, "0", { value: series.at(0) })).toThrow();
  expect(() => Reflect.deleteProperty(series, "0")).toThrow();
  expect(() => data.index(series, 1)).toThrow();
  expect(() => data.categories.index(new Categories().add_category("Foreign"))).toThrow();
  const snapshot = data.to_chart_data();
  data.add_series("Later", [3]);
  expect(snapshot.series).toHaveLength(1);
  expect(() => (data.categories = [new Date(NaN)])).toThrow();
  expect(data.categories.at(0)).toBe(category);
});
it("checks all inherited XY and bubble series references and point owners", () => {
  const data = new BubbleChartData("0.00");
  const first = data.add_series("First", "0%");
  const point = first.add_data_point(3, 4, 5, "0.0%");
  const second = data.add_series("Second");
  second.add_data_point(1, 2, 0);
  expect([point.x, point.y, point.bubble_size, point.number_format]).toEqual([3, 4, 5, "0.0%"]);
  expect(data.series_index(second)).toBe(1);
  expect(data.data_point_offset(second)).toBe(1);
  expect(data.series_name_ref(second)).toBe("Sheet1!$E$1");
  expect(data.x_values_ref(second)).toBe("Sheet1!$D$2:$D$2");
  expect(data.y_values_ref(second)).toBe("Sheet1!$E$2:$E$2");
  expect(data.bubble_sizes_ref(second)).toBe("Sheet1!$F$2:$F$2");
  expect(() => second.append(point)).toThrow();
  expect(() => first.add_data_point(0, 0, -1)).toThrow();
  expect(() => first.add_data_point(Infinity, 0, 1)).toThrow();
  expect(data.to_chart_data().series[0]).toMatchObject({ pointNumberFormats: ["0.0%"] });
});
it("supports directional stepped slices and hides mutable storage", () => {
  const data = new CategoryChartData();
  const a = data.add_series("A"),
    b = data.add_series("B"),
    c = data.add_series("C");
  expect(data.slice(undefined, undefined, -1)).toEqual([c, b, a]);
  expect(data.slice(undefined, undefined, 2)).toEqual([a, c]);
  expect(data.slice(-1, -4, -2)).toEqual([c, a]);
  expect(data.slice(undefined, -1, -1)).toEqual([]);
  expect(() => data.slice(0, 1, 0)).toThrow();
  expect(() => data.slice(0.5)).toThrow();
  expect("items" in data).toBe(false);
});
it("retains documented null labels, date strings and global subcategory indexes", () => {
  const data = new CategoryChartData();
  expect(data.add_series(null).name).toBe("");
  expect(data.add_category(null).label).toBe("");
  expect(data.categories.at(0).numeric_str_val()).toBe("null");
  data.categories = [new Date("1900-03-01T00:00:00Z")];
  expect(data.categories.number_format).toBe("yyyy\\-mm\\-dd");
  expect(data.categories.at(0).numeric_str_val()).toBe("61.0");
  data.categories = ["West", "East"];
  data.categories.at(0).add_sub_category("Bay");
  data.categories.at(0).add_sub_category("Port");
  const hill = data.categories.at(1).add_sub_category("Hill");
  expect(data.categories.at(1).index(hill)).toBe(2);
  expect(hill.idx).toBe(2);
  expect(new Categories().add_category("Text").numeric_str_val()).toBe("Text");
  expect(() => new CategoryChartData().categories_ref).toThrow();
});
it("exposes inherited category coordinate errors with explicit category/value equivalents", () => {
  const data = new CategoryChartData();
  data.categories = ["Bay"];
  const series = data.add_series("Depth");
  expect(series.x_values).toEqual([]);
  expect(series.y_values).toEqual([]);
  series.add_data_point(2);
  for (const read of [
    () => series.x_values,
    () => series.y_values,
    () => series.x_values_ref,
    () => series.y_values_ref,
    () => data.x_values_ref(series),
    () => data.y_values_ref(series)
  ])
    expect(read).toThrowError(expect.objectContaining({ code: "property-unavailable" }));
  expect(series.values).toEqual([2]);
  expect(series.categories_ref).toBe("Sheet1!$A$2:$A$2");
  expect(series.values_ref).toBe("Sheet1!$B$2:$B$2");
});
