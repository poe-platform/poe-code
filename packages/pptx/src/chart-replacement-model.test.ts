import { parseXmlPart } from "./xml.js";
import { writePackageArchive } from "./package-writer.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { addChart } from "./chart-editing.js";
import { CategoryChartData } from "./chart-data-model.js";
import { Presentation } from "./presentation-model.js";
import { GraphicFrame, SlidePlaceholder } from "./slide-model.js";
import { inspectZip } from "../tests/zip-reader.js";
const context = {
  limits: { maxBytes: 1000000, maxReads: 2000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 1000000,
    maxEntryBytes: 100000,
    maxTotalBytes: 1000000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 100000,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
it("replaces imported live chart data synchronously and preserves formatting through repeated saves", async () => {
  const initial = await createPresentation({ slides: [{ name: "Readings" }] }, context);
  const bytes = await addChart(
    initial,
    {
      slide: 1,
      type: "LINE",
      left: 0,
      top: 0,
      width: 100000,
      height: 100000,
      data: { categories: ["Before"], series: [{ name: "Old", values: [1] }] }
    },
    context
  );
  const model = await Presentation(bytes, context);
  const chart = (model.slides[0]!.shapes[0] as GraphicFrame).chart;
  chart.chart_style = 14;
  const data = new CategoryChartData();
  data.categories = ["Bay", "Port"];
  data.add_series("Depth", [2, 3]);
  expect(chart.replace_data(data)).toBeUndefined();
  expect(chart.chart_style).toBe(14);
  expect(chart.part.partname).toContain("/charts/");
  expect(new TextDecoder().decode(chart.part.blob)).toContain("Bay");
  data.categories = ["Hill"];
  const next = new CategoryChartData();
  next.categories = ["Hill"];
  next.add_series("Depth", [7]);
  chart.replace_data(next);
  const fs = Volume.fromJSON({ "/deck.pptx": Buffer.from(await model.save()) });
  const reopened = await Presentation(
    new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer),
    context
  );
  const restored = (reopened.slides[0]!.shapes[0] as GraphicFrame).chart;
  expect(restored.chart_style).toBe(14);
  expect(new TextDecoder().decode(restored.part.blob)).toContain("Hill");
  chart.replace_data(next);
  expect(new TextDecoder().decode(chart.part.blob)).toContain("Hill");
  const saved = inspectZip(new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer));
  const workbook = saved.find((entry) => entry.name.endsWith(".xlsx"))!;
  expect(
    new TextDecoder().decode(
      inspectZip(workbook.payload).find((entry) => entry.name === "xl/worksheets/sheet1.xml")!
        .payload
    )
  ).toContain("Hill");
});
it("leaves the chart and workbook unchanged when data validation rejects replacement", async () => {
  const initial = await createPresentation({ slides: [{ name: "Survey" }] }, context);
  const bytes = await addChart(
    initial,
    {
      slide: 1,
      type: "LINE",
      left: 0,
      top: 0,
      width: 100000,
      height: 100000,
      data: { categories: ["Bay"], series: [{ name: "Depth", values: [1] }] }
    },
    context
  );
  const model = await Presentation(bytes, context);
  const chart = (model.slides[0]!.shapes[0] as GraphicFrame).chart;
  const before = chart.part.blob;
  const invalid = new CategoryChartData();
  invalid.categories = ["Bay", "Port"];
  invalid.add_series("Depth", [1]);
  expect(() => chart.replace_data(invalid)).toThrow();
  expect(chart.part.blob).toEqual(before);
  const beforeWorkbook = inspectZip(bytes).find((entry) => entry.name.endsWith(".xlsx"))!.payload;
  const afterWorkbook = inspectZip(await model.save()).find((entry) =>
    entry.name.endsWith(".xlsx")
  )!.payload;
  expect(afterWorkbook).toEqual(beforeWorkbook);
});
it("retains an imported 1904 workbook epoch when the builder did not choose an epoch", async () => {
  const initial = await createPresentation({ slides: [{ name: "Epoch" }] }, context);
  const bytes = await addChart(
    initial,
    {
      slide: 1,
      type: "LINE",
      left: 0,
      top: 0,
      width: 100000,
      height: 100000,
      data: {
        date1904: true,
        categories: ["1904-01-01T00:00:00Z"],
        series: [{ name: "Day", values: [1] }]
      }
    },
    context
  );
  const model = await Presentation(bytes, context);
  const chart = (model.slides[0]!.shapes[0] as GraphicFrame).chart;
  const data = new CategoryChartData();
  data.categories = [new Date("1904-01-02T00:00:00Z")];
  data.add_series("Day", [2]);
  chart.replace_data(data);
  expect(new TextDecoder().decode(chart.part.blob)).toContain("<c:v>1</c:v>");
});
it("preserves an opaque workbook during opening and rejects only requested replacement", async () => {
  const initial = await createPresentation({ slides: [{ name: "Opaque" }] }, context);
  const bytes = await addChart(
    initial,
    {
      slide: 1,
      type: "LINE",
      left: 0,
      top: 0,
      width: 100000,
      height: 100000,
      data: { categories: ["Bay"], series: [{ name: "Depth", values: [1] }] }
    },
    context
  );
  const opaque = Uint8Array.of(4, 3, 2, 1);
  const modified = storedArchive(
    inspectZip(bytes).map((entry) => ({
      name: entry.name,
      bytes: entry.name.endsWith(".xlsx") ? opaque : entry.payload
    }))
  );
  const model = await Presentation(modified, context);
  const chart = (model.slides[0]!.shapes[0] as GraphicFrame).chart;
  expect(chart.chart_type).toBeDefined();
  expect(() =>
    chart.replace_data({ categories: ["Port"], series: [{ name: "Depth", values: [2] }] })
  ).toThrow();
  expect(
    inspectZip(await model.save()).find((entry) => entry.name.endsWith(".xlsx"))!.payload
  ).toEqual(opaque);
});
it("bounds aggregate expanded workbook admission across chart parts", async () => {
  let bytes = await createPresentation({ slides: [{ name: "Budget" }] }, context);
  for (let i = 0; i < 2; i++)
    bytes = await addChart(
      bytes,
      {
        slide: 1,
        type: "LINE",
        left: 0,
        top: 0,
        width: 100000,
        height: 100000,
        data: { categories: ["Bay"], series: [{ name: "Depth", values: [i] }] }
      },
      context
    );
  const expanded: { name: string; bytes: Uint8Array }[] = [];
  for (const entry of inspectZip(bytes)) {
    if (!entry.name.endsWith(".xlsx")) {
      expanded.push({ name: entry.name, bytes: entry.payload });
      continue;
    }
    const members = inspectZip(entry.payload).map((member) => ({
      name: member.name,
      bytes: member.payload
    }));
    for (let i = 0; i < 9; i++)
      members.push({
        name: `extra${i}.xml`,
        bytes: new TextEncoder().encode(`<original>${"x".repeat(90000)}</original>`)
      });
    expanded.push({
      name: entry.name,
      bytes: await writePackageArchive(members, context, { compression: "auto" })
    });
  }
  await expect(Presentation(storedArchive(expanded), context)).rejects.toMatchObject({
    code: "resource-limit"
  });
});
it("replaces the pending workbook of a newly inserted placeholder chart before its first save", async () => {
  const bytes = await createPresentation({ slides: [{ name: "New" }] }, context);
  const members: { name: string; bytes: Uint8Array }[] = inspectZip(bytes).map((entry) => ({
    name: entry.name,
    bytes: entry.payload
  }));
  const slide = members.find((member) => member.name === "ppt/slides/slide1.xml")!;
  const xml = parseXmlPart(slide.bytes, context.xmlLimits);
  const tree = xml.root.children
    .find((node) => node.name.localName === "cSld")!
    .children.find((node) => node.name.localName === "spTree")!;
  slide.bytes = xml
    .spliceChildren(tree, tree.children.length, 0, [
      '<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvSpPr><p:cNvPr id="8" name="Survey chart"/><p:cNvSpPr/><p:nvPr><p:ph type="chart" idx="4"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm></p:spPr></p:sp>'
    ])
    .bytes();
  const model = await Presentation(storedArchive(members), context);
  const first = new CategoryChartData();
  first.categories = ["Bay"];
  first.add_series("Depth", [1]);
  const chart = (model.slides[0]!.placeholders[4] as SlidePlaceholder).insert_chart(
    "LINE",
    first
  ).chart;
  const next = new CategoryChartData();
  next.categories = ["Port"];
  next.add_series("Depth", [4]);
  chart.replace_data(next);
  expect(new TextDecoder().decode(chart.part.blob)).toContain("Port");
  const restored = await Presentation(await model.save(), context);
  expect(
    new TextDecoder().decode((restored.slides[0]!.shapes[0] as GraphicFrame).chart.part.blob)
  ).toContain("Port");
});
